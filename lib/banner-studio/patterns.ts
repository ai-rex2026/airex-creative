import { askJson } from "../anthropic";
import { normalizeJapanese } from "../meo-ops/japanese";
import type { Diagnosis } from "../types";
import { PATTERN_COUNT, type BannerMaterial, type BannerPattern } from "./types";

/**
 * バナーの絵の基本パターンを決める（AI 1回）。絵の指示は英語で、文字を描かせない。
 * 文字は後から DOM・canvas で重ねるので、下3分の1に余白を残す構図にする。
 */

const NO_TEXT =
  "Absolutely no text, letters, numbers, captions, logos, watermarks or UI elements anywhere in the image. Leave clean, uncluttered negative space in the lower third for a text overlay. High quality advertising photography, sharp focus.";

const SYSTEM = `あなたは日本の広告代理店のアートディレクターです。ディスプレイ広告・SNS広告のバナーの「絵（背景・場面）」を${PATTERN_COUNT}パターン考えます。
文字（コピー）は後から別に重ねるので、絵には文字を一切入れません。

パターンは互いに違う切り口にする（当てはまるものから選ぶ）:
- 商品・サービスを主役にした写真（素材の商品写真があればそれを使う）
- 使っている人・使っている場面（顔は正面を避けてもよい）
- 悩み・ビフォーの気持ちに寄り添う場面
- 得られる結果・理想の状態（アフター）を感じさせる場面
- ブランド色を活かしたシンプルな背景・質感（文字を大きく載せる用）

ルール:
- prompt は英語で 40〜80語。被写体・場面・光・色（ブランド色を取り入れる）・構図（下3分の1を空ける）を具体的に
- 実在の人物・有名人・他社ブランド・キャラクターを描かない。医療・美容・健康の効果を示す変化（ビフォーアフターの体の比較）を描かない
- 素材（商品写真など）があるパターンは useMaterials を true にし、prompt で「the product from the reference image」として場面に置く
- motion は英語 10〜25語。5秒の動画にするときの、ゆっくりしたカメラの動き・被写体の小さな動き
- label は日本語 16字以内、concept は日本語 50字以内

出力: {"patterns":[{"key":"p1","label":"","concept":"","prompt":"","motion":"","useMaterials":false}]}`;

export type PatternDeps = { ask: (system: string, user: string) => Promise<unknown> };
export const defaultPatternDeps = (): PatternDeps => ({ ask: (s, u) => askJson(s, u, { maxTokens: 3000, timeoutMs: 90_000 }) });

export async function planPatterns(
  d: Diagnosis,
  description: string,
  materials: BannerMaterial[],
  deps: PatternDeps = defaultPatternDeps()
): Promise<BannerPattern[]> {
  const kinds = { product: "商品写真", logo: "ロゴ", photo: "写真" } as const;
  const user = [
    `商材: ${d.product}`,
    `ターゲット: ${d.audience}`,
    `強み: ${d.strengths.slice(0, 5).join(" / ")}`,
    `買わない理由: ${d.objections.slice(0, 4).join(" / ")}`,
    `ブランド: ${d.brand.name}（トーン：${d.brand.tone}／ブランド色：${d.brand.accent}）`,
    description ? `担当者からの説明: ${description.slice(0, 1200)}` : "",
    `素材: ${materials.length ? materials.map((m) => `${kinds[m.kind]}（${m.name}）`).join("、") : "なし"}`,
  ]
    .filter(Boolean)
    .join("\n");
  const raw = (await deps.ask(SYSTEM, user)) as { patterns?: Record<string, unknown>[] };
  const hasProduct = materials.some((m) => m.kind !== "logo");
  const out: BannerPattern[] = [];
  for (const [i, p] of (Array.isArray(raw?.patterns) ? raw.patterns : []).entries()) {
    const prompt = String(p?.prompt ?? "").trim();
    if (prompt.length < 20) continue;
    out.push({
      key: `p${out.length + 1}`,
      label: normalizeJapanese(String(p?.label ?? `パターン${i + 1}`)).slice(0, 24),
      concept: normalizeJapanese(String(p?.concept ?? "")).slice(0, 80),
      prompt: prompt.slice(0, 900),
      motion: String(p?.motion ?? "slow cinematic push-in, soft natural light movement").trim().slice(0, 300),
      // 素材が無いのに素材を使う指定は外す
      useMaterials: hasProduct && p?.useMaterials === true,
    });
    if (out.length >= PATTERN_COUNT) break;
  }
  if (!out.length) throw new Error("絵のパターンを決められませんでした");
  return out;
}

/** 画像モデルに渡す最終の指示 */
export function imagePrompt(p: BannerPattern): string {
  const lead = p.useMaterials
    ? "Use the product shown in the reference image(s) exactly as it is — do not change its shape, color, label or packaging design. Place it naturally in this scene: "
    : "";
  return `${lead}${p.prompt}\n\n${NO_TEXT}`;
}

/** 縦横比を変えて作り直すときの指示（元の絵を保つ） */
export function reframePrompt(p: BannerPattern | null): string {
  return `Recompose this exact image for a new aspect ratio. Keep the same subject, product, style, colors and lighting; extend the background naturally and keep the main subject fully visible. ${p ? `Scene: ${p.prompt.slice(0, 300)}` : ""}\n\n${NO_TEXT}`;
}

export function videoPrompt(p: BannerPattern | null): string {
  return `${p?.motion || "slow cinematic push-in, subtle natural movement"}. Keep the product and subject unchanged. No text, no captions, no logos appear.`;
}
