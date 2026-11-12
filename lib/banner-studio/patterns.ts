import { askJson } from "../anthropic";
import { checkGuard } from "../guardrail";
import { normalizeJapanese } from "../meo-ops/japanese";
import type { Diagnosis, GuardVerdict, Industry } from "../types";
import {
  ARCHETYPES,
  PATTERN_COUNT,
  aspectValue,
  isArchetype,
  type Archetype,
  type BannerMaterial,
  type BannerPattern,
  type PatternCopy,
  type SubjectSide,
} from "./types";

/**
 * バナーの基本パターンを決める（AI 1回）。2026-11-12 に「訴求の型」ごとの構図とコピーまで決める形にした。
 *
 * 成果の出るバナーの共通点（Google・LINEヤフーの公式ガイド、事例分析）を反映:
 * - メッセージは1つ・主役は1つで大きく（画面の6割）・コラージュにしない・実際の場面と自然な光
 * - 主役は左右どちらかに寄せ、反対側を文字のために空ける（文字と主役を重ねない）
 * - 型ごとにコピーの役割を変える（対象の明示・フック・いちばん目立たせる数字や特典・CTA）
 * 絵には文字を描かせない（AGENTS.md）。文字は DOM・canvas で組む。
 */

const NO_TEXT =
  "Absolutely no text, letters, numbers, captions, logos, watermarks, signs, labels with writing or UI elements anywhere in the image. High quality advertising photography, sharp focus, natural light and real shadows, single clear subject, no collage, no borders.";

const ARCHETYPE_LINES = (Object.keys(ARCHETYPES) as Archetype[]).map((k) => `- ${k}: ${ARCHETYPES[k].label}（${ARCHETYPES[k].hint}）`).join("\n");

const SYSTEM = `あなたは日本の広告代理店のアートディレクター兼コピーライターです。ディスプレイ広告・SNS広告のバナーを${PATTERN_COUNT}パターン設計します。
絵（写真）と文字は別に作ります。絵には文字を一切入れず、文字は後から絵の空いた側に重ねます。

訴求の型（パターンごとに違う型を選ぶ。商材に合うものだけ）:
${ARCHETYPE_LINES}

成果の出るバナーの原則:
- メッセージは1つに絞る。要素を詰め込まない
- 主役（商品・人）は1つで、何の写真か一目で分かること。写真と文字は別の面に分けて置くので、写真の中に文字用の余白を作る必要はない（type だけは主役なしの背景）
- 実際の場面・自然な光。商品が主役。コラージュ・白一色の背景にしない
- 人物を使うときは、表情や手元が分かる距離で、視線は正面かやや横

絵の指示（prompt）:
- 英語で 40〜80語。被写体・場面・光・色（ブランド色を取り入れる）を具体的に。構図の指示は後から足すので書かなくてよい
- type は主役なし：ブランド色を基調にした、文字を大きく載せられる抽象的な背景（質感・光・グラデーション）
- 実在の人物・有名人・他社ブランド・キャラクターを描かない。医療・美容・健康の効果を示す体の変化（ビフォーアフター）を描かない
- 素材（商品写真など）があり、その型で商品を見せるなら useMaterials を true にし、「the product from the reference image」として場面に置く
- motion は英語 10〜25語。5秒の動画にするときの、ゆっくりしたカメラの動き・小さな動き

コピー（copy。型ごとの役割で書く）:
- target: 対象の明示（例：「40代の乾燥肌の方へ」）全角16字以内。question・scene では必ず書く
- headline: 2行で1つの言い切り（question は問いかけ）。各行 全角12字以内
- emphasis: いちばん目立たせる短い要素（number は数字、offer は特典・条件、proof は実績）全角10字以内。emphasisLabel はその説明 全角10字以内。商材情報・説明に書かれた事実だけ。無ければ空にし、その型は選ばない
- sub: 補足 全角24字以内。cta: 全角8字以内の具体的な行動（例：「無料で試す」）
- 根拠のない数値・最上級（No.1・最安など）・効果の断定・誇大な表現は使わない

その他:
- subject: 横長のバナーで写真を置く側 left / right（type は center）。パターン間で left と right を混ぜる
- label は日本語 16字以内、concept は日本語 50字以内

出力: {"patterns":[{"archetype":"offer","subject":"left","label":"","concept":"","prompt":"","motion":"","useMaterials":false,"copy":{"target":"","headline":["",""],"emphasis":"","emphasisLabel":"","sub":"","cta":""}}]}`;

