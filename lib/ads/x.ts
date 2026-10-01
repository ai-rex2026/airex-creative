/**
 * X（旧 Twitter）広告：広告アカウント一覧・キャンペーン別実績（読み取りのみ）。
 *
 * Ads API は OAuth 1.0a（lib/ads/oauth.ts の xSignedGet・oauth1Header）。トークンに有効期限が
 * 無いため更新処理は無い（lib/ads/tokens.ts の refreshAllAdTokens で x は明示的に除外されている）。
 *
 * 実績は /stats/accounts/{account_id}（CAMPAIGN エンティティ、granularity=DAY）から取る。
 * この同期 stats エンドポイントは一度に渡せる entity_ids が最大20件という制限があるため、
 * キャンペーンが多いアカウントではチャンクに分けて呼ぶ。
 *
 * コンバージョン（Webサイトのコンバージョンタグ等）はアカウントの計測設定に形が強く依存し、
 * 本番の実アカウントで検証できていないため、v1 では費用・表示回数・クリックのみを扱い、
 * CV・CV値は 0 として返す（画面側は Meta 広告などと同じ表示で、CPA は「—」になる）。
 * 実アカウントで確認でき次第、metric_groups に WEB_CONVERSION 等を足して対応する。
 */

import { xSignedGet } from "./oauth";

const X_ADS_BASE = process.env.X_ADS_API_BASE || "https://ads-api.x.com/12";

type XTokens = { token: string; tokenSecret: string };

function apiError(j: Record<string, unknown>, res: Response): string {
  const errors = j.errors as { message?: string }[] | undefined;
  return errors?.[0]?.message ?? (j.error as string | undefined) ?? `HTTP ${res.status}`;
}

export type XPickerAccount = { id: string; name: string };

/** 選択画面用に、このトークンでアクセスできる広告アカウント一覧を取り直す（lib/ads/accounts.ts の "x" ケースと同じ取得） */
export async function xAdAccounts(accessToken: string, tokenSecret: string): Promise<XPickerAccount[]> {
  const res = await xSignedGet(`${X_ADS_BASE}/accounts`, { token: accessToken, tokenSecret });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(apiError(j, res));
  const rows: { id: string; name?: string }[] = j.data ?? [];
  return rows.map((r) => ({ id: r.id, name: r.name ?? r.id }));
}

type XCampaign = { id: string; name: string };

async function listCampaigns(accountId: string, tokens: XTokens): Promise<XCampaign[]> {
  const out: XCampaign[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 10; i++) {
    const res = await xSignedGet(`${X_ADS_BASE}/accounts/${accountId}/campaigns`, tokens, {
      count: "200",
      with_deleted: "false",
      ...(cursor ? { cursor } : {}),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(apiError(j, res));
    const rows: { id: string; name?: string }[] = j.data ?? [];
    out.push(...rows.map((r) => ({ id: r.id, name: r.name ?? r.id })));
    cursor = (j.next_cursor as string | null | undefined) ?? undefined;
    if (!cursor) break;
  }
  return out;
}

const addDay = (ymd: string) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

const numOf = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" ? Number(v) || 0 : 0);

/** 配列中の null（未配信日）を 0 として合計する */
function sumSeries(series: unknown): number {
  if (!Array.isArray(series)) return 0;
  return (series as unknown[]).reduce((s: number, v) => s + numOf(v), 0);
}

export type XCampaignMetric = {
  id: string;
  name: string;
  cost: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionsValue: number;
};

export type XDailyMetric = {
  date: string;
  cost: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionsValue: number;
};

type StatsRow = {
  id: string;
  id_data?: { metrics?: Record<string, (number | string | null)[] | null> }[];
};

async function fetchStatsChunk(
  accountId: string,
  ids: string[],
  tokens: XTokens,
  startTime: string,
  endTime: string
): Promise<StatsRow[]> {
  const res = await xSignedGet(`${X_ADS_BASE}/stats/accounts/${accountId}`, tokens, {
    entity: "CAMPAIGN",
    entity_ids: ids.join(","),
    metric_groups: "ENGAGEMENT,BILLING",
    placement: "ALL_ON_TWITTER",
    granularity: "DAY",
    start_time: startTime,
    end_time: endTime,
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(apiError(j, res));
  return (j.data ?? []) as StatsRow[];
}

/**
 * キャンペーン別（期間合計）と、アカウント合計の日別。accountId は xAdAccounts が返す ID そのまま。
 * tokenSecret は OAuth 1.0a のトークンシークレット（getAdCredentials の戻り値の tokenSecret。
 * 他媒体には無いフィールドなので、呼び出し側で null でないことを確かめてから渡す）。
 */
export async function fetchCampaignMetrics(
  accessToken: string,
  tokenSecret: string,
  accountId: string,
  from: string,
  to: string
): Promise<{ campaigns: XCampaignMetric[]; daily: XDailyMetric[] }> {
  const tokens: XTokens = { token: accessToken, tokenSecret };
  const campaigns = await listCampaigns(accountId, tokens);
  if (campaigns.length === 0) return { campaigns: [], daily: [] };

  const startTime = `${from}T00:00:00Z`;
  const endTime = `${addDay(to)}T00:00:00Z`;
  const dayCount = Math.max(1, Math.round((Date.parse(endTime) - Date.parse(startTime)) / 86_400_000));
  const dates = Array.from({ length: dayCount }, (_, i) => {
    const d = new Date(`${from}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });

  const chunks: XCampaign[][] = [];
  for (let i = 0; i < campaigns.length; i += 20) chunks.push(campaigns.slice(i, i + 20));

  const nameById = new Map(campaigns.map((c) => [c.id, c.name]));
  const campaignOut: XCampaignMetric[] = [];
  const dailyTotals: XDailyMetric[] = dates.map((date) => ({
    date,
    cost: 0,
    impressions: 0,
    clicks: 0,
    conversions: 0,
    conversionsValue: 0,
  }));

  for (const chunk of chunks) {
    const rows = await fetchStatsChunk(accountId, chunk.map((c) => c.id), tokens, startTime, endTime);
    for (const row of rows) {
      const metrics = row.id_data?.[0]?.metrics ?? {};
      const impressions = metrics.impressions ?? [];
      const clicks = metrics.clicks ?? [];
      const billed = metrics.billed_charge_local_micro ?? [];
      campaignOut.push({
        id: row.id,
        name: nameById.get(row.id) ?? row.id,
        cost: sumSeries(billed) / 1_000_000,
        impressions: sumSeries(impressions),
        clicks: sumSeries(clicks),
        conversions: 0,
        conversionsValue: 0,
      });
      dates.forEach((_, i) => {
        dailyTotals[i].cost += numOf(billed?.[i]) / 1_000_000;
        dailyTotals[i].impressions += numOf(impressions?.[i]);
        dailyTotals[i].clicks += numOf(clicks?.[i]);
      });
    }
  }

  return {
    campaigns: campaignOut.sort((a, b) => b.cost - a.cost),
    daily: dailyTotals,
  };
}
