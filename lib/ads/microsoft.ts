/**
 * Microsoft 広告（Bing Ads）API v13 の最小クライアント(アカウント一覧の発見・分析対象アカウントの
 * 選択・キャンペーン別実績の取得に使う)。
 *
 * 3つのサービスをすべて SOAP で直接叩く(REST 版のない Customer Management Service に合わせて、
 * 他の2つも他のクライアント(lib/ads/google.ts・lib/ads/yahoo.ts)と同じく外部SDKを使わず
 * fetch + 文字列テンプレートで組み立てる方針):
 *
 * 1) Customer Management Service(ユーザー・アカウント情報)
 *    GetUser(UserId 省略でトークンに紐づくユーザーを取る。レスポンスの CustomerId も併せて取る)
 *    → SearchAccounts(UserId 条件でアクセスできる広告アカウントをフラットな一覧で取る。
 *      Google/ヤフーLINE広告と違い MCC 配下を辿る必要がない=AdvertiserAccount がそのまま
 *      「今すぐ実績を取れるアカウント」の一覧。各アカウントの ParentCustomerId が、実績取得で
 *      使う CustomerId ヘッダーの値になる)
 * 2) Campaign Management Service(キャンペーンの名前・ステータス)
 *    GetCampaignsByAccountId
 * 3) Reporting Service(実績データ。非同期)
 *    SubmitGenerateReport → PollGenerateReport → ダウンロードURLをGET(ZIPファイル。jszipで展開)
 *
 * SOAP ヘッダーは3サービス共通で、操作名を示す <Action mustUnderstand="1">{operation}</Action> が
 * 必須(Microsoft Learn の GetUser/SearchAccounts/GetCampaignsByAccountId 等の各リファレンスで
 * 確認、2026-09)。これが無いと HTTP 200 は返らず「ContractFilter mismatch at the
 * EndpointDispatcher」という WCF 側のディスパッチ失敗になる。
 *
 * さらに、HTTP の SOAPAction ヘッダー(SOAP本文とは別のHTTPヘッダー)は、ネームスペース付きURIでは
 * なく**操作名だけをダブルクオートで囲んだ値**(例: `"GetUser"`)でなければならない(SOAP 1.1仕様
 * どおり。以前は `${NS}/CustomerManagementService/${operation}` のようなURI形式で送っていたため、
 * ヘッダー自体は存在してもWCF側で操作を解決できず同じ ContractFilter mismatch になっていた。
 * 実際に稼働している SOAP クライアント(Ruby Savon 製、Bing Ads Campaign Management Service 宛)の
 * 生ワイヤーログで SOAPAction: "GetAdExtensionsAssociations" という単純な形式を確認して特定・修正、
 * 2026-09)。Campaign Management Service・Reporting Service は Action に加えて CustomerAccountId・
 * CustomerId も必須(CustomerAccountId
 * には対象の広告アカウント自身のID、CustomerId にはその ParentCustomerId を渡す。Google広告の
 * login-customer-id(MCC)+customer-id(対象)や、ヤフーLINE広告の x-z-base-account-id(base
 * account)+body の accountId(対象)のような「ヘッダーは別のID」パターンとは違い、Microsoft は
 * ヘッダーのCustomerAccountIdが対象アカウント自身のIDでよい)。Customer Management Service
 * (GetUser・SearchAccounts)はこの2つ(CustomerAccountId・CustomerId)を使わない(というより
 * まだ持っていない=これから発見する呼び出しのため)。
 *
 * 参照:
 * - https://learn.microsoft.com/en-us/advertising/guides/get-started?view=bingads-13
 * - https://learn.microsoft.com/en-us/advertising/customer-management-service/getuser?view=bingads-13
 * - https://learn.microsoft.com/en-us/advertising/customer-management-service/searchaccounts?view=bingads-13
 * - https://learn.microsoft.com/en-us/advertising/customer-management-service/advertiseraccount?view=bingads-13
 * - https://learn.microsoft.com/en-us/advertising/campaign-management-service/getcampaignsbyaccountid?view=bingads-13
 * - https://learn.microsoft.com/en-us/advertising/reporting-service/submitgeneratereport?view=bingads-13
 * - https://learn.microsoft.com/en-us/advertising/reporting-service/campaignperformancereportrequest?view=bingads-13
 * - https://learn.microsoft.com/en-us/advertising/guides/request-download-report?view=bingads-13
 * - https://learn.microsoft.com/en-us/advertising/guides/reports?view=bingads-13
 * - https://learn.microsoft.com/en-us/advertising/guides/web-service-addresses?view=bingads-13
 *
 * 未検証の注意(2026-09時点。実際の開発者トークン・認証情報での疎通確認の途中):
 * - ダウンロードしたレポートファイルが標準的なZIP形式(PKヘッダー)であること
 * - TimePeriod(日付列)の実際の文字列フォーマット("M/D/YYYY" を想定して正規化している。
 *   違う形式で返ってきた場合、日別実績の日付が正しく表示されない)
 * 失敗しても discoverAccounts の呼び出し元(lib/ads/accounts.ts)が例外を捕まえるので、連携
 * (トークン保存)自体は失敗しない。実績取得(fetchCampaignMetrics)で失敗した場合は、本番の
 * エラーメッセージ(HTTPステータスやSOAP Faultの内容)を見て、このファイルを調整する。
 *
 * 2026-09 修正済み: "The user id not found.（1310）" で GetUser 以降が失敗し続けていた真因は、
 * tag(xml, "Id") が文書中で最初に一致した <Id> をそのまま返す実装だったこと。Microsoft Learn の
 * WSDL 定義上、User 型は ContactInfo → ...(アルファベット順)→ Id、AdvertiserAccount 型は
 * BusinessAddress → ...→ Id の順で XML にシリアライズされ、ContactInfo(Address)自身も "Id" と
 * いう名前のフィールド(住所/連絡先レコード自身のID。ユーザーIDでも広告アカウントIDでもない)を
 * 持つため、素朴な「最初の <Id> を拾う」実装は本来欲しい User.Id / AdvertiserAccount.Id より先に
 * 出現する ContactInfo.Id / BusinessAddress.Id を誤って拾ってしまっていた。stripBlock() でこれらの
 * ネストした複合型を先に取り除いてから Id を検索するよう修正済み(microsoftUserId・
 * microsoftSearchAccounts）。実アカウントでの再接続で解消を確認済み。
 * 参照:
 * - https://learn.microsoft.com/en-us/advertising/customer-management-service/user?view=bingads-13
 * - https://learn.microsoft.com/en-us/advertising/customer-management-service/contactinfo?view=bingads-13
 * - https://learn.microsoft.com/en-us/advertising/customer-management-service/advertiseraccount?view=bingads-13
 * - https://learn.microsoft.com/en-us/advertising/customer-management-service/address?view=bingads-13
 *
 * 2026-09 修正済み(2件目): 対象期間に実績データが1件も無いアカウント(新規連携直後など)で、
 * 「レポートのダウンロードURLが取得できませんでした」という致命的エラーになっていた事象を修正。
 * Microsoft Learn の ReportRequestStatus 定義に、ReportDownloadUrl は Status=Success でも
 * 「対象期間にデータが無ければ nil になりうる」と明記されている。つまり実績ゼロという正常な
 * ケースを誤ってエラー扱いしていた。pollGenerateReport の戻り値を string | null にし、
 * fetchCampaignMetrics 側で null なら実績ゼロの結果を返すよう修正(Google広告・ヤフーLINE広告が
 * 0件レスポンスを空配列として扱うのと同じ挙動に揃えた)。
 * 参照: https://learn.microsoft.com/en-us/advertising/reporting-service/reportrequeststatus?view=bingads-13
 */

