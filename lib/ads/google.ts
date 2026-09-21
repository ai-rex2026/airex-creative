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
  return j?.error?.message ?? `HTTP ${res.status}`;
}

/** GAQL を1回流す（ページは最大5枚まで追う） */
async function search(
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
  try {
    const rows = await search(accessToken, id, "SELECT customer.id, customer.descriptive_name, customer.manager FROM customer LIMIT 1");
    const c = rows[0]?.customer;
    if (!c) return { error: "情報が空でした" };
    return { info: { id, name: c.descriptiveName || id, manager: !!c.manager } };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 直接アクセスできるアカウントを、名前と種別つきで返す（数が多くても並列で取る）。
 * 1件も取れず、理由がある場合は、その理由を投げる（画面に「取れなかった理由」を出すため）。
 */
export async function listAccessibleCustomers(accessToken: string): Promise<{ accounts: GoogleCustomer[]; skipped: number }> {
  const ids = await listAccessibleCustomerIds(accessToken);
  const results = await Promise.all(ids.slice(0, 60).map((id) => customerInfo(accessToken, id)));
  const accounts: GoogleCustomer[] = [];
  let firstError: string | null = null;
  for (const r of results) {
    if ("info" in r) accounts.push(r.info);
    else firstError ??= r.error;
  }
  if (accounts.length === 0 && firstError) throw new Error(firstError);
  return { accounts: sortCustomers(accounts), skipped: ids.length - accounts.length };
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
