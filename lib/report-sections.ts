import type { MediaPlanItem } from "./types";

/**
 * レポートの表示設定と、利用者からの作り直しの指示（2026-11-09）。
 * analyses.report_prefs に保存する。チャット（lib/chat.ts）から変える。
 *
 * - hidden：非表示にする章（下の REPORT_SECTIONS の id）。画面と PDF（印刷）の両方で隠す。データは消さない
 * - directives：作り直すときに AI へ必ず渡す指示（例：「Meta 広告は配信しない前提で」）。以後の作り直しでも効く
 * - excludeChannels：広告手法一覧から外す媒体。AI が指示を守らなくても、コードで外す
 */
export type ReportPrefs = { hidden?: string[]; directives?: string[]; excludeChannels?: string[] };

/** 隠せる章。id は画面の見出しの id（sec-xxx）の xxx */
export const REPORT_SECTIONS: { id: string; label: string }[] = [
  { id: "linked", label: "連携データ" },
  { id: "persona", label: "お客様像" },
  { id: "overview", label: "サイト概要" },
  { id: "strength", label: "強みと、買わない理由" },
  { id: "angles", label: "訴求軸" },
  { id: "risk", label: "リスクと注意点" },
  { id: "tags", label: "計測タグの導入状況" },
  { id: "plan", label: "広告手法一覧" },
  { id: "pubads", label: "出稿中の広告（公開情報）" },
  { id: "adreview", label: "出稿中の広告のレビュー" },
  { id: "adops", label: "広告運用設計" },
  { id: "seo", label: "ドメインパワー（SEO強度）" },
  { id: "kw", label: "対策キーワード" },
  { id: "seoart", label: "SEO記事設計" },
  { id: "suggest", label: "検索サジェスト" },
  { id: "meo", label: "MEO（Googleマップ対策）" },
  { id: "lpo", label: "LP改善" },
  { id: "speed", label: "表示速度" },
  { id: "social", label: "公式SNSアカウント" },
  { id: "outreach", label: "外部施策" },
  { id: "sched", label: "実行スケジュール" },
  { id: "aio", label: "AI検索での見え方（AIO）" },
  { id: "category-eval", label: "カテゴリ別評価" },
  { id: "measures", label: "優先度の高い施策" },
  { id: "cpa", label: "CPAはいくらまで出せるか" },
  { id: "log", label: "実施した施策の記録" },
];

const SECTION_IDS = new Set(REPORT_SECTIONS.map((s) => s.id));
const squash = (s: string) => s.normalize("NFKC").replace(/[\s（）()・、!！]/g, "").toLowerCase();

/** 章の id か見出しの文言から、章の id を引く（見つからなければ null） */
export function sectionIdOf(v: string): string | null {
  const x = v.trim().replace(/^#?sec-/, "");
  if (SECTION_IDS.has(x)) return x;
  const q = squash(v);
  if (!q) return null;
  const hit = REPORT_SECTIONS.find((s) => squash(s.label) === q) ?? REPORT_SECTIONS.find((s) => squash(s.label).startsWith(q) || q.startsWith(squash(s.label)));
  return hit?.id ?? null;
}

export function sectionLabel(id: string): string {
  return REPORT_SECTIONS.find((s) => s.id === id)?.label ?? id;
}

/** チャットが出す「作り直しの提案」。押すまで作り直さない（作り直すと前の内容が置き換わるため） */
export type RebuildProposal = {
  target: "ad_plan" | "measures";
  /** 作り直すときに AI に渡す指示（以後の作り直しでも効く） */
  instruction: string;
  /** 広告手法一覧から外す媒体 */
  excludeChannels: string[];
};

export const REBUILD_LABEL: Record<RebuildProposal["target"], string> = {
  ad_plan: "広告手法一覧・広告運用設計・広告以外の施策と実行スケジュール",
  measures: "優先度の高い施策とカテゴリ別評価",
};

const MAX_DIRECTIVES = 10;

/** 指示を足す（同じものは足さない。古いものから捨てて最大10件） */
export function addDirective(prefs: ReportPrefs | null | undefined, text: string): ReportPrefs {
  const t = text.replace(/\s+/g, " ").trim().slice(0, 300);
  const cur = prefs?.directives ?? [];
  if (!t || cur.includes(t)) return { ...(prefs ?? {}) };
  return { ...(prefs ?? {}), directives: [...cur, t].slice(-MAX_DIRECTIVES) };
}

export function addExcluded(prefs: ReportPrefs | null | undefined, channels: string[]): ReportPrefs {
  const cur = prefs?.excludeChannels ?? [];
  const next = [...cur];
  for (const c of channels.map((x) => x.trim()).filter(Boolean)) if (!next.some((n) => squash(n) === squash(c))) next.push(c.slice(0, 40));
  return { ...(prefs ?? {}), excludeChannels: next.slice(0, 12) };
}

/** AI へ渡す指示の文（無ければ空） */
export function directiveNote(prefs: ReportPrefs | null | undefined): string {
  const lines = [...(prefs?.directives ?? [])];
  const ex = prefs?.excludeChannels ?? [];
  if (ex.length) lines.push(`次の広告媒体は使わない（提案・配分・スケジュールに入れない）：${ex.join("、")}`);
  if (!lines.length) return "";
  return `【利用者からの指示（最優先で必ず守る。ほかの指示と食い違うときはこちらに従う）】\n${lines.map((l) => `- ${l}`).join("\n")}`;
}

/** 二つの注記をつなぐ */
export function joinNotes(...notes: (string | undefined | null)[]): string | undefined {
  const s = notes.filter((n): n is string => !!n && !!n.trim()).join("\n\n");
  return s || undefined;
}

/** その媒体を外す対象か（「Meta」で「Meta広告」を、「Yahoo」で Yahoo! の2種を外す） */
export function isExcludedChannel(channel: string, exclude: string[]): boolean {
  const c = squash(channel);
  return exclude.some((e) => {
    const x = squash(e).replace(/広告$/, "");
    return !!x && (c.includes(x) || x.includes(c.replace(/広告$/, "")));
  });
}

/** 外す媒体を除き、配分を合計100に直す。最優先が消えたら先頭を最優先にする */
export function applyExcludedChannels(plan: MediaPlanItem[], exclude: string[] | undefined): MediaPlanItem[] {
  if (!exclude?.length) return plan;
  const kept = plan.filter((p) => !isExcludedChannel(p.channel, exclude));
  if (kept.length === plan.length || kept.length === 0) return kept;
  const total = kept.reduce((s, p) => s + (p.share || 0), 0);
  let out = kept.map((p) => ({ ...p, share: total > 0 ? Math.round(((p.share || 0) / total) * 100) : Math.round(100 / kept.length) }));
  const diff = 100 - out.reduce((s, p) => s + p.share, 0);
  out[0] = { ...out[0], share: out[0].share + diff };
  if (!out.some((p) => p.priority === "最優先")) out = out.map((p, i) => (i === 0 ? { ...p, priority: "最優先" } : p));
  return out;
}
