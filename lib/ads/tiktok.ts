/**
 * TikTok 広告：広告アカウント一覧・キャンペーン別実績（読み取りのみ）。
 *
 * 認可・トークン交換は lib/ads/oauth.ts（buildAuthUrl/exchangeCode の "tiktok" ケース）、
 * 連携直後のアカウント発見は lib/ads/accounts.ts（discoverAccounts の "tiktok" ケース）で
 * すでに実装済み。ここは「選択画面でのアカウント再取得」と「実績取得」だけを持つ
 * （Meta・Microsoft・X と同じ、MCC概念の無いフラットな広告アカウント一覧の媒体）。
 *
 * TikTok のアクセストークンには期限が無い（lib/ads/oauth.ts のコメント参照）ため、
 * refreshTokens（lib/ads/tokens.ts）は tiktok を対象外にしている。
 *
 * 実アカウントでの実績取得（report/integrated/get/）は未検証（2026-10時点、承認直後で
 * 実際の配信実績が無いため）。TikTok Marketing API のドキュメント上の仕様に基づいて実装し、
 * 他媒体（Meta・X）と同じ形に正規化している。コンバージョン値（売上額）を表す汎用的な
 * 指標が無いため、Google/Meta/Microsoft のような conversionsValue は 0 固定とする
 * （X の total_onsite_shopping_value 相当の扱い。実アカウントで確認できた指標があれば調整する）。
 */

const BASE = "https://business-api.tiktok.com/open_api/v1.3";

const env = (k: string) => process.env[k] ?? "";

async function tiktokGet(path: string, accessToken: string, params: Record<string, string>) {
  const url = `${BASE}${path}?${new URLSearchParams(params)}`;
  const res = await fetch(url, {
    headers: { "Access-Token": accessToken },
    signal: AbortSignal.timeout(20000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.code !== 0) {
    throw new Error(`TikTok 広告 API エラー：${j.message ?? `HTTP ${res.status}`}`);
  }
  return j.data as Record<string, unknown>;
}

export type TiktokPickerAccount = { id: string; name: string };

/** 選択画面用に、このアクセストークンでアクセスできる広告主（advertiser）一覧を取り直す
 *（lib/ads/accounts.ts の discoverAccounts "tiktok" ケースと同じ取得。app_id/secret はクエリに付与する） */
export async function tiktokAdAccounts(accessToken: string): Promise<TiktokPickerAccount[]> {
  const data = await tiktokGet("/oauth2/advertiser/get/", accessToken, {
    app_id: env("TIKTOK_APP_ID"),
    secret: env("TIKTOK_SECRET"),
  });
  const rows = (data.list as { advertiser_id: string; advertiser_name?: string }[]) ?? [];
  return rows.map((r) => ({ id: r.advertiser_id, name: r.advertiser_name ?? r.advertiser_id }));
}

export type TiktokCampaignMetric = {
  id: string;
  name: string;
  cost: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionsValue: number;
};

export type TiktokDailyMetric = {
  date: string;
  cost: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionsValue: number;
};

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const numOf = (v: unknown) => (typeof v === "string" ? Number(v) || 0 : typeof v === "number" ? v : 0);

/** advertiser 配下のキャンペーン名一覧。実績レポートは campaign_id しか返さないため、名前の突き合わせに使う */
async function campaignNames(accessToken: string, advertiserId: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let page = 1;
  for (let i = 0; i < 20; i++) {
    const data = await tiktokGet("/campaign/get/", accessToken, {
      advertiser_id: advertiserId,
      fields: JSON.stringify(["campaign_id", "campaign_name"]),
      page: String(page),
      page_size: "200",
    });
    const rows = (data.list as { campaign_id: string; campaign_name?: string }[]) ?? [];
    for (const r of rows) out.set(r.campaign_id, r.campaign_name ?? r.campaign_id);
    const totalPage = (data.page_info as { total_page?: number } | undefined)?.total_page ?? 1;
    if (page >= totalPage || rows.length === 0) break;
    page++;
  }
  return out;
}

/** report/integrated/get/ を1回呼ぶ。dimensions・data_level で「キャンペーン別（期間合計）」「アカウント合計の日別」を切り替える */
async function integratedReport(
  accessToken: string,
  advertiserId: string,
  dataLevel: "AUCTION_CAMPAIGN" | "AUCTION_ADVERTISER",
  dimensions: string[],
  from: string,
  to: string
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let page = 1;
  for (let i = 0; i < 20; i++) {
    const data = await tiktokGet("/report/integrated/get/", accessToken, {
      advertiser_id: advertiserId,
      report_type: "BASIC",
      data_level: dataLevel,
      dimensions: JSON.stringify(dimensions),
      metrics: JSON.stringify(["spend", "impressions", "clicks", "conversion"]),
      start_date: from,
      end_date: to,
      page: String(page),
      page_size: "200",
    });
    const rows = (data.list as Record<string, unknown>[]) ?? [];
    out.push(...rows);
    const totalPage = (data.page_info as { total_page?: number } | undefined)?.total_page ?? 1;
    if (page >= totalPage || rows.length === 0) break;
    page++;
  }
  return out;
}

/**
 * 指定した広告主（advertiser）1件のキャンペーン別実績・日別実績を取る（読み取りのみ）。
 * advertiserId は discoverAccounts / tiktokAdAccounts が返す advertiser_id そのまま。
 * from / to は YYYY-MM-DD（両端を含む）。
 */
export async function fetchCampaignMetrics(
  accessToken: string,
  advertiserId: string,
  from: string,
  to: string
): Promise<{ campaigns: TiktokCampaignMetric[]; daily: TiktokDailyMetric[] }> {
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) throw new Error("パラメータが正しくありません");

  const [names, campaignRows, dailyRows] = await Promise.all([
    campaignNames(accessToken, advertiserId),
    integratedReport(accessToken, advertiserId, "AUCTION_CAMPAIGN", ["campaign_id"], from, to),
    integratedReport(accessToken, advertiserId, "AUCTION_ADVERTISER", ["stat_time_day"], from, to),
  ]);

  const campaigns: TiktokCampaignMetric[] = campaignRows.map((row) => {
    const dims = (row.dimensions as Record<string, string>) ?? {};
    const m = (row.metrics as Record<string, string>) ?? {};
    const id = dims.campaign_id ?? "";
    return {
      id,
      name: names.get(id) ?? id,
      cost: numOf(m.spend),
      impressions: numOf(m.impressions),
      clicks: numOf(m.clicks),
      conversions: numOf(m.conversion),
      conversionsValue: 0,
    };
  });

  const daily: TiktokDailyMetric[] = dailyRows
    .map((row) => {
      const dims = (row.dimensions as Record<string, string>) ?? {};
      const m = (row.metrics as Record<string, string>) ?? {};
      // stat_time_day は "YYYY-MM-DD HH:mm:ss" で返るため、日付部分だけを使う（TikTok Marketing API ドキュメント準拠）
      const date = (dims.stat_time_day ?? "").slice(0, 10);
      return {
        date,
        cost: numOf(m.spend),
        impressions: numOf(m.impressions),
        clicks: numOf(m.clicks),
        conversions: numOf(m.conversion),
        conversionsValue: 0,
      };
    })
    .filter((d) => d.date)
    .sort((a, b) => a.date.localeCompare(b.date));

  return { campaigns: campaigns.sort((a, b) => b.cost - a.cost), daily };
}
