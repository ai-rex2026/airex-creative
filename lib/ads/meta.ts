/**
 * Meta 広告（Facebook/Instagram）：広告アカウント一覧・キャンペーン別実績（読み取りのみ）。
 *
 * ads_read のみをリクエストしており（lib/ads/oauth.ts 参照）、キャンペーンの作成・変更系の
 * エンドポイントは一切呼ばない。アカウントID（act_ プレフィックス付き）と長期アクセストークン
 * さえあれば呼べるので、Microsoft のような追加の識別子（ParentCustomerId 等）は不要。
 */

const GRAPH = "https://graph.facebook.com/v21.0";

export type MetaPickerAccount = { id: string; name: string };

/** 選択画面用に、このユーザーの長期トークンでアクセスできる広告アカウント一覧を取り直す */
export async function metaAdAccounts(accessToken: string): Promise<MetaPickerAccount[]> {
  const res = await fetch(
    `${GRAPH}/me/adaccounts?` + new URLSearchParams({ fields: "id,name", limit: "200", access_token: accessToken }),
    { signal: AbortSignal.timeout(20000) }
  );
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error?.message ?? `HTTP ${res.status}`);
  const rows: { id: string; name?: string }[] = j.data ?? [];
  return rows.map((r) => ({ id: r.id, name: r.name ?? r.id }));
}

export type MetaCampaignMetric = {
  id: string;
  name: string;
  cost: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionsValue: number;
};

export type MetaDailyMetric = {
  date: string;
  cost: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionsValue: number;
};

const numOf = (v: unknown) => (typeof v === "string" ? Number(v) || 0 : typeof v === "number" ? v : 0);

// 媒体間の突き合わせのための簡易集計。購入・リード系のアクションをまとめて「コンバージョン」とみなす
// （内訳の細かい定義が要る場合は Meta 広告マネージャ側で確認する）
const CONVERSION_ACTION_TYPES = [
  "purchase",
  "offsite_conversion.fb_pixel_purchase",
  "onsite_conversion.purchase",
  "lead",
  "offsite_conversion.fb_pixel_lead",
  "onsite_conversion.lead_grouped",
];

function sumActions(rows: unknown, types: string[]): number {
  if (!Array.isArray(rows)) return 0;
  return (rows as { action_type?: string; value?: string }[])
    .filter((r) => typeof r.action_type === "string" && types.includes(r.action_type))
    .reduce((s, r) => s + numOf(r.value), 0);
}

async function insights(
  accessToken: string,
  accountId: string,
  from: string,
  to: string,
  params: Record<string, string>
): Promise<Record<string, unknown>[]> {
  const res = await fetch(
    `${GRAPH}/${accountId}/insights?` +
      new URLSearchParams({
        time_range: JSON.stringify({ since: from, until: to }),
        limit: "500",
        access_token: accessToken,
        ...params,
      }),
    { signal: AbortSignal.timeout(25000) }
  );
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error?.message ?? `HTTP ${res.status}`);
  return (j.data ?? []) as Record<string, unknown>[];
}

/**
 * キャンペーン別（期間合計）と、アカウント合計の日別。accountId は act_ プレフィックス付きのID
 * （me/adaccounts がそのまま返す形。metaAdAccounts 参照）。
 */
export async function fetchCampaignMetrics(
  accessToken: string,
  accountId: string,
  from: string,
  to: string
): Promise<{ campaigns: MetaCampaignMetric[]; daily: MetaDailyMetric[] }> {
  const [campaignRows, dailyRows] = await Promise.all([
    insights(accessToken, accountId, from, to, {
      level: "campaign",
      fields: "campaign_id,campaign_name,spend,impressions,clicks,actions,action_values",
    }),
    insights(accessToken, accountId, from, to, {
      level: "account",
      time_increment: "1",
      fields: "spend,impressions,clicks,actions,action_values",
    }),
  ]);

  const campaigns: MetaCampaignMetric[] = campaignRows.map((r) => ({
    id: String(r.campaign_id ?? ""),
    name: String(r.campaign_name ?? r.campaign_id ?? ""),
    cost: numOf(r.spend),
    impressions: numOf(r.impressions),
    clicks: numOf(r.clicks),
    conversions: sumActions(r.actions, CONVERSION_ACTION_TYPES),
    conversionsValue: sumActions(r.action_values, CONVERSION_ACTION_TYPES),
  }));

  const daily: MetaDailyMetric[] = dailyRows.map((r) => ({
    date: String(r.date_start ?? ""),
    cost: numOf(r.spend),
    impressions: numOf(r.impressions),
    clicks: numOf(r.clicks),
    conversions: sumActions(r.actions, CONVERSION_ACTION_TYPES),
    conversionsValue: sumActions(r.action_values, CONVERSION_ACTION_TYPES),
  }));

  return { campaigns, daily };
}
