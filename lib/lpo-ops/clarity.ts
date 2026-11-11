import type { ClarityMetric } from "./types";

/**
 * Microsoft Clarity の Data Export API（2026-11-11）。
 * GET https://www.clarity.ms/export-data/api/v1/project-live-insights?numOfDays=3&dimension1=URL
 * - 直近1〜3日分だけ。1プロジェクト1日10回まで（超えると 429）。最大1,000行・ページ送りなし
 * - ヒートマップの画像・クリック座標は取れない（指標の数字だけ）
 * 返り値は [{ metricName, information: [{ ...値, Url: "..." }] }]。指標ごとに値の項目名が違うため、
 * 項目名は決め打ちせず、LP の URL に当たる行の値をそのまま持つ。
 */

export const CLARITY_ENDPOINT = "https://www.clarity.ms/export-data/api/v1/project-live-insights";
/** 1日10回の上限に余裕を持たせ、同じ対象は 20時間に1回まで */
export const CLARITY_MIN_INTERVAL_MS = 20 * 60 * 60 * 1000;

export type ClarityFetch = (url: string, init: RequestInit) => Promise<Response>;

/** URL の比較用（プロトコル・www・末尾の / ・クエリ・ハッシュを無視） */
export function normPageUrl(u: string): string {
  const s = String(u ?? "").trim();
  try {
    const x = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    return `${x.hostname.toLowerCase().replace(/^www\./, "")}${x.pathname.replace(/\/+$/, "") || ""}`;
  } catch {
    return s.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[?#].*$/, "").replace(/\/+$/, "");
  }
}

const urlKeyOf = (row: Record<string, unknown>) => Object.keys(row).find((k) => /^url$/i.test(k)) ?? null;

/** API の返り値から、LP の URL に当たる行だけを取り出す */
export function pickClarityRows(raw: unknown, pageUrl: string): { metrics: ClarityMetric[]; urlsSeen: number } {
  const target = normPageUrl(pageUrl);
  const out: ClarityMetric[] = [];
  const seen = new Set<string>();
  for (const m of Array.isArray(raw) ? raw : []) {
    const name = String((m as { metricName?: unknown })?.metricName ?? "").trim();
    const info = (m as { information?: unknown })?.information;
    if (!name || !Array.isArray(info)) continue;
    for (const row of info as Record<string, unknown>[]) {
      const k = urlKeyOf(row ?? {});
      if (!k) continue;
      const u = normPageUrl(String(row[k] ?? ""));
      seen.add(u);
      if (u !== target) continue;
      const values: Record<string, string | number> = {};
      for (const [key, v] of Object.entries(row)) {
        if (key === k) continue;
        if (typeof v === "number" || typeof v === "string") values[key] = v;
      }
      // 同じ指標に同じ URL の行が複数ある（クエリ違い等）ときは、最初の行を使う
      if (!out.some((x) => x.metric === name)) out.push({ metric: name, values });
    }
  }
  return { metrics: out, urlsSeen: seen.size };
}

/** Clarity から直近3日分を取る。エラーは日本語の理由にして投げる */
export async function fetchClarity(token: string, pageUrl: string, fetcher: ClarityFetch = fetch): Promise<{ metrics: ClarityMetric[]; urlsSeen: number }> {
  const url = `${CLARITY_ENDPOINT}?numOfDays=3&dimension1=URL`;
  const res = await fetcher(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 401) throw new Error("Clarity の API トークンが無効か期限切れです。Clarity の設定 → データのエクスポートで発行し直してください");
  if (res.status === 403) throw new Error("この API トークンではデータを読めません（Clarity のプロジェクトの管理者が発行したトークンか確認してください）");
  if (res.status === 429) throw new Error("Clarity の1日の取得回数（1プロジェクト10回）を超えました。明日もう一度取得してください");
  if (!res.ok) throw new Error(`Clarity からデータを取れませんでした（HTTP ${res.status}）`);
  const raw = await res.json().catch(() => null);
  return pickClarityRows(raw, pageUrl);
}
