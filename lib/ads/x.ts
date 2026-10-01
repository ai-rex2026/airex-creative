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
 * granularity=DAY のとき、start_time/end_time は「アカウントの設定タイムゾーンでの0時」
 * ちょうどを表す瞬間でないと `Expect time to be midnight in the account's local timezone
 * for day granularity` で拒否される（UTCの0時ではない）。そのためリクエスト前に
 * GET /accounts/{id} でアカウントのタイムゾーン（IANA名。例: Asia/Tokyo）を取り、
 * その現地時間の0時に対応するUTC時刻を算出して渡す（tzOffsetMinutes/localMidnightUTC）。
 * さらに X の Time 型はミリ秒無しの "YYYY-MM-DDTHH:mm:ssZ" しか受け付けない
 * （Date#toISOString() はミリ秒付きで返すため、localMidnightUTC 内でミリ秒部分を落としている。
 * `Expected Time, got "...000Z" for start_time` で分かった）。
 * 日別内訳のラベル（dates）自体はタイムゾーンに関係ないカレンダー日数なので、従来通り
 * UTC基準で日数を数えて問題ない（DSTで1日の実時間が23/25時間になっても日数は変わらない）。
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

/** アカウントの設定タイムゾーン（IANA名。例: "Asia/Tokyo"）。取れなければ UTC 扱い */
async function accountTimezone(accountId: string, tokens: XTokens): Promise<string> {
  const res = await xSignedGet(`${X_ADS_BASE}/accounts/${accountId}`, tokens);
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(apiError(j, res));
  const tz = (j.data as { timezone?: string } | undefined)?.timezone;
  return tz && typeof tz === "string" ? tz : "UTC";
}

/** 指定した IANA タイムゾーンでの、ある瞬間のUTCからのオフセット（分。「現地時刻 = UTC + offset」） */
function tzOffsetMinutes(timeZone: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUTC = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUTC - date.getTime()) / 60_000);
}

/** YYYY-MM-DD の、指定タイムゾーンでの「その日の0時」に対応するUTC時刻（ミリ秒無しのISO文字列、末尾Z） */
function localMidnightUTC(ymd: string, timeZone: string): string {
  const guess = new Date(`${ymd}T00:00:00Z`);
  const offset1 = tzOffsetMinutes(timeZone, guess);
  const adjusted = new Date(guess.getTime() - offset1 * 60_000);
  // DST境界をまたぐケースに備えて、調整後の瞬間でオフセットを取り直して再計算する
  const offset2 = tzOffsetMinutes(timeZone, adjusted);
  const iso = new Date(guess.getTime() - offset2 * 60_000).toISOString();
  // X の Time 型はミリ秒を受け付けないため、".000Z" を "Z" に落とす
  return iso.replace(/\.\d{3}Z$/, "Z");
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

  const timezone = await accountTimezone(accountId, tokens);
  const startTime = localMidnightUTC(from, timezone);
  const endTime = localMidnightUTC(addDay(to), timezone);
  // 日数・日別ラベルはタイムゾーンに関係ないカレンダー日数（UTC基準で数えて問題ない）
  const dayCount = Math.max(
    1,
    Math.round((Date.parse(`${addDay(to)}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
  );
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
