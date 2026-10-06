import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * 一時的な試験用（2026-10-06）。dev_ad_probe に保存済みの Meta 広告（medicalbrows）の画像・動画を
 * Gemini に1回だけ見せて、所見と改善案が出せるか・トークン数（＝費用）を確かめる。
 * 結果は dev_ad_probe（id: medicalbrows-1006-creative）に保存し、2回目以降は保存済みを返すだけ。
 * 試験が終わったらこのファイルごと削除する。
 */
export const maxDuration = 300;

const KEY_SHA256 = "7911a870a97cb0d94ff5f6c55cfaade21b3858261489be1150a7668554c01c5e";
const SRC_ID = "medicalbrows-1006";
const OUT_ID = "medicalbrows-1006-creative";
const MODEL = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
const MAX_IMAGES = 10;
const MAX_VIDEOS = 5;
const MAX_VIDEO_BYTES = 40 * 1024 * 1024;

type MetaAd = { title?: string; bodyText?: string; linkUrl?: string; displayFormat?: string; imageUrls?: string[]; videoUrls?: string[] };

async function download(url: string, limit: number) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > limit) throw new Error(`大きすぎます（${buf.length} bytes）`);
  return { data: buf.toString("base64"), mime: res.headers.get("content-type")?.split(";")[0] || "application/octet-stream", bytes: buf.length };
}

export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get("key") ?? "";
  if (createHash("sha256").update(key).digest("hex") !== KEY_SHA256) return new Response("not found", { status: 404 });
  const sb = createAdminClient();
  const { data: cur } = await sb.from("dev_ad_probe").select("status, payload").eq("id", OUT_ID).maybeSingle();
  if (cur) return Response.json({ cached: true, status: cur.status });
  const { error } = await sb.from("dev_ad_probe").insert({ id: OUT_ID, status: "running" });
  if (error) return Response.json({ cached: true, status: "running" });

  const { data: src } = await sb.from("dev_ad_probe").select("payload").eq("id", SRC_ID).maybeSingle();
  const ads = ((src?.payload as { meta?: { items?: MetaAd[] } } | null)?.meta?.items ?? []) as MetaAd[];

  // 重複する素材（同じURL）は1回だけ見る
  const imgs = [...new Set(ads.flatMap((a) => a.imageUrls ?? []))].slice(0, MAX_IMAGES);
  const vids = [...new Set(ads.flatMap((a) => a.videoUrls ?? []))].slice(0, MAX_VIDEOS);
  const log: { url: string; kind: string; ok: boolean; bytes?: number; mime?: string; error?: string }[] = [];
  const parts: { text?: string; inline_data?: { mime_type: string; data: string } }[] = [];
  let n = 0;
  for (const [kind, list, limit] of [["image", imgs, 8 * 1024 * 1024], ["video", vids, MAX_VIDEO_BYTES]] as const) {
    for (const url of list) {
      try {
        const d = await download(url, limit);
        n += 1;
        parts.push({ text: `【素材${n}】${kind === "image" ? "画像" : "動画"}` });
        parts.push({ inline_data: { mime_type: d.mime, data: d.data } });
        log.push({ url: url.slice(0, 80), kind, ok: true, bytes: d.bytes, mime: d.mime });
      } catch (e) {
        log.push({ url: url.slice(0, 80), kind, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
  }
  const texts = ads.map((a, i) => `- 広告${i + 1}［${a.displayFormat}］見出し：${a.title}／本文：${(a.bodyText ?? "").replace(/\s+/g, " ").slice(0, 120)}／LP：${a.linkUrl}`).join("\n");
  parts.unshift({
    text: `次は、ある医療アートメイク院が Meta（Facebook/Instagram）で配信中の広告です。\n【広告の文言】\n${texts}\n\nこのあとに広告の画像・動画を渡します。`,
  });

  const system = `あなたは運用型広告のクリエイティブの実務者です。渡された画像・動画だけを根拠に答えます。
- 素材ごとに：何を見せているか／画像内・動画内の文字（そのまま書き起こす）／冒頭3秒（動画のみ）／字幕の有無（動画のみ）／縦横比の見立て／良い点／直す点
- 全体：訴求の偏り、足りない訴求、改善案3〜5件（何を・どう変えるか）
- 医療広告ガイドライン・景品表示法の観点で気になる表現・写真（ビフォーアフター等）があれば指摘
- 効果を断定しない。渡されていない数字は書かない
JSONのみで出力：{"creatives":[{"no":1,"what":"","onscreenText":"","first3s":"","subtitles":"","aspect":"","good":[""],"fix":[""]}],"overall":{"bias":"","missing":[""],"improvements":[{"title":"","how":""}],"legal":[""]}}`;

  const t0 = Date.now();
  let out: unknown = null;
  let usage: unknown = null;
  let aiError: string | undefined;
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY ?? "" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts }],
        generationConfig: { maxOutputTokens: 8000, temperature: 0.4, responseMimeType: "application/json" },
      }),
      signal: AbortSignal.timeout(200_000),
    });
    const j = (await res.json()) as { usageMetadata?: unknown; candidates?: { content?: { parts?: { text?: string }[] } }[]; error?: unknown };
    usage = j.usageMetadata ?? null;
    const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!res.ok) aiError = `HTTP ${res.status}: ${JSON.stringify(j.error ?? j).slice(0, 500)}`;
    try {
      out = JSON.parse(text);
    } catch {
      out = text.slice(0, 20000);
    }
  } catch (e) {
    aiError = e instanceof Error ? e.message : String(e);
  }
  const payload = { model: MODEL, ms: Date.now() - t0, media: log, usage, aiError, out };
  await sb.from("dev_ad_probe").update({ status: "done", payload }).eq("id", OUT_ID);
  return Response.json({ cached: false, status: "done", usage, aiError, media: log.length });
}