export type PatternDeps = { ask: (system: string, user: string) => Promise<unknown> };
export const defaultPatternDeps = (): PatternDeps => ({ ask: (s, u) => askJson(s, u, { maxTokens: 4500, timeoutMs: 120_000 }) });

const clip = (v: unknown, n: number) => normalizeJapanese(String(v ?? "")).trim().slice(0, n);

/** 数字・特典が、与えた事実（説明・強み）に書かれているか。書かれていない数字は出さない */
function grounded(emphasis: string, facts: string): boolean {
  const nums = emphasis.match(/[0-9０-９][0-9０-９,.，．]*/g);
  if (!nums) return true;
  const flat = normalizeJapanese(facts).replace(/[,，]/g, "");
  return nums.every((n) => flat.includes(normalizeJapanese(n).replace(/[,，]/g, "")));
}

function readCopy(raw: unknown, facts: string): PatternCopy {
  const c = (raw ?? {}) as Record<string, unknown>;
  const h = Array.isArray(c.headline) ? c.headline : [];
  let emphasis = clip(c.emphasis, 12);
  let emphasisLabel = clip(c.emphasisLabel, 12);
  if (emphasis && !grounded(emphasis, facts)) {
    emphasis = "";
    emphasisLabel = "";
  }
  return {
    target: clip(c.target, 18),
    headline: [clip(h[0], 14), clip(h[1], 14)],
    emphasis,
    emphasisLabel,
    sub: clip(c.sub, 30),
    cta: clip(c.cta, 10) || "詳しく見る",
  };
}