import JSZip from "jszip";

const CUSTOMER_MGMT_URL =
  "https://clientcenter.api.bingads.microsoft.com/Api/CustomerManagement/v13/CustomerManagementService.svc";
const NS = "https://bingads.microsoft.com/Customer/v13";

const CAMPAIGN_MGMT_URL =
  "https://campaign.api.bingads.microsoft.com/Api/Advertiser/CampaignManagement/v13/CampaignManagementService.svc";
const CAMPAIGN_NS = "https://bingads.microsoft.com/CampaignManagement/v13";

const REPORTING_URL = "https://reporting.api.bingads.microsoft.com/Api/Advertiser/Reporting/v13/ReportingService.svc";
const REPORTING_NS = "https://bingads.microsoft.com/Reporting/v13";

const env = (k: string) => process.env[k] ?? "";

function escapeXml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** 単純タグの中身を取り出す(ネストなし前提)。名前空間プレフィックス有無どちらにも対応 */
function tag(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${name}[^>]*>([^<]*)<\\/(?:\\w+:)?${name}>`));
  return m ? m[1] : null;
}

/** name というタグで囲まれたブロックをまるごと切り出す(AdvertiserAccount・Campaign の繰り返し用) */
function blocks(xml: string, name: string): string[] {
  const re = new RegExp(`<(?:\\w+:)?${name}[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${name}>`, "g");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}

/**
 * ネストした複合型(内部に紛らわしい同名タグ、特に Id を持つもの)を丸ごと取り除いてから
 * 検索できるようにする。
 *
 * 根本原因(2026-09 判明): Microsoft Learn の WSDL 定義上のフィールド順で、User 型は
 * ContactInfo → ...(アルファベット順)→ Id、AdvertiserAccount 型は BusinessAddress → ...→ Id
 * という順で XML にシリアライズされる。ContactInfo(Address)自身も "Id" という名前の
 * フィールド(住所/連絡先レコード自身のID。ユーザーIDでも広告アカウントIDでもない)を持つため、
 * tag(xml, "Id") のような「最初に見つかった <Id> を拾う」素朴な実装は、本来欲しい
 * User.Id / AdvertiserAccount.Id より先に出現する ContactInfo.Id / BusinessAddress.Id を
 * 誤って拾ってしまう。これが GetUser の Id が常に実在しないユーザーIDになり、後続の
 * SearchAccounts が "The user id not found.（1310）" で失敗し続けていた真因。
 * 参照:
 * - https://learn.microsoft.com/en-us/advertising/customer-management-service/user?view=bingads-13
 * - https://learn.microsoft.com/en-us/advertising/customer-management-service/contactinfo?view=bingads-13
 * - https://learn.microsoft.com/en-us/advertising/customer-management-service/advertiseraccount?view=bingads-13
 * - https://learn.microsoft.com/en-us/advertising/customer-management-service/address?view=bingads-13
 */
function stripBlock(xml: string, name: string): string {
  return xml.replace(new RegExp(`<(?:\\w+:)?${name}[^>]*>[\\s\\S]*?<\\/(?:\\w+:)?${name}>`, "g"), "");
}

/**
 * SOAP Fault からメッセージを拾う。Customer Management は AdApiFaultDetail/ApiFault が
 * 直下に Message/ErrorCode を持つが、Campaign Management/Reporting は OperationErrors/BatchErrors
 * の配列の中に1段深く入る(Microsoft Learn 2026-09 確認)。深さに依存しないよう、本文全体から
 * 最初に見つかった Message/ErrorCode をフラットに拾う。TrackingId も併せて拾い、サポート問い合わせ
 * 時に使えるようにする。
 */
function faultMessage(xml: string): string | null {
  const fault = tag(xml, "Message") ?? tag(xml, "faultstring");
  const code = tag(xml, "ErrorCode") ?? tag(xml, "Code");
  const trackingId = tag(xml, "TrackingId");
  if (!fault) return null;
  const withCode = code ? `${fault}（${code}）` : fault;
  return trackingId ? `${withCode} [TrackingId: ${trackingId}]` : withCode;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Customer Management Service 用の SOAP 呼び出し。ヘッダーに Action(操作名。mustUnderstand="1")
 * ・AuthenticationToken・DeveloperToken が必須(CustomerAccountId・CustomerId は不要=まだ発見前)。
 * HTTP の SOAPAction ヘッダーは操作名だけをダブルクオートで囲んだ値(例: `"GetUser"`)。
 * 以前は SOAP本文の Action ヘッダー省略・HTTP SOAPAction のURI形式誤りの2つが重なっていたため、
 * HTTPステータスは返るものの WCF 側で操作を解決できず「ContractFilter mismatch at the
 * EndpointDispatcher」で失敗していた(2026-09、実トークンでの疎通確認で発覚・修正)。
 */
async function soapCall(operation: string, accessToken: string, bodyXml: string): Promise<string> {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:i="http://www.w3.org/2001/XMLSchema-instance" xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Header xmlns="${NS}">
    <Action mustUnderstand="1">${operation}</Action>
    <ApplicationToken i:nil="true" />
    <AuthenticationToken i:nil="false">${escapeXml(accessToken)}</AuthenticationToken>
    <DeveloperToken i:nil="false">${escapeXml(env("MICROSOFT_DEVELOPER_TOKEN"))}</DeveloperToken>
  </s:Header>
  <s:Body>
    ${bodyXml}
  </s:Body>
</s:Envelope>`;

  const res = await fetch(CUSTOMER_MGMT_URL, {
    method: "POST",
    headers: {
      "content-type": "text/xml; charset=utf-8",
      soapaction: `"${operation}"`,
    },
    body: xml,
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  if (!res.ok) {
    const msg = faultMessage(text) ?? `Microsoft 広告 API エラー（HTTP ${res.status}）`;
    throw new Error(msg);
  }
  return text;
}

/**
 * Campaign Management Service・Reporting Service 共通の SOAP 呼び出し。
 * この2サービスは Customer Management と違い、ヘッダーに Action(操作名)・CustomerAccountId
 * (対象の広告アカウント自身のID)・CustomerId(その ParentCustomerId)が必須。
 */
async function soapCallWithCustomer(
  url: string,
  ns: string,
  serviceName: string,
  operation: string,
  accessToken: string,
  customerAccountId: string,
  customerId: string,
  bodyXml: string
): Promise<string> {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:i="http://www.w3.org/2001/XMLSchema-instance" xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Header xmlns="${ns}">
    <Action mustUnderstand="1">${operation}</Action>
    <AuthenticationToken i:nil="false">${escapeXml(accessToken)}</AuthenticationToken>
    <CustomerAccountId i:nil="false">${escapeXml(customerAccountId)}</CustomerAccountId>
    <CustomerId i:nil="false">${escapeXml(customerId)}</CustomerId>
    <DeveloperToken i:nil="false">${escapeXml(env("MICROSOFT_DEVELOPER_TOKEN"))}</DeveloperToken>
  </s:Header>
  <s:Body>
    ${bodyXml}
  </s:Body>
</s:Envelope>`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "text/xml; charset=utf-8",
      soapaction: `"${operation}"`,
    },
    body: xml,
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  if (!res.ok) {
    const msg = faultMessage(text) ?? `Microsoft 広告 API エラー（HTTP ${res.status}）`;
    throw new Error(msg);
  }
  return text;
}

/* ------------------------------------------------------------------
 * Customer Management Service：ユーザー・アカウント一覧
 * ------------------------------------------------------------------ */

export async function microsoftUserId(accessToken: string): Promise<{ id: string; customerId: string }> {
  const body = `<GetUserRequest xmlns="${NS}"><UserId i:nil="true" xmlns:i="http://www.w3.org/2001/XMLSchema-instance" /></GetUserRequest>`;
  const xml = await soapCall("GetUser", accessToken, body);
  // ContactInfo は User 自身の Id より先にシリアライズされ、かつ自分自身の Id フィールドを
  // 持つため、先に取り除いてから検索する(stripBlock のコメント参照)。
  const cleaned = stripBlock(xml, "ContactInfo");
  const id = tag(cleaned, "Id");
  if (!id) {
    throw new Error(faultMessage(xml) ?? "ユーザー情報を取得できませんでした");
  }
  return { id, customerId: tag(cleaned, "CustomerId") ?? "" };
}

export type MicrosoftAccount = { id: string; name: string; /** 実績取得の CustomerId ヘッダーに使う */ parentCustomerId: string };

/** このユーザーがアクセスできる広告アカウント(最大100件、1ページぶん)。MCC配下の展開は不要 */
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
    .map((b) => {
      // BusinessAddress は AdvertiserAccount 自身の Id より先にシリアライズされ、かつ
      // 自分自身の Id フィールドを持つため、先に取り除いてから検索する(GetUser の
      // ContactInfo と同じ問題。stripBlock のコメント参照)。
      const cleaned = stripBlock(b, "BusinessAddress");
      return {
        id: tag(cleaned, "Id") ?? "",
        name: tag(b, "Name") ?? tag(b, "AccountName") ?? "",
        parentCustomerId: tag(b, "ParentCustomerId") ?? "",
      };
    })
    .filter((a) => a.id);
  if (accounts.length === 0) {
    const fault = faultMessage(xml);
    if (fault) throw new Error(fault);
  }
  return accounts.map((a) => ({ id: a.id, name: a.name || a.id, parentCustomerId: a.parentCustomerId }));
}

/* ------------------------------------------------------------------
 * Campaign Management Service：キャンペーンの名前・ステータス
 * ------------------------------------------------------------------ */

const MICROSOFT_STATUS_JA: Record<string, string> = { Active: "有効", Paused: "停止中" };

async function microsoftCampaignList(
  accessToken: string,
  accountId: string,
  customerId: string
): Promise<Map<string, { name: string; status: string }>> {
  const body = `<GetCampaignsByAccountIdRequest xmlns="${CAMPAIGN_NS}"><AccountId>${escapeXml(accountId)}</AccountId></GetCampaignsByAccountIdRequest>`;
  const xml = await soapCallWithCustomer(
    CAMPAIGN_MGMT_URL,
    CAMPAIGN_NS,
    "CampaignManagementService",
    "GetCampaignsByAccountId",
    accessToken,
    accountId,
    customerId,
    body
  );
  const out = new Map<string, { name: string; status: string }>();
  for (const b of blocks(xml, "Campaign")) {
    const id = tag(b, "Id");
    if (!id) continue;
    const status = tag(b, "Status") ?? "";
    out.set(id, { name: tag(b, "Name") ?? id, status: MICROSOFT_STATUS_JA[status] ?? status });
  }
  if (out.size === 0) {
    const fault = faultMessage(xml);
    if (fault) throw new Error(fault);
  }
  return out;
}

/* ------------------------------------------------------------------
 * Reporting Service：キャンペーン別実績(非同期)
 * ------------------------------------------------------------------ */

export type MicrosoftCampaignMetric = {
  id: string;
  name: string;
  status: string;
  cost: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionsValue: number;
};

export type MicrosoftDailyMetric = Omit<MicrosoftCampaignMetric, "id" | "name" | "status"> & { date: string };

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const REPORT_COLUMNS = [
  "AccountId",
  "CampaignId",
  "CampaignName",
  "CampaignStatus",
  "TimePeriod",
  "Impressions",
  "Clicks",
  "Spend",
  "Conversions",
  "Revenue",
] as const;

function ymdParts(ymd: string): { y: number; m: number; d: number } {
  const [y, m, d] = ymd.split("-").map(Number);
  return { y, m, d };
}

function dateBlock(elementName: string, ymd: string): string {
  const { y, m, d } = ymdParts(ymd);
  return `<${elementName}><Day>${d}</Day><Month>${m}</Month><Year>${y}</Year></${elementName}>`;
}

async function submitGenerateReport(
  accessToken: string,
  accountId: string,
  customerId: string,
  from: string,
  to: string
): Promise<string> {
  const columnsXml = REPORT_COLUMNS.map((c) => `<CampaignPerformanceReportColumn>${c}</CampaignPerformanceReportColumn>`).join("");
  const reportRequest = `<ReportRequest i:type="a:CampaignPerformanceReportRequest" xmlns:a="${REPORTING_NS}">
    <ExcludeColumnHeaders i:nil="false">false</ExcludeColumnHeaders>
    <ExcludeReportFooter i:nil="false">true</ExcludeReportFooter>
    <ExcludeReportHeader i:nil="false">true</ExcludeReportHeader>
    <Format i:nil="false">Csv</Format>
    <FormatVersion i:nil="false">2.0</FormatVersion>
    <ReportName i:nil="false">airex-${Date.now()}</ReportName>
    <ReturnOnlyCompleteData i:nil="false">false</ReturnOnlyCompleteData>
    <Aggregation i:nil="false">Daily</Aggregation>
    <Columns i:nil="false">${columnsXml}</Columns>
    <Scope>
      <AccountIds i:nil="false" xmlns:a1="http://schemas.microsoft.com/2003/10/Serialization/Arrays"><a1:long>${escapeXml(
        accountId
      )}</a1:long></AccountIds>
    </Scope>
    <Time>
      ${dateBlock("CustomDateRangeEnd", to)}
      ${dateBlock("CustomDateRangeStart", from)}
    </Time>
  </ReportRequest>`;
  const body = `<SubmitGenerateReportRequest xmlns="${REPORTING_NS}">${reportRequest}</SubmitGenerateReportRequest>`;
  const xml = await soapCallWithCustomer(
    REPORTING_URL,
    REPORTING_NS,
    "ReportingService",
    "SubmitGenerateReport",
    accessToken,
    accountId,
    customerId,
    body
  );
  const id = tag(xml, "ReportRequestId");
  if (!id) throw new Error(faultMessage(xml) ?? "レポートジョブの作成に失敗しました");
  return id;
}

/**
 * ジョブが Success になるまでポーリングし、ダウンロードURLを返す。
 *
 * Microsoft Learn の ReportRequestStatus 定義上、ReportDownloadUrl は Status が Success でも
 * 「対象期間にデータが1件もない場合は nil になりうる」と明記されている（2026-09 確認）。
 * つまり Success かつ ReportDownloadUrl 無し＝レポート取得の失敗ではなく「実績データなし」を
 * 意味する正常なケース。呼び出し元（fetchCampaignMetrics）はこれを空の実績として扱う。
 * 参照: https://learn.microsoft.com/en-us/advertising/reporting-service/reportrequeststatus?view=bingads-13
 */
async function pollGenerateReport(
  accessToken: string,
  accountId: string,
  customerId: string,
  reportRequestId: string
): Promise<string | null> {
  const MAX_ATTEMPTS = 20;
  const INTERVAL_MS = 3000;
  const body = `<PollGenerateReportRequest xmlns="${REPORTING_NS}"><ReportRequestId i:nil="false">${escapeXml(
    reportRequestId
  )}</ReportRequestId></PollGenerateReportRequest>`;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(INTERVAL_MS);
    const xml = await soapCallWithCustomer(
      REPORTING_URL,
      REPORTING_NS,
      "ReportingService",
      "PollGenerateReport",
      accessToken,
      accountId,
      customerId,
      body
    );
    const status = tag(xml, "Status");
    if (status === "Success") {
      // 対象期間に実績データが無いアカウント（新規連携直後など）では nil になりうる（上記コメント参照）
      return tag(xml, "ReportDownloadUrl");
    }
    if (status === "Error") {
      throw new Error(faultMessage(xml) ?? "レポートの生成に失敗しました");
    }
    // Pending ならもう少し待つ
  }
  throw new Error("レポートの生成に時間がかかっています。しばらくしてからもう一度お試しください。");
}

/** ダウンロードURLをGETし、ZIPを展開して中の1ファイルをテキストとして返す(認証不要。取得後すぐに使う) */
async function downloadAndUnzipReport(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`レポートのダウンロードに失敗しました（HTTP ${res.status}）`);
  const buf = await res.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);
  const first = Object.values(zip.files).find((f) => !f.dir);
  if (!first) throw new Error("レポートファイルが空でした（ZIP内にファイルが見つかりません）");
  return await first.async("text");
}

function parseNumber(v: string | undefined): number {
  if (!v) return 0;
  const n = Number(v.replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** "M/D/YYYY" 形式の日付を "YYYY-MM-DD" に正規化する(TimePeriod の実際の書式は未検証。他の形式ならそのまま返す) */
function normalizeDate(s: string): string {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return s;
  const [, mo, d, y] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

/** 1行分のCSVをセルの配列にする(ダブルクオート囲み・""エスケープに対応。キャンペーン名にカンマが入りうるため単純split不可) */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/** CSV(1行目がヘッダー。ExcludeReportHeader/ExcludeReportFooterをtrueにして送るので前後の付随情報はない)をパースする */
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const header = parseCsvLine(lines[0]);
  const out: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const row: Record<string, string> = {};
    header.forEach((h, idx) => {
      row[h] = cells[idx] ?? "";
    });
    out.push(row);
  }
  return out;
}

/**
 * 指定した広告アカウント1件のキャンペーン別実績・日別実績を取る(読み取りのみ)。
 * accountId は広告アカウント自身のID。customerId はその ParentCustomerId
 * (app/ad-actions.ts の saveMicrosoftSelection で保存時に Microsoft 側から取り直したもの)。
 * from / to は YYYY-MM-DD(両端を含む)。
 *
 * 1) GetCampaignsByAccountId でキャンペーンの名前・ステータスを取る(同期)。
 * 2) SubmitGenerateReport → PollGenerateReport → ダウンロードでCSVを取る(非同期。ZIP形式)。
 * 3) CampaignId で突き合わせて、キャンペーン別・日別に集計する。
 */
export async function fetchCampaignMetrics(
  accessToken: string,
  accountId: string,
  customerId: string,
  from: string,
  to: string
): Promise<{ campaigns: MicrosoftCampaignMetric[]; daily: MicrosoftDailyMetric[] }> {
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    throw new Error("パラメータが正しくありません");
  }

  const [campaigns, reportRequestId] = await Promise.all([
    microsoftCampaignList(accessToken, accountId, customerId),
    submitGenerateReport(accessToken, accountId, customerId, from, to),
  ]);

  const downloadUrl = await pollGenerateReport(accessToken, accountId, customerId, reportRequestId);
  if (!downloadUrl) {
    // 対象期間に実績データが無い（新規連携直後など）。エラーではなく、キャンペーン名だけ
    // わかっている状態で実績ゼロとして返す（Google/ヤフーLINE広告が0件レスポンスを
    // 空配列として扱うのと同じ挙動に揃える）。
    return {
      campaigns: [...campaigns.entries()].map(([id, c]) => ({
        id,
        name: c.name,
        status: c.status,
        cost: 0,
        impressions: 0,
        clicks: 0,
        conversions: 0,
        conversionsValue: 0,
      })),
      daily: [],
    };
  }
  const csvText = await downloadAndUnzipReport(downloadUrl);
  const rows = parseCsv(csvText);

  const byCampaign = new Map<string, MicrosoftCampaignMetric>();
  const byDate = new Map<string, MicrosoftDailyMetric>();
  for (const row of rows) {
    const id = row["CampaignId"] ?? "";
    if (!id) continue;
    const date = normalizeDate(row["TimePeriod"] ?? "");
    const cost = parseNumber(row["Spend"]);
    const impressions = parseNumber(row["Impressions"]);
    const clicks = parseNumber(row["Clicks"]);
    const conversions = parseNumber(row["Conversions"]);
    const conversionsValue = parseNumber(row["Revenue"]);

    const known = campaigns.get(id);
    const c = byCampaign.get(id) ?? {
      id,
      name: known?.name ?? row["CampaignName"] ?? id,
      status: known?.status ?? "",
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
