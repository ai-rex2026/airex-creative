import type { LpoPlan, LpoGroup } from "../deep";
import type { SpeedScan, SpeedMetric } from "../pagespeed";

/**
 * LPO運用（2026-11-11）。左メニュー「LPO運用」（/lpo）。LP ごとに
 * LP改善（plan）・表示速度改善（speed）・ヒートマップ分析（lpo_heatmaps）・効果を回す。
 * 画面（client）からも読むので、サーバー専用のものは import しない。
 */

/** ヒートマップ画像の置き場（非公開） */
export const HEATMAP_BUCKET = "lpo-heatmaps";

export type LpoSpeedPoint = {
  at: string;
  score: number | null;
  metrics: Pick<SpeedMetric, "id" | "label" | "value" | "rating">[];
};

export type LpoProject = {
  id: string;
  name: string;
  url: string;
  analysisId: string | null;
  plan: LpoPlan | null;
  planDone: string[];
  speed: SpeedScan | null;
  speedHistory: LpoSpeedPoint[];
  buildError: string | null;
  hasDiagnosis: boolean;
  createdAt: string;
  updatedAt: string;
};

/** Clarity の指標1つ分（LP の URL に当たる行の値） */
export type ClarityMetric = { metric: string; values: Record<string, string | number> };

export type HeatmapProposal = {
  title: string;
  /** LP のどこを直すか（ファーストビュー・料金の段・フォームなど） */
  where: string;
  /** 根拠（どの数字・ヒートマップのどこから言えるか） */
  why: string;
  steps: string[];
  impact: "大" | "中" | "小";
};

export type HeatmapAnalysis = { findings: string[]; proposals: HeatmapProposal[] };

export type LpoHeatmap = {
  id: string;
  source: "clarity" | "image";
  kind: string;
  tool: string;
  metrics: ClarityMetric[] | null;
  images: string[];
  analysis: HeatmapAnalysis | null;
  error: string | null;
  createdAt: string;
};

export const HEATMAP_KIND_LABEL: Record<string, string> = {
  metrics: "Clarity の数字",
  scroll: "スクロール（どこまで読まれたか）",
  click: "クリック（どこが押されたか）",
  attention: "アテンション（どこがよく見られたか）",
};

/** 改善の1件を表す key（済みの管理に使う。文言が同じなら同じ key） */
export function planItemKey(area: string, text: string): string {
  let h = 0;
  const s = `${area}|${text}`;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return `i${(h >>> 0).toString(36)}`;
}

export function planItems(g: LpoGroup): { key: string; text: string; severity: string | null }[] {
  return (g.items ?? []).map((x) => {
    const text = typeof x === "string" ? x : x.text;
    return { key: planItemKey(g.area, text), text, severity: typeof x === "string" ? null : x.severity };
  });
}

/** 速度の記録1件（最新の計測から） */
export function speedPoint(s: SpeedScan): LpoSpeedPoint | null {
  if (s.score === null && s.field.length === 0 && s.lab.length === 0) return null;
  const metrics = (s.field.length > 0 ? s.field : s.lab).map((m) => ({ id: m.id, label: m.label, value: m.value, rating: m.rating }));
  return { at: s.fetchedAt || new Date().toISOString(), score: s.score, metrics };
}

export const LPO_PROJECT_COLUMNS = "id, name, url, analysis_id, plan, plan_done, speed, speed_history, build_error, diagnosis, created_at, updated_at";

export function rowToLpoProject(r: Record<string, unknown>): LpoProject {
  return {
    id: String(r.id),
    name: String(r.name ?? ""),
    url: String(r.url ?? ""),
    analysisId: (r.analysis_id as string | null) ?? null,
    plan: (r.plan as LpoPlan | null) ?? null,
    planDone: Array.isArray(r.plan_done) ? (r.plan_done as string[]) : [],
    speed: (r.speed as SpeedScan | null) ?? null,
    speedHistory: Array.isArray(r.speed_history) ? (r.speed_history as LpoSpeedPoint[]) : [],
    buildError: (r.build_error as string | null) ?? null,
    hasDiagnosis: !!r.diagnosis,
    createdAt: String(r.created_at ?? ""),
    updatedAt: String(r.updated_at ?? ""),
  };
}

export const LPO_HEATMAP_COLUMNS = "id, source, kind, tool, metrics, images, analysis, error, created_at";

export function rowToHeatmap(r: Record<string, unknown>): LpoHeatmap {
  return {
    id: String(r.id),
    source: r.source === "clarity" ? "clarity" : "image",
    kind: String(r.kind ?? ""),
    tool: String(r.tool ?? ""),
    metrics: (r.metrics as ClarityMetric[] | null) ?? null,
    images: Array.isArray(r.images) ? (r.images as string[]) : [],
    analysis: (r.analysis as HeatmapAnalysis | null) ?? null,
    error: (r.error as string | null) ?? null,
    createdAt: String(r.created_at ?? ""),
  };
}
