/**
 * Google Ads API の最小クライアント（アカウント一覧・MCC 配下の展開用）。
 * 開発者トークンは任意（クラウド管理に移行済みなら不要）。あるときだけ付ける。
 */

const VERSION = process.env.GOOGLE_ADS_API_VERSION || "v24";

export type GoogleCustomer = { id: string; name: string; manager: boolean };

/** パスに埋め込むので、数字だけを通す */
export function isCustomerId(v: unknown): v is string {
  return typeof v === "string" && /^\d{1,12}$/.test(v);
}

function headers(accessToken: string, loginCustomerId?: string | null): Record<string, string> {
  return {
    authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
    ...(process.env.GOOGLE_ADS_DEVELOPER_TOKEN ? { "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN } : {}),
    ...(loginCustomerId ? { "login-customer-id": loginCustomerId } : {}),
  };
}

async function errorText(res: Response) {
  const j = await res.json().catch(() => ({}));
  // Google Ads API のエラーは details[].errors[].errorCode に原因のコードが入る（例: USER_PERMISSION_DENIED）
  const codes: string[] = [];
  for (const d of j?.error?.details ?? []) {
    for (const e of d?.errors ?? []) {
      const c = e?.errorCode && Object.values(e.errorCode)[0];
      if (typeof c === "string") codes.push(c);
    }
  }
  const msg = j?.error?.message ?? `HTTP ${res.status}`;
  return codes.length ? `${msg}（${[...new Set(codes)].join(", ")}）` : msg;
}

/** GAQL を1回流す（ページは最大5枚まで追う） */
export async function search(
  accessToken: string,
  customerId: string,
  query: string,
  loginCustomerId?: string | null
): Promise<Record<string, any>[]> {
  const rows: Record<string, any>[] = [];
  let pageToken: string | undefined;
  for (let i = 0; i < 5; i++) {
    const res = await fetch(`https://googleads.googleapis.com/${VERSION}/customers/${customerId}/googleAds:search`, {
      method: "POST",
      headers: headers(accessToken, loginCustomerId),
      body: JSON.stringify({ query, ...(pageToken ? { pageToken } : {}) }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(await errorText(res));
    const j = await res.json();
    rows.push(...(j.results ?? []));
    pageToken = j.nextPageToken;
    if (!pageToken) break;
  }
  return rows;
}

/** このユーザーが直接アクセスできる顧客ID */
export async function listAccessibleCustomerIds(accessToken: string): Promise<string[]> {
  const res = await fetch(`https://googleads.googleapis.com/${VERSION}/customers:listAccessibleCustomers`, {
    headers: headers(accessToken),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(await errorText(res));
  const j = await res.json();
  return ((j.resourceNames ?? []) as string[]).map((n) => n.replace("customers/", "")).filter(isCustomerId);
}

/** 1アカウントの名前と、MCC（管理者アカウント）かどうか。取れなければ理由を返す（解約済み・権限なしなど） */
export async function customerInfo(
  accessToken: string,
  id: string
): Promise<{ info: GoogleCustomer } | { error: string }> {
  const q = "SELECT customer.id, customer.descriptive_name, customer.manager FROM customer LIMIT 1";
  try {
    let rows: Record<string, any>[];
    try {
      rows = await search(accessToken, id, q);
    } catch (e) {
      // 解約済み・未有効のアカウントは、何度やっても同じなので再試行しない
      if (e instanceof Error && e.message.includes("CUSTOMER_NOT_ENABLED")) throw e;
      // MCC（管理者アカウント）は、自分自身を login-customer-id に指定しないと権限エラーになることがある
      rows = await search(accessToken, id, q, id);
    }
    const c = rows[0]?.customer;
    if (!c) return { error: "情報が空でした" };
    return { info: { id, name: c.descriptiveName || id, manager: !!c.manager } };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 直接アクセスできるアカウントを、名前と種別つきで返す（数が多くても並列で取る）。
 * 取れなかったアカウントは、ID と理由を failed に残す（解約済み・権限なしなど。画面に出す）。
 */
export async function listAccessibleCustomers(
  accessToken: string
): Promise<{ accounts: GoogleCustomer[]; failed: { id: string; error: string }[] }> {
  const ids = await listAccessibleCustomerIds(accessToken);
  const results = await Promise.all(ids.slice(0, 60).map((id) => customerInfo(accessToken, id)));
  const accounts: GoogleCustomer[] = [];
  const failed: { id: string; error: string }[] = [];
  results.forEach((r, i) => {
    if ("info" in r) accounts.push(r.info);
    else failed.push({ id: ids[i], error: r.error });
  });
  return { accounts: sortCustomers(accounts), failed };
}

/**
 * MCC 配下のアカウント（直下の1階層）。配下にさらに MCC があれば manager=true で返るので、
 * 画面側でそれを開けば次の階層が取れる。
 * loginCustomerId は「最初にログインした MCC」を渡す（配下の MCC を開くときも同じ）。
 */
export async function listChildCustomers(
  accessToken: string,
  parentId: string,
  loginCustomerId: string | null
): Promise<GoogleCustomer[]> {
  const rows = await search(
    accessToken,
    parentId,
    "SELECT customer_client.id, customer_client.descriptive_name, customer_client.manager " +
      "FROM customer_client WHERE customer_client.level = 1 AND customer_client.status = 'ENABLED'",
    loginCustomerId ?? parentId
  );
  const out: GoogleCustomer[] = [];
  for (const r of rows) {
    const c = r.customerClient;
    if (c?.id && isCustomerId(String(c.id))) {
      out.push({ id: String(c.id), name: c.descriptiveName || String(c.id), manager: !!c.manager });
    }
  }
  return sortCustomers(out);
}

/** MCC 配下のアカウントが本当にその MCC の配下か確かめ、名前を返す（保存前の検証用） */
export async function verifyClients(
  accessToken: string,
  loginCustomerId: string,
  ids: string[]
): Promise<Map<string, GoogleCustomer>> {
  const rows = await search(
    accessToken,
    loginCustomerId,
    "SELECT customer_client.id, customer_client.descriptive_name, customer_client.manager FROM customer_client " +
      `WHERE customer_client.id IN (${ids.join(",")}) AND customer_client.status = 'ENABLED'`,
    loginCustomerId
  );
  const m = new Map<string, GoogleCustomer>();
  for (const r of rows) {
    const c = r.customerClient;
    if (c?.id) m.set(String(c.id), { id: String(c.id), name: c.descriptiveName || String(c.id), manager: !!c.manager });
  }
  return m;
}

function sortCustomers(list: GoogleCustomer[]) {
  // MCC を先に、あとは名前順
  return [...list].sort((a, b) => Number(b.manager) - Number(a.manager) || a.name.localeCompare(b.name, "ja"));
}

/* ------------------------------------------------------------------
 * キャンペーン別の実績（読み取りのみ）
 * ------------------------------------------------------------------ */

export type CampaignMetric = {
  id: string;
  name: string;
  status: string;
  cost: number; // 円（通貨は口座の設定に従う。cost_micros / 1,000,000）
  impressions: number;
  clicks: number;
  conversions: number;
  conversionsValue: number;
};

export type DailyMetric = Omit<CampaignMetric, "id" | "name" | "status"> & { date: string };

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** キャンペーン別の合計と、日別の合計を返す（from / to は YYYY-MM-DD、両端を含む） */
export async function fetchCampaignMetrics(
  accessToken: string,
  customerId: string,
  loginCustomerId: string | null,
  from: string,
  to: string
): Promise<{ campaigns: CampaignMetric[]; daily: DailyMetric[] }> {
  if (!isCustomerId(customerId) || !DATE_RE.test(from) || !DATE_RE.test(to)) {
    throw new Error("パラメータが正しくありません");
  }
  const rows = await search(
    accessToken,
    customerId,
    "SELECT campaign.id, campaign.name, campaign.status, segments.date, " +
      "metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value " +
      `FROM campaign WHERE segments.date BETWEEN '${from}' AND '${to}' AND campaign.status != 'REMOVED'`,
    loginCustomerId
  );
  const byCampaign = new Map<string, CampaignMetric>();
  const byDate = new Map<string, DailyMetric>();
  for (const r of rows) {
    const m = r.metrics ?? {};
    const cost = Number(m.costMicros ?? 0) / 1_000_000;
    const impressions = Number(m.impressions ?? 0);
    const clicks = Number(m.clicks ?? 0);
    const conversions = Number(m.conversions ?? 0);
    const conversionsValue = Number(m.conversionsValue ?? 0);

    const id = String(r.campaign?.id ?? "");
    const c = byCampaign.get(id) ?? {
      id,
      name: r.campaign?.name ?? id,
      status: r.campaign?.status ?? "",
      cost: 0,
      impressions: 0,
      clicks: 0,
      conversions: 0,
      conversionsValue: 0,
    };
    c.cost += cost;
    c.impressions += impressions;
    c.clicks += clicks;
    c.conversions += conversions;
    c.conversionsValue += conversionsValue;
    byCampaign.set(id, c);

    const date = String(r.segments?.date ?? "");
    const d = byDate.get(date) ?? { date, cost: 0, impressions: 0, clicks: 0, conversions: 0, conversionsValue: 0 };
    d.cost += cost;
    d.impressions += impressions;
    d.clicks += clicks;
    d.conversions += conversions;
    d.conversionsValue += conversionsValue;
    byDate.set(date, d);
  }
  return {
    campaigns: [...byCampaign.values()].sort((a, b) => b.cost - a.cost),
    daily: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}
