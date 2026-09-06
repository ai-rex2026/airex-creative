/**
 * Google 連携。Search Console と GA4 の実データをレポートに反映する。
 * ワーカーから使うため、保存した refresh_token でアクセストークンを取り直す。
 */

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/webmasters.readonly",
  "https://www.googleapis.com/auth/analytics.readonly",
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
