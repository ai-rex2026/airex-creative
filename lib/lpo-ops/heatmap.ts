import { askJson, askJsonWithImages } from "../anthropic";
import { normalizeJapanese } from "../meo-ops/japanese";
import type { LpoPlan } from "../deep";
import type { Diagnosis } from "../types";
import type { SpeedScan } from "../pagespeed";
import { planItems, type ClarityMetric, type HeatmapAnalysis, type HeatmapProposal } from "./types";

/**
 * ヒートマップから LP の改善案を書く（2026-11-11。AI 1回）。
 * - Clarity：URL ごとの数字（スクロール深度・デッドクリック・レイジクリック・クイックバックなど）
 * - 画像：ヒートマップツール（Hotjar・Ptengine など）の画面キャプチャ。読めるモデル（Sonnet）に渡す
 * 根拠の無い数字・効果の約束は書かせない。既にある LP 改善と重ならない、ヒートマップから言えることを優先する。
 */

const SYSTEM = `あなたはランディングページ改善（LPO）の実務者です。ヒートマップの結果から、LP の具体的な改善案を書きます。

読み方（当てはまるものだけ使う）:
- スクロール：途中で急に読まれなくなる位置があれば、その直前の段（長すぎる説明・興味の切れる見出し・重い画像）を疑う。大事な情報（料金・CTA・実績）が読まれない位置にあれば上へ移す
- クリック：リンクでない画像・文字が押されている（デッドクリック）→ リンクにするか、押せそうに見えない見た目にする。同じ所の連打（レイジクリック）→ 反応しない・遅いボタンやフォームを疑う。CTA があまり押されていない → 文言・位置・色・数を見直す
- アテンション：よく見られている段に CTA や証拠（実績・口コミ）を寄せる。見られていない段は削るか下げる
- クイックバック（すぐ戻る）・過剰スクロール：ファーストビューで何のページか伝わらない、探している情報が見つからないことを疑う

ルール:
- 与えたデータ（数字・画像に写っているもの）に無い事実や数字を作らない。画像で読み取れない所は推測で書かない
- 根拠（why）は「どの数字か」「ヒートマップのどこ（上から何割の位置、どの段・ボタン）か」を具体的に書く
- 「必ず上がる」「確実に」「No.1」など効果を約束する表現を使わない
- 既にある LP 改善の指摘と同じものは出さない（ヒートマップから新しく言えることを優先する）
- findings は2〜5件、proposals は3〜6件。impact は 大/中/小。steps は2〜4個の具体的な手順
- 日本語の文章で通常使う漢字だけで書く

出力: {"findings":["ヒートマップから分かったこと"],"proposals":[{"title":"改善案（40字以内）","where":"LP のどこか（20字以内）","why":"根拠（150字以内）","steps":["手順"],"impact":"中"}]}`;

export type HeatmapContext = {
  url: string;
  diagnosis: Diagnosis | null;
  plan: LpoPlan | null;
  speed: SpeedScan | null;
};

export type HeatmapDeps = {
  ask: (system: string, user: string) => Promise<unknown>;
  askImages: (system: string, user: string, images: { media: string; base64: string }[]) => Promise<unknown>;
};

/** 画像は細部を読ませるため品質側のモデルにする */
const VISION_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

export const defaultHeatmapDeps = (): HeatmapDeps => ({
  ask: (s, u) => askJson(s, u, { maxTokens: 3500, timeoutMs: 120_000 }),
  askImages: (s, u, im) => askJsonWithImages(s, u, im, { maxTokens: 3500, timeoutMs: 150_000, model: VISION_MODEL, forceAnthropic: true }),
});

function contextLines(c: HeatmapContext): string[] {
  const d = c.diagnosis;
  const done = (c.plan?.groups ?? []).flatMap((g) => planItems(g).map((x) => `- ${g.area}：${x.text}`)).slice(0, 20);
  const sp = c.speed && (c.speed.score !== null || c.speed.field.length || c.speed.lab.length)
    ? `表示速度（PageSpeed Insights・モバイル）: スコア ${c.speed.score ?? "—"}／${(c.speed.field.length ? c.speed.field : c.speed.lab).map((m) => `${m.label} ${m.value}`).join("、")}`
    : "表示速度: 未計測";
  return [
    `# LP`,
    `URL: ${c.url}`,
    d ? `何を売っているか: ${d.product}` : "",
    d ? `誰に売るか: ${d.audience}` : "",
    sp,
    `# 既にある LP 改善の指摘（重ねない）`,
    done.length ? done.join("\n") : "（なし）",
  ].filter(Boolean);
}

function clean(raw: unknown): HeatmapAnalysis {
  const r = (raw ?? {}) as { findings?: unknown[]; proposals?: Record<string, unknown>[] };
  const ng = /必ず|確実に|No\.?1|ナンバーワン|絶対/;
  const t = (v: unknown, n: number) => normalizeJapanese(String(v ?? "").trim()).slice(0, n);
  const findings = (Array.isArray(r.findings) ? r.findings : []).map((f) => t(f, 200)).filter((f) => f && !ng.test(f)).slice(0, 5);
  const proposals: HeatmapProposal[] = (Array.isArray(r.proposals) ? r.proposals : [])
    .map((p) => ({
      title: t(p?.title, 80),
      where: t(p?.where, 40),
      why: t(p?.why, 300),
      steps: (Array.isArray(p?.steps) ? (p.steps as unknown[]) : []).map((s) => t(s, 160)).filter(Boolean).slice(0, 4),
      impact: (["大", "中", "小"].includes(String(p?.impact)) ? p.impact : "中") as HeatmapProposal["impact"],
    }))
    .filter((p) => p.title && !ng.test(`${p.title}${p.why}`))
    .slice(0, 6);
  if (!proposals.length) throw new Error("改善案を作れませんでした");
  return { findings, proposals };
}

/** Clarity の数字から */
export async function analyzeClarity(c: HeatmapContext, metrics: ClarityMetric[], deps: HeatmapDeps = defaultHeatmapDeps()): Promise<HeatmapAnalysis> {
  const lines = [
    ...contextLines(c),
    `# Microsoft Clarity の数字（この LP の URL・直近3日）`,
    ...metrics.map((m) => `- ${m.metric}: ${Object.entries(m.values).map(([k, v]) => `${k}=${v}`).join("、")}`),
  ];
  return clean(await deps.ask(SYSTEM, lines.join("\n")));
}

/** ヒートマップの画像から（縦長の画像は画面側で上から順に分割して渡す） */
export async function analyzeHeatmapImages(
  c: HeatmapContext,
  kind: string,
  tool: string,
  images: { media: string; base64: string }[],
  deps: HeatmapDeps = defaultHeatmapDeps()
): Promise<HeatmapAnalysis> {
  const kindLabel = kind === "scroll" ? "スクロールヒートマップ（どこまで読まれたか）" : kind === "click" ? "クリックヒートマップ（どこが押されたか）" : kind === "attention" ? "アテンションヒートマップ（どこがよく見られたか）" : "ヒートマップ";
  const lines = [
    ...contextLines(c),
    `# 画像`,
    `${tool ? `${tool} の` : ""}${kindLabel}の画面キャプチャです。${images.length > 1 ? `縦に長いため上から順に ${images.length} 枚に分けています（画像 0 が一番上）。` : ""}`,
    "色の濃さ・数字・割合の表示など、画像に写っているものだけから読み取ってください。",
  ];
  return clean(await deps.askImages(SYSTEM, lines.join("\n"), images));
}
