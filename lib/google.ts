/**
 * Google 連携。Search Console と GA4 の実データをレポートに反映する。
 * ワーカーから使うため、保存した refresh_token でアクセストークンを取り直す。
 */

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/webmasters.readonly",
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
].join(" ");

export function hasGoogleApp() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

async function accessToken(refreshToken: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(15000),
  });
  const j = await res.json();
  if (!res.ok || !j.access_token) throw new Error(j.error_description ?? "アクセストークンを取得できませんでした");
  return j.access_token as string;
}

export type GscRow = { query: string; clicks: number; impressions: number; ctr: number; position: number };
export type GscData = { site: string; from: string; to: string; totals: { clicks: number; impressions: number; position: number }; queries: GscRow[] };

/** Search Console：直近28日の検索クエリ上位 */
export async function fetchSearchConsole(refreshToken: string, url: string): Promise<GscData | null> {
  const token = await accessToken(refreshToken);
  const host = new URL(url).host.replace(/^www\./, "");

  const listed = await fetch("https://searchconsole.googleapis.com/webmasters/v3/sites", {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  }).then((r) => r.json());

  const sites: { siteUrl: string }[] = listed.siteEntry ?? [];
  const match = sites.find((s) => s.siteUrl.includes(host));
  if (!match) return null; // このアカウントで所有していないサイト

  const to = new Date();
  const from = new Date(Date.now() - 28 * 864e5);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  const q = await fetch(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(match.siteUrl)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ startDate: fmt(from), endDate: fmt(to), dimensions: ["query"], rowLimit: 10 }),
      signal: AbortSignal.timeout(20000),
    }
  ).then((r) => r.json());

  const rows = (q.rows ?? []) as { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }[];
  const totals = rows.reduce(
    (a, r) => ({ clicks: a.clicks + r.clicks, impressions: a.impressions + r.impressions, position: a.position + r.position }),
    { clicks: 0, impressions: 0, position: 0 }
  );

  return {
    site: match.siteUrl,
    from: fmt(from),
    to: fmt(to),
    totals: {
      clicks: totals.clicks,
      impressions: totals.impressions,
      position: rows.length ? +(totals.position / rows.length).toFixed(1) : 0,
    },
    queries: rows.map((r) => ({
      query: r.keys[0],
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: +(r.ctr * 100).toFixed(1),
      position: +r.position.toFixed(1),
    })),
  };
}

export type Ga4Data = { property: string; from: string; to: string; sessions: number; users: number; channels: { name: string; sessions: number }[] };