export async function planPatterns(
  d: Diagnosis,
  description: string,
  materials: BannerMaterial[],
  deps: PatternDeps = defaultPatternDeps()
): Promise<BannerPattern[]> {
  const kinds = { product: "商品写真", logo: "ロゴ", photo: "写真" } as const;
  const facts = [d.product, ...d.strengths, description].join(" / ");
  const user = [
    `商材: ${d.product}`,
    `ターゲット: ${d.audience}`,
    `強み（事実）: ${d.strengths.slice(0, 6).join(" / ")}`,
    `買わない理由: ${d.objections.slice(0, 4).join(" / ")}`,
    `ブランド: ${d.brand.name}（トーン：${d.brand.tone}／ブランド色：${d.brand.accent}）`,
    description ? `担当者からの説明（事実）: ${description.slice(0, 1200)}` : "",
    `素材: ${materials.length ? materials.map((m) => `${kinds[m.kind]}（${m.name}）`).join("、") : "なし"}`,
    d.brand.ngWords?.length ? `使用禁止語: ${d.brand.ngWords.join("、")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const raw = (await deps.ask(SYSTEM, user)) as { patterns?: Record<string, unknown>[] };
  const hasProduct = materials.some((m) => m.kind !== "logo");
  const out: BannerPattern[] = [];
  for (const [i, p] of (Array.isArray(raw?.patterns) ? raw.patterns : []).entries()) {
    const prompt = String(p?.prompt ?? "").trim();
    if (prompt.length < 20) continue;
    let archetype: Archetype = isArchetype(p?.archetype) ? p.archetype : "scene";
    const copy = readCopy(p?.copy, facts);
    // 数字・実績の型なのに、事実で裏づけられる数字が無いときは「利用シーン」に落とす
    if ((archetype === "number" || archetype === "proof") && !copy.emphasis) archetype = "scene";
    const side = String(p?.subject ?? "");
    const subject: SubjectSide = archetype === "type" ? "center" : side === "right" ? "right" : side === "center" ? "center" : "left";
    out.push({
      key: `p${out.length + 1}`,
      label: clip(p?.label ?? `パターン${i + 1}`, 24) || ARCHETYPES[archetype].label,
      concept: clip(p?.concept, 80),
      prompt: prompt.slice(0, 900),
      motion: String(p?.motion ?? "slow cinematic push-in, soft natural light movement").trim().slice(0, 300),
      // 素材が無いのに素材を使う指定は外す。文字が主役の型は素材を使わない
      useMaterials: hasProduct && archetype !== "type" && p?.useMaterials === true,
      archetype,
      subject,
      copy,
    });
    if (out.length >= PATTERN_COUNT) break;
  }
  if (!out.length) throw new Error("絵のパターンを決められませんでした");
  return out;
}

export type GuardFn = (texts: string[], industry: Industry) => Promise<GuardVerdict>;

/** パターン専用のコピーに法令チェックをかける（生成と同時に通す。1本の失敗で他を落とさない） */
export async function guardPatterns(patterns: BannerPattern[], industry: Industry, guard: GuardFn = checkGuard): Promise<BannerPattern[]> {
  const res = await Promise.allSettled(
    patterns.map((p) => {
      const c = p.copy;
      if (!c) return Promise.resolve(undefined);
      const texts = [c.target, c.headline.join(""), c.emphasis, c.emphasisLabel, c.sub, c.cta].filter(Boolean);
      return guard(texts, industry);
    })
  );
  return patterns.map((p, i) => {
    const r = res[i];
    if (!p.copy) return p;
    const verdict: GuardVerdict =
      r.status === "fulfilled" && r.value
        ? r.value
        : { level: "yellow", hits: [{ text: "", reason: "法令チェックを実行できませんでした。人が確認してください", law: "", suggestion: "", severity: "medium" }] };
    return { ...p, copy: { ...p.copy, guard: verdict } };
  });
}

/**
 * 構図の指示。写真はレイアウト（左右分割・上下分割・文字カード）で文字と分けて置くので、
 * 主役は中央やや上に、周りに余白を取って作る（どのレイアウトで切っても余白だけが切れ、主役が隠れない）。
 */
function composition(p: BannerPattern | null, aspect: string): string {
  if (p?.archetype === "type") {
    return "Composition: an abstract, uncluttered background with gentle texture and soft light; keep the center calm and evenly lit so large text can sit on top. No objects.";
  }
  const a = aspectValue(aspect);
  const frame = a < 0.9 ? "vertical" : a > 1.2 ? "horizontal" : "square";
  return `Composition: ${frame} frame. Center the main subject horizontally and place it slightly above the vertical center, fully visible and clearly recognizable, occupying about 50-60% of the frame. Keep generous calm margins on every side (especially the bottom 30%), with no important details near the edges, so the image can be cropped to other shapes without cutting the subject.`;
}

/** 画像モデルに渡す最終の指示 */
export function imagePrompt(p: BannerPattern, aspect = "1:1"): string {
  const lead = p.useMaterials
    ? "Use the product shown in the reference image(s) exactly as it is — do not change its shape, color, label or packaging design. Place it naturally in this scene: "
    : "";
  return `${lead}${p.prompt}\n\n${composition(p, aspect)}\n\n${NO_TEXT}`;
}

/** 縦横比を変えて作り直すときの指示（元の絵を保つ。構図は新しい縦横比に合わせる） */
export function reframePrompt(p: BannerPattern | null, aspect = "1:1"): string {
  return `Recompose this exact image for a new aspect ratio. Keep the same subject, product, style, colors and lighting; extend the background naturally and keep the main subject fully visible and large. ${composition(p, aspect)} ${p ? `Scene: ${p.prompt.slice(0, 300)}` : ""}\n\n${NO_TEXT}`;
}

export function videoPrompt(p: BannerPattern | null): string {
  return `${p?.motion || "slow cinematic push-in, subtle natural movement"}. Keep the product and subject unchanged and in the same position. No text, no captions, no logos appear.`;
}
