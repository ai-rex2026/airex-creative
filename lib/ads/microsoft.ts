/**
 * Microsoft 広告（Bing Ads）の最小クライアント（アカウント一覧の発見だけに使う）。
 *
 * Customer Management Service は SOAP のみで REST 版がない（Microsoft Learn 公式ドキュメント
 * 2026-09 時点で確認。Web Service Addresses ページはこのサービスを含む全サービスを
 * 「.svc」の SOAP エンドポイントとして明記している）。このプロジェクトは他のクライアント
 * （lib/ads/google.ts 等）と同じく外部SDKを使わず fetch + 文字列テンプレートで組み立てる方針
 * のため、ここでも SOAP エンベロープを直接組み立てて呼ぶ。
 *
 * 手順（GetUser → SearchAccounts）は Microsoft Learn の Get Started ガイドどおり：
 * 1) GetUser（UserId 省略）でトークンに紐づく UserId を取る
 * 2) SearchAccounts に UserId 条件を渡して、アクセスできる広告アカウントを取る
 *
 * 参照:
 * - https://learn.microsoft.com/en-us/advertising/guides/get-started?view=bingads-13
 * - https://learn.microsoft.com/en-us/advertising/customer-management-service/getuser?view=bingads-13
 * - https://learn.microsoft.com/en-us/advertising/customer-management-service/findaccountsorcustomersinfo?view=bingads-13
 * - https://learn.microsoft.com/en-us/advertising/guides/web-service-addresses?view=bingads-13
 *
 * 未検証の注意：レスポンスの正確なXMLタグ構造は、実際の開発者トークン・認証情報での
 * 疎通確認がまだできていない（Microsoft 広告の開発者アプリ登録が未完了のため）。
 * 本番で1回連携を試したときにエラーになったら、そのエラーメッセージ（HTTPステータスや
 * SOAP Fault の内容）を見て調整する。失敗しても連携自体（トークン保存）は成功する設計。
 */

const CUSTOMER_MGMT_URL =
  "https://clientcenter.api.bingads.microsoft.com/Api/CustomerManagement/v13/CustomerManagementService.svc";
const NS = "https://bingads.microsoft.com/Customer/v13";

const env = (k: string) => process.env[k] ?? "";

function escapeXml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** 単純タグの中身を取り出す（ネストなし前提）。名前空間プレフィックス有無どちらにも対応 */
function tag(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${name}[^>]*>([^<]*)<\\/(?:\\w+:)?${name}>`));
  return m ? m[1] : null;
}

/** name というタグで囲まれたブロックをまるごと切り出す（AdvertiserAccount の繰り返し用） */
function blocks(xml: string, name: string): string[] {
  const re = new RegExp(`<(?:\\w+:)?${name}[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${name}>`, "g");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}

function faultMessage(xml: string): string | null {
  const fault = tag(xml, "Message") ?? tag(xml, "faultstring");
  const code = tag(xml, "ErrorCode") ?? tag(xml, "Code");
  if (!fault) return null;
  return code ? `${fault}（${code}）` : fault;
}

async function soapCall(operation: string, accessToken: string, bodyXml: string): Promise<string> {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Header>
    <h:ApplicationToken i:nil="true" xmlns:h="${NS}" xmlns:i="http://www.w3.org/2001/XMLSchema-instance" />
    <h:AuthenticationToken xmlns:h="${NS}">${escapeXml(accessToken)}</h:AuthenticationToken>
    <h:DeveloperToken xmlns:h="${NS}">${escapeXml(env("MICROSOFT_DEVELOPER_TOKEN"))}</h:DeveloperToken>
  </s:Header>
  <s:Body>
    ${bodyXml}
  </s:Body>
</s:Envelope>`;

  const res = await fetch(CUSTOMER_MGMT_URL, {
    method: "POST",
    headers: {
      "content-type": "text/xml; charset=utf-8",
      soapaction: `${NS}/CustomerManagementService/${operation}`,
    },
    body: xml,
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(faultMessage(text) ?? `Microsoft 広告 API エラー（HTTP ${res.status}）`);
  }
  return text;
}

export async function microsoftUserId(accessToken: string): Promise<string> {
  const body = `<GetUserRequest xmlns="${NS}"><UserId i:nil="true" xmlns:i="http://www.w3.org/2001/XMLSchema-instance" /></GetUserRequest>`;
  const xml = await soapCall("GetUser", accessToken, body);
  const id = tag(xml, "Id");
  if (!id) throw new Error(faultMessage(xml) ?? "ユーザー情報を取得できませんでした");
  return id;
}

export type MicrosoftAccount = { id: string; name: string };

/** このユーザーがアクセスできる広告アカウント（最大100件、1ページぶん） */
export async function microsoftSearchAccounts(accessToken: string, userId: string): Promise<MicrosoftAccount[]> {
  const body = `<SearchAccountsRequest xmlns="${NS}">
  <Predicates xmlns:a="${NS}/Entities" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">
    <a:Predicate>
      <a:Field>UserId</a:Field>
      <a:Operator>Equals</a:Operator>
      <a:Value>${escapeXml(userId)}</a:Value>
    </a:Predicate>
  </Predicates>
  <Ordering i:nil="true" xmlns:a="${NS}/Entities" xmlns:i="http://www.w3.org/2001/XMLSchema-instance" />
  <PageInfo xmlns:a="${NS}/Entities" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">
    <a:Index>0</a:Index>
    <a:Size>100</a:Size>
  </PageInfo>
</SearchAccountsRequest>`;
  const xml = await soapCall("SearchAccounts", accessToken, body);
  const accounts = blocks(xml, "AdvertiserAccount")
    .map((b) => ({ id: tag(b, "Id") ?? "", name: tag(b, "Name") ?? tag(b, "AccountName") ?? "" }))
    .filter((a) => a.id);
  if (accounts.length === 0) {
    const fault = faultMessage(xml);
    if (fault) throw new Error(fault);
  }
  return accounts.map((a) => ({ id: a.id, name: a.name || a.id }));
}