/** GA4：ドメインが一致するプロパティを探して、直近28日のセッションと流入チャネル */
export async function fetchGa4(refreshToken: string, url: string): Promise<Ga4Data | null> {
  const token = await accessToken(refreshToken);
  const host = new URL(url).host.replace(/^www\./, "");
  const h = { authorization: `Bearer ${token}` };

  const accounts = await fetch("https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=50", {
    headers: h,
    signal: AbortSignal.timeout(15000),
  }).then((r) => r.json());

  const props: { property: string; displayName: string }[] = [];
  for (const a of accounts.accountSummaries ?? []) {
    for (const p of a.propertySummaries ?? []) props.push({ property: p.property, displayName: p.displayName });
  }

  // データストリームの URL でドメイン一致を見る（表示名は当てにならない）
  let target: string | null = null;
  for (const p of props.slice(0, 12)) {
    const streams = await fetch(`https://analyticsadmin.googleapis.com/v1beta/${p.property}/dataStreams?pageSize=20`, {
      headers: h,
      signal: AbortSignal.timeout(15000),
    }).then((r) => r.json());
    const hit = (streams.dataStreams ?? []).some((s: { webStreamData?: { defaultUri?: string } }) =>
      s.webStreamData?.defaultUri?.includes(host)
    );
    if (hit) {
      target = p.property;
      break;
    }
  }
  if (!target) return null;

  const to = new Date();
  const from = new Date(Date.now() - 28 * 864e5);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  const rep = await fetch(`https://analyticsdata.googleapis.com/v1beta/${target}:runReport`, {
    method: "POST",
    headers: { ...h, "content-type": "application/json" },
    body: JSON.stringify({
      dateRanges: [{ startDate: fmt(from), endDate: fmt(to) }],
      dimensions: [{ name: "sessionDefaultChannelGroup" }],
      metrics: [{ name: "sessions" }, { name: "totalUsers" }],
      limit: 10,
    }),
    signal: AbortSignal.timeout(20000),
  }).then((r) => r.json());

  const rows = (rep.rows ?? []) as { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[];
  const sessions = rows.reduce((a, r) => a + Number(r.metricValues[0]?.value ?? 0), 0);
  const users = rows.reduce((a, r) => a + Number(r.metricValues[1]?.value ?? 0), 0);

  return {
    property: target,
    from: fmt(from),
    to: fmt(to),
    sessions,
    users,
    channels: rows.map((r) => ({ name: r.dimensionValues[0].value, sessions: Number(r.metricValues[0].value) })),
  };
}

export type YoutubeAnalyticsData = {
  from: string;
  to: string;
  views: number | null;
  estimatedMinutesWatched: number | null;
  averageViewDurationSec: number | null;
  /** 期間中の純増登録者数（解除を差し引いた後）。公開APIでは取れない非公開指標 */
  subscribersGained: number | null;
  topTrafficSource: string | null;
};

const TRAFFIC_SOURCE_LABELS: Record<string, string> = {
  YT_SEARCH: "YouTube内検索",
  SUGGESTED_VIDEO: "関連動画（おすすめ）",
  BROWSE: "ホームフィード・おすすめ",
  EXT_URL: "外部サイト・アプリ",
  NOTIFICATION: "通知",
  PLAYLIST: "再生リスト",
  SUBSCRIBER: "登録者のフィード",
  CHANNEL: "チャンネルページ",
  NO_LINK_OTHER: "その他",
  ADVERTISING: "広告",
  END_SCREEN: "エンドスクリーン",
  ANNOTATION: "アノテーション",
};

/**
 * YouTube Studio 相当の非公開指標（推定視聴時間・平均視聴時間・純増登録者数・主な流入経路）。
 * 連携（yt-analytics.readonly）している場合だけ呼ぶ。
 *
 * 「インプレッション数・クリック率」もYouTube側には存在するが、2026年1月に追加されたばかりの
 * 別API（YouTube Reporting API のバルクレポート）経由でしか取れず、reports.query（本関数が使う
 * Analytics API）では未対応。未検証のまま出すと値が欠けるだけになるため、今回は含めない。
 */
export async function fetchYoutubeAnalytics(refreshToken: string): Promise<YoutubeAnalyticsData | null> {
  const token = await accessToken(refreshToken);
  const h = { authorization: `Bearer ${token}` };
  const to = new Date();
  const from = new Date(Date.now() - 28 * 864e5);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const startDate = fmt(from);
  const endDate = fmt(to);
  const base = "https://youtubeanalytics.googleapis.com/v2/reports";

  const mainQ = new URLSearchParams({
    ids: "channel==MINE",
    startDate,
    endDate,
    metrics: "views,estimatedMinutesWatched,averageViewDuration,subscribersGained",
  });
  const main = await fetch(`${base}?${mainQ}`, { headers: h, signal: AbortSignal.timeout(15000) }).then((r) => r.json());
  const row = main.rows?.[0] as number[] | undefined;
  if (!row) return null;

  let topTrafficSource: string | null = null;
  try {
    const trafficQ = new URLSearchParams({
      ids: "channel==MINE",
      startDate,
      endDate,
      metrics: "views",
      dimensions: "insightTrafficSourceType",
      sort: "-views",
      maxResults: "1",
    });
    const traffic = await fetch(`${base}?${trafficQ}`, { headers: h, signal: AbortSignal.timeout(15000) }).then((r) => r.json());
    const t = traffic.rows?.[0]?.[0] as string | undefined;
    topTrafficSource = t ? (TRAFFIC_SOURCE_LABELS[t] ?? t) : null;
  } catch {
    // 主要指標だけ返す。流入経路が取れなくても止めない
  }

  return {
    from: startDate,
    to: endDate,
    views: typeof row[0] === "number" ? row[0] : null,
    estimatedMinutesWatched: typeof row[1] === "number" ? row[1] : null,
    averageViewDurationSec: typeof row[2] === "number" ? row[2] : null,
    subscribersGained: typeof row[3] === "number" ? row[3] : null,
    topTrafficSource,
  };
}
