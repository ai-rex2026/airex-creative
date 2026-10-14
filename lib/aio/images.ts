import type { SupabaseClient } from "@supabase/supabase-js";
import { askJsonWithImages, MODEL_FAST } from "../anthropic";
import { recordAiCall } from "../ai-context";

/**
 * 記事の画像（アイキャッチ・本文中）を作る。
 *
 * - 画像の中に文字を入れない（AGENTS.md：日本語の文字を画像生成モデルに描かせない）。
 *   指示で禁止し、できた画像を AI に見せて文字が入っていたら作り直す。2回とも入っていたら使わない
 * - 1枚できるごとにその場で保存する（1枚の失敗で他の成功を捨てない。再試行は未生成の画像だけ）
 */

export const IMAGE_BUCKET = "aio-images";
export const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";

const NO_TEXT =
  "Absolutely no text of any kind: no letters, no words, no numbers, no captions, no logos, no watermarks, no signage, no labels, no user-interface screenshots. " +
  "Photorealistic or clean editorial illustration style, natural light, uncluttered composition with space around the subject.";

export type GeneratedImage = { bytes: Buffer; mime: string };

export type ImageDeps = {
  generate: (prompt: string, aspect: string) => Promise<GeneratedImage>;
  hasText: (img: GeneratedImage) => Promise<boolean>;
  upload: (path: string, img: GeneratedImage) => Promise<void>;
};

async function geminiImage(prompt: string, aspect: string): Promise<GeneratedImage> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("画像を作るには GEMINI_API_KEY の設定が要ります");
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: `${prompt}\n\n${NO_TEXT}` }] }],
      generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: aspect } },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`画像を作れませんでした（Gemini ${res.status}: ${(await res.text()).slice(0, 200)}）`);
  const j = (await res.json()) as {
    candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string }; inline_data?: { mime_type?: string; data?: string } }[] }; finishReason?: string }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };
  recordAiCall({ model: IMAGE_MODEL, input_tokens: j.usageMetadata?.promptTokenCount ?? 0, output_tokens: j.usageMetadata?.candidatesTokenCount ?? 0, thinking_tokens: 0, searches: 0 });
  const part = (j.candidates?.[0]?.content?.parts ?? []).find((p) => p.inlineData?.data || p.inline_data?.data);
  const data = part?.inlineData?.data ?? part?.inline_data?.data;
  if (!data) throw new Error(`画像が返ってきませんでした（${j.candidates?.[0]?.finishReason ?? "理由不明"}）`);
  return { bytes: Buffer.from(data, "base64"), mime: part?.inlineData?.mimeType ?? part?.inline_data?.mime_type ?? "image/png" };
}

async function detectText(img: GeneratedImage): Promise<boolean> {
  const r = await askJsonWithImages<{ hasText?: boolean }>(
    `画像に文字（日本語・英語・数字・記号のロゴ・看板の文字・透かし）が描かれているかを判定します。ぼやけた看板や模様のような文字も「あり」とします。
出力: {"hasText":false}`,
    "画像 0 に文字はありますか。",
    [{ media: img.mime, base64: img.bytes.toString("base64") }],
    { model: MODEL_FAST, maxTokens: 100, timeoutMs: 40_000, forceAnthropic: true }
  );
  return r.hasText === true;
}

export function defaultImageDeps(admin: SupabaseClient, bucket: string = IMAGE_BUCKET): ImageDeps {
  return {
    generate: geminiImage,
    hasText: detectText,
    upload: async (path, img) => {
      const { error } = await admin.storage.from(bucket).upload(path, img.bytes, { contentType: img.mime, upsert: true });
      if (error) throw new Error(`画像を保存できませんでした：${error.message}`);
    },
  };
}

const extOf = (mime: string) => (mime.includes("jpeg") ? "jpg" : mime.includes("webp") ? "webp" : "png");

/** 画像の共通の形（記事の画像・SNS の画像） */
export type ImgLike = { key: string; prompt: string; path: string | null; role?: string; aspect?: string; hasText?: boolean; error?: string | null };

/** 1枚作る（文字が入っていたら1回だけ作り直す）。保存したパスを返す */
export async function makeOne(deps: ImageDeps, basePath: string, img: ImgLike): Promise<{ path: string } | { hasText: true }> {
  const aspect = img.aspect ?? (img.role === "eyecatch" ? "16:9" : "4:3");
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt = attempt === 0 ? img.prompt : `${img.prompt}\nThe previous attempt contained text. Do not draw any text, letters, signs or logos at all.`;
    const g = await deps.generate(prompt, aspect);
    let text = false;
    try {
      text = await deps.hasText(g);
    } catch {
      // 判定に失敗したときは使える画像として扱わない（文字入りを通すより、作り直しを選ぶ）
      text = true;
    }
    if (!text) {
      const path = `${basePath}/${img.key}-${Date.now()}.${extOf(g.mime)}`;
      await deps.upload(path, g);
      return { path };
    }
  }
  return { hasText: true };
}

/**
 * 未生成の画像だけを並行で作り、1枚できるごとに onSaved で保存する。
 * onSaved は直列に呼ぶ（同じ images 列を並行に書き換えて壊さないため）
 */
export async function fillImages<T extends ImgLike>(
  deps: ImageDeps,
  basePath: string,
  images: T[],
  onSaved: (next: T[]) => Promise<void>
): Promise<{ made: number; failed: number }> {
  const cur = images.map((i) => ({ ...i }));
  let chain: Promise<void> = Promise.resolve();
  const save = (idx: number, patch: Partial<ImgLike>) => {
    cur[idx] = { ...cur[idx], ...patch };
    const snapshot = cur.map((i) => ({ ...i }));
    chain = chain.then(() => onSaved(snapshot)).catch(() => undefined);
    return chain;
  };
  const todo = cur.map((img, idx) => ({ img, idx })).filter(({ img }) => !img.path);
  const settled = await Promise.allSettled(
    todo.map(async ({ img, idx }) => {
      try {
        const r = await makeOne(deps, basePath, img);
        if ("path" in r) await save(idx, { path: r.path, hasText: false, error: null });
        else {
          await save(idx, { hasText: true, error: "文字が入った画像しか作れませんでした。説明を変えて作り直してください" });
          throw new Error("text");
        }
      } catch (e) {
        if (!(e instanceof Error && e.message === "text")) await save(idx, { error: e instanceof Error ? e.message.slice(0, 200) : "画像を作れませんでした" });
        throw e;
      }
    })
  );
  await chain;
  return { made: settled.filter((s) => s.status === "fulfilled").length, failed: settled.filter((s) => s.status === "rejected").length };
}

export async function signImages<T extends { path: string | null; signedUrl?: string | null }>(admin: SupabaseClient, images: T[], bucket: string = IMAGE_BUCKET): Promise<T[]> {
  const paths = images.map((i) => i.path).filter((p): p is string => !!p);
  if (!paths.length) return images;
  const { data } = await admin.storage.from(bucket).createSignedUrls(paths, 60 * 60 * 6);
  const map = new Map((data ?? []).map((d) => [d.path, d.signedUrl]));
  return images.map((i) => ({ ...i, signedUrl: i.path ? (map.get(i.path) ?? null) : null }));
}

export async function downloadImage(admin: SupabaseClient, path: string, bucket: string = IMAGE_BUCKET): Promise<GeneratedImage> {
  const { data, error } = await admin.storage.from(bucket).download(path);
  if (error || !data) throw new Error(`画像を読めませんでした：${error?.message ?? ""}`);
  return { bytes: Buffer.from(await data.arrayBuffer()), mime: data.type || "image/png" };
}
