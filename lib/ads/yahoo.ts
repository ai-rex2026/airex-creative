/**
 * ヤフーLINE広告 API（Search Ads API / LY Ads）の最小クライアント（アカウント一覧の発見・MCC配下の展開・実績取得に使う）。
 * 2026-09 に「Yahoo!広告」から名称変更。API・エンドポイント名は変わらない。
 *
 * - ベースURL: https://ads-search.yahooapis.jp/api/v19
 * - 認証: Authorization: Bearer {アクセストークン}
 * - リクエストボディは「{selector: {...}}」ではなく、Selectorオブジェクトそのものを直接渡す
 *   （公式OpenAPI定義で確認済み。yahoojp-marketing/ads-search-api-documents
 *   design/v19/{baseaccount,accountlink,account,campaign,reportdefinition}/*.yaml）。
 *
 * BaseAccountService/get・AccountService/get のレスポンス形式は同じ
 * （2026-09、本番の実レスポンス・公式OpenAPI定義の両方で確認済み）:
 * {
 *   "rval": {
 *     "authorizationBusinessId": "...",
 *     "totalNumEntries": 2,
 *     "values": [
 *       { "account": { "accountId": 1002473759, "accountName": "株式会社アドレクス",
 *           "accountStatus": "SERVING", "isMccAccount": "TRUE", "isRootMccAccount": "TRUE", ... },
 *         "errors": null, "operationSucceeded": true },
 *       { "account": { "accountId": 1279455, "accountName": "ゆりかご", "isMccAccount": "FALSE", ... }, ... }
 *     ]
 *   }
 * }
 * 各エントリは account 本体を errors/operationSucceeded と一緒にラップして返す。
 * MCC 判定は accountType ではなく isMccAccount / isRootMccAccount（文字列）で行う。
 *
 * 失敗しても discoverAccounts の呼び出し元（lib/ads/accounts.ts）が例外を捕まえて
 * 「アカウント一覧を取れませんでした：〜」という注記に変えるので、連携（トークン保存）
 * 自体は失敗しない。
 *
 * MCC配下の子アカウントの「名前」が取れない問題について、調査の経緯と最終結論（2026-09）:
 * 1回目〜3回目: BaseAccountService/get への x-z-base-account-id ヘッダーは効果なし。配下の列挙は
 * AccountLinkService/get（accountId・ownerShipType のみ、accountName は含まない）で行う必要があると判明。
 * その accountId を BaseAccountService/get の `{ accountIds: [...] }` に渡しても、NON_OWNER
 * （他企業＝クライアント）の子アカウントは常に `totalNumEntries: 0` で名前が引けないことを確認。
 * 4回目: ユーザーに管理画面での見え方を確認 → MCCの管理画面上ではこれらNON_OWNERアカウントも
 * 名前付きで表示され、クリックしてキャンペーンまで操作できる。つまりブラウザ側は十分な権限を持つ。
 * 5回目（最終結論）: ユーザーが実際に各広告アカウント側の「権限管理＞ユーザー」を確認したところ、
 * MCCとリンクされているだけのビジネスIDはそこには現れない（＝各アカウント個別の担当者としては
 * 登録されていない）ことを確認。さらに公式OpenAPI定義（Route.yaml）を全サービス横断で確認した結果、
 * 「x-z-base-account-idに指定可能なアカウントIDはBaseAccountService/getで取得可能なものに限る」という
 * 制限文言が付いているのは AccountService/get と SsaAccountService/get の2つ（＝アカウント情報を
 * 引く系のサービス）だけで、CampaignService/get・AdGroupService/get・ReportDefinitionService/get
 * などキャンペーン・実績を扱う系のサービスにはこの制限が書かれていない（単に「アカウントIDを
 * 指定してください」とあるのみ）。
 *
 * つまり: 「MCCへのアカウントリンク」と「そのアカウントへの直接の権限（担当者登録）」は別レイヤーで、
 * BaseAccountService/get・AccountService/get による名前解決には後者が必須。MCCリンクだけでは
 * 広告アカウント名は取得できない（＝クライアント側にそのアカウントの担当者としてこのビジネスIDを
 * 追加登録してもらう以外に解決方法はない）。一方、実際のキャンペーン・実績データの取得は別の
 * エンドポイント群であり、同じ制限は仕様上かかっていないため、MCCリンクだけでも取得できる可能性が
 * 高い（実装時に要検証）。この結論に基づき、常に失敗する AccountService/get への個別リトライは
 * 削除した（同じ「直接権限」制限を持つため、一括取得で引けなかった名前は個別に試しても引けない）。
 *
 * 実績データ取得（CampaignService/get・ReportDefinitionService）について（2026-09、下部に追加）:
 * 名前解決とは別に、公式OpenAPI定義を確認したところ CampaignService/get には「直接権限」の制限が
 * 付いておらず、MCCリンクだけの子アカウントでもキャンペーンの id・名前・ステータスは同期で取れる
 * はず（未実測・実装時に要検証）。一方、実際の数値（費用・表示回数・クリック数・コンバージョン等）は
 * Google の googleAds:search のような同期の検索APIが存在せず、ReportDefinitionService の
 * 非同期ジョブ（add でジョブ作成 → get でポーリング → download でTSV取得）でのみ取れる。
 * レポートに使えるフィールド名（fieldName）はレポート種別ごとに動的で、固定のenumとしては
 * 定義されていないため、毎回 getReportFields を呼んで日本語名・英語名でマッチングする
 * （getReportFields 自体はアカウント非依存でヘッダー不要。公式OpenAPI定義で確認済み）。
 */

const BASE = process.env.YAHOO_ADS_API_BASE || "https://ads-search.yahooapis.jp/api/v19";

export type YahooAccount = { id: string; name: string; manager?: boolean };

/** rval.values の各エントリは { account: {...}, errors, operationSucceeded } でラップされている（BaseAccountService/get・AccountService/get 共通） */
function extractAccounts(j: unknown): YahooAccount[] {
  const candidates: unknown[] = [];
  if (j && typeof j === "object") {
    const o = j as Record<string, unknown>;
    for (const key of ["values", "accounts", "baseAccounts", "rval"]) {
      const v = o[key];
      if (Array.isArray(v)) candidates.push(...v);
      else if (v && typeof v === "object" && Array.isArray((v as Record<string, unknown>).values)) {
        candidates.push(...((v as Record<string, unknown>).values as unknown[]));
      }
    }
  }
  const out: YahooAccount[] = [];
  for (const c of candidates) {
    if (!c || typeof c !== "object") continue;
    let r = c as Record<string, unknown>;
    if (r.operationSucceeded === false) continue; // 個別に失敗したエントリはスキップ
    if (r.account && typeof r.account === "object") {
      r = r.account as Record<string, unknown>; // { account: {...} } のラップを剥がす
    }
    const id = r.accountId ?? r.baseAccountId ?? r.id;
    const name = r.accountName ?? r.name;
    const isMcc =
      r.isMccAccount === "TRUE" ||
      r.isMccAccount === true ||
      r.isRootMccAccount === "TRUE" ||
      r.isRootMccAccount === true ||
      (typeof (r.accountType ?? r.type) === "string" && /mcc|manager/i.test(String(r.accountType ?? r.type)));
    if (id != null) {
      out.push({ id: String(id), name: name != null ? String(name) : String(id), manager: isMcc });
    }
  }
  return out;
}

/** 連携直後に、このアクセストークンでアクセスできる全アカウント（MCC・広告アカウント）を取る */
export async function yahooBaseAccounts(accessToken: string): Promise<YahooAccount[]> {
  const res = await fetch(`${BASE}/BaseAccountService/get`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let j: unknown = {};
  try {
    j = JSON.parse(text);
  } catch {
    // JSON以外が返るのは想定外。ステータスと本文の先頭をそのままエラーに出す
  }
  if (!res.ok) {
    const msg =
      j && typeof j === "object" && "message" in (j as Record<string, unknown>)
        ? String((j as Record<string, unknown>).message)
        : text.slice(0, 200) || `HTTP ${res.status}`;
    throw new Error(`ヤフーLINE広告のアカウント一覧を取得できませんでした：${msg}`);
  }
  const accounts = extractAccounts(j);
  if (accounts.length === 0) {
    // 調査用：実際のレスポンスの先頭を注記にそのまま出す（トークン等の秘匿情報は含まれない。
    // これで実際のフィールド名が分かり次第、上の extractAccounts の候補を直す）
    throw new Error(
      `ヤフーLINE広告のアカウント一覧のレスポンス形式が想定と異なります（要確認）。実際のレスポンス：${text.slice(0, 500)}`
    );
  }
  return accounts;
}

type AccountLink = { accountId: string; accountStatus?: string; ownerShipType?: string };

/**
 * AccountLinkService/get: MCC の accountId を渡すと、配下にリンクされているアカウントIDの一覧が返る（名前は含まない）。
 * x-z-base-account-id ヘッダー（=このMCCのaccountId）が必須（公式OpenAPI定義・本番のエラー両方で確認済み）。
 */
async function accountLinks(accessToken: string, mccId: string): Promise<AccountLink[]> {
  const res = await fetch(`${BASE}/AccountLinkService/get`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      "x-z-base-account-id": mccId,
    },
    body: JSON.stringify({ mccAccountId: Number(mccId) }),
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let j: unknown = {};
  try {
    j = JSON.parse(text);
  } catch {
    // JSON以外
  }
  if (!res.ok) {
    const msg =
      j && typeof j === "object" && "message" in (j as Record<string, unknown>)
        ? String((j as Record<string, unknown>).message)
        : text.slice(0, 300) || `HTTP ${res.status}`;
    throw new Error(`MCC配下のアカウントリンクを取得できませんでした：${msg}`);
  }
  const candidates: unknown[] = [];
  if (j && typeof j === "object") {
    const rval = (j as Record<string, unknown>).rval;
    if (rval && typeof rval === "object" && Array.isArray((rval as Record<string, unknown>).values)) {
      candidates.push(...((rval as Record<string, unknown>).values as unknown[]));
    }
  }
  const out: AccountLink[] = [];
  for (const c of candidates) {
    if (!c || typeof c !== "object") continue;
    const r = c as Record<string, unknown>;
    if (r.operationSucceeded === false) continue;
    const link = (r.accountLink && typeof r.accountLink === "object" ? r.accountLink : r) as Record<string, unknown>;
    const id = link.accountId;
    if (id != null) {
      out.push({
        accountId: String(id),
        accountStatus: link.accountStatus != null ? String(link.accountStatus) : undefined,
        ownerShipType: link.ownerShipType != null ? String(link.ownerShipType) : undefined,
      });
    }
  }
  if (out.length === 0) {
    // 調査用：本当に配下が0件なのか、レスポンス形式が想定と違うのかを見分けるため
    throw new Error(
      `MCCの配下にリンクされたアカウントが見つかりませんでした。実際のレスポンス：${text.slice(0, 800)}`
    );
  }
  return out;
}

export type YahooChildAccountsResult = {
  accounts: YahooAccount[];
  /** 配下は取れたが、一部または全部のアカウント名が引き直せなかった場合の注記（表示は呼び出し元に任せる） */
  nameLookupError?: string;
};

/**
 * MCC の配下にある広告アカウントを取る（Google の listChildCustomers に相当）。
 * 1) AccountLinkService/get で配下の accountId・ownerShipType 一覧を取り（名前は含まない）、
 * 2) BaseAccountService/get にその accountIds を渡して名前・MCC判定を一括で引き直す。
 * ヤフーLINE広告APIの仕様上、名前が取れるのは「そのビジネスIDが直接の権限（担当者登録）を
 * 持つアカウント」だけで、MCCとのアカウントリンクだけでは不足する（詳細は本ファイル冒頭のコメント）。
 * 引けなかったものは ID をそのまま名前として返しつつ、原因を nameLookupError に入れて返す
 * （選べなくはしない）。
 */
export async function yahooChildAccounts(accessToken: string, mccId: string): Promise<YahooChildAccountsResult> {
  const links = await accountLinks(accessToken, mccId);
  const childIds = [...new Set(links.map((l) => l.accountId).filter((id) => id !== mccId))];
  if (childIds.length === 0) {
    throw new Error("MCC自身以外に配下のアカウントが見つかりませんでした。");
  }

  const byId = new Map<string, YahooAccount>();

  for (let i = 0; i < childIds.length; i += 200) {
    const chunk = childIds.slice(i, i + 200).map(Number);
    try {
      const res = await fetch(`${BASE}/BaseAccountService/get`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ accountIds: chunk }),
        signal: AbortSignal.timeout(20000),
      });
      if (res.ok) {
        const j = await res.json().catch(() => ({}));
        for (const a of extractAccounts(j)) byId.set(a.id, a);
      }
    } catch {
      // 一括取得に失敗した分は ID フォールバックに任せる
    }
  }

  const accounts = childIds.map((id) => byId.get(id) ?? { id, name: id, manager: false });
  const unresolved = accounts.filter((a) => a.name === a.id).length;
  const nameLookupError =
    unresolved > 0
      ? `${unresolved}/${accounts.length}件のアカウント名を取得できませんでした（IDをそのまま表示しています）。` +
        `ヤフーLINE広告APIの仕様上、広告アカウント自体の権限（そのアカウントへの担当者としての直接登録）がない場合、` +
        `MCCとのアカウントリンクのみでは広告アカウント名の取得はできません。` +
        `名前まで表示したい場合は、対象のクライアントに各広告アカウント側で担当者権限を付与してもらってください。`
      : undefined;

  return { accounts, nameLookupError };
}

/* ------------------------------------------------------------------
 * キャンペーン別の実績（読み取りのみ）
 * ------------------------------------------------------------------ */

export type YahooCampaignMetric = {
  id: string;
  name: string;
  status: string;
  cost: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionsValue: number;
};

export type YahooDailyMetric = Omit<YahooCampaignMetric, "id" | "name" | "status"> & { date: string };

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const CAMPAIGN_STATUS_JA: Record<string, string> = { ACTIVE: "有効", PAUSED: "停止中" };

function ymdCompact(ymd: string): string {
  return ymd.replace(/-/g, ""); // "2026-09-01" -> "20260901"
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** POST してJSONを返す共通ヘルパー（レポート系・キャンペーン系で使う） */
async function postJson(path: string, accessToken: string, accountId: string | null, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      ...(accountId ? { "x-z-base-account-id": accountId } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let j: unknown = {};
  try {
    j = JSON.parse(text);
  } catch {
    // JSON以外
  }
  if (!res.ok) {
    const msg =
      j && typeof j === "object" && "message" in (j as Record<string, unknown>)
        ? String((j as Record<string, unknown>).message)
        : text.slice(0, 300) || `HTTP ${res.status}`;
    throw new Error(`${path} 失敗（HTTP ${res.status}）：${msg}`);
  }
  return (j && typeof j === "object" ? (j as Record<string, unknown>) : {});
}

/**
 * CampaignService/get: アカウント自身の立場でキャンペーンの id・名前・ステータスを取る（同期）。
 * 公式OpenAPI定義に「直接権限」の制限が書かれていないサービスなので、MCCリンクだけの
 * 子アカウントでも取れるはず（未実測・実装時に要検証。詳細は本ファイル冒頭のコメント）。
 */
async function campaignList(accessToken: string, accountId: string): Promise<Map<string, { name: string; status: string }>> {
  const j = await postJson("/CampaignService/get", accessToken, accountId, {
    accountId: Number(accountId),
    userStatuses: ["ACTIVE", "PAUSED"],
    numberResults: 10000,
  });
  const out = new Map<string, { name: string; status: string }>();
  const values = ((j.rval as Record<string, unknown> | undefined)?.values ?? []) as unknown[];
  for (const v of values) {
    if (!v || typeof v !== "object") continue;
    const r = v as Record<string, unknown>;
    if (r.operationSucceeded === false) continue;
    const c = (r.campaign && typeof r.campaign === "object" ? r.campaign : r) as Record<string, unknown>;
    const id = c.campaignId;
    if (id == null) continue;
    const status = String(c.userStatus ?? "");
    out.set(String(id), {
      name: c.campaignName != null ? String(c.campaignName) : String(id),
      status: CAMPAIGN_STATUS_JA[status] ?? status,
    });
  }
  return out;
}

type ReportField = { fieldName: string; ja: string; en: string };
const reportFieldsCache = new Map<string, ReportField[]>();

/**
 * ReportDefinitionService/getReportFields: レポート種別ごとに使えるフィールド名一覧を取る。
 * アカウント非依存・ヘッダー不要（公式OpenAPI定義で確認済み）。同じアクセストークンの間はプロセス内キャッシュする。
 */
async function getReportFields(accessToken: string, reportType: string): Promise<ReportField[]> {
  const cached = reportFieldsCache.get(reportType);
  if (cached) return cached;
  const j = await postJson("/ReportDefinitionService/getReportFields", accessToken, null, { reportType });
  const rval = j.rval as Record<string, unknown> | undefined;
  const fields = ((rval?.fields ?? []) as unknown[])
    .filter((f): f is Record<string, unknown> => !!f && typeof f === "object")
    .map((f) => ({
      fieldName: String(f.fieldName ?? ""),
      ja: String(f.displayFieldNameJa ?? ""),
      en: String(f.displayFieldNameEn ?? ""),
    }))
    .filter((f) => f.fieldName);
  reportFieldsCache.set(reportType, fields);
  return fields;
}

/** 候補（fieldName・日本語名・英語名のどれか）に完全一致するフィールドを探す */
function pickField(fields: ReportField[], candidates: string[]): ReportField | undefined {
  for (const cand of candidates) {
    const hit = fields.find((f) => f.fieldName === cand || f.ja === cand || f.en === cand);
    if (hit) return hit;
  }
  return undefined;
}

type ReportColumns = {
  campaignId: ReportField;
  day: ReportField;
  cost: ReportField;
  impressions: ReportField;
  clicks: ReportField;
  conversions?: ReportField;
  conversionsValue?: ReportField;
};

/** CAMPAIGN レポートで使うフィールドを、getReportFields の結果から名前でマッチングして決める */
async function resolveCampaignReportColumns(accessToken: string): Promise<ReportColumns> {
  const fields = await getReportFields(accessToken, "CAMPAIGN");
  const campaignId = pickField(fields, ["CampaignId", "キャンペーンID"]);
  const day = pickField(fields, ["Day", "日"]);
  const cost = pickField(fields, ["Cost", "費用"]);
  const impressions = pickField(fields, ["Impressions", "Imps", "表示回数"]);
  const clicks = pickField(fields, ["Clicks", "クリック数"]);
  const conversions = pickField(fields, ["Conversions", "コンバージョン数"]);
  const conversionsValue = pickField(fields, [
    "ConversionValue",
    "TotalConversionValue",
    "コンバージョン価値",
    "コンバージョン値",
  ]);
  if (!campaignId || !day || !cost || !impressions || !clicks) {
    throw new Error(
      `レポートの必須フィールドが見つかりませんでした（campaignId=${campaignId?.fieldName}, day=${day?.fieldName}, ` +
        `cost=${cost?.fieldName}, impressions=${impressions?.fieldName}, clicks=${clicks?.fieldName}）。` +
        `利用可能なフィールド：${fields.map((f) => `${f.fieldName}(${f.ja}/${f.en})`).join(", ")}`
    );
  }
  return { campaignId, day, cost, impressions, clicks, conversions, conversionsValue };
}

/** ReportDefinitionService/add: レポートジョブを作る。reportJobId を返す */
async function addReportJob(accessToken: string, accountId: string, columns: ReportColumns, from: string, to: string): Promise<string> {
  const fields = [columns.campaignId, columns.day, columns.cost, columns.impressions, columns.clicks, columns.conversions, columns.conversionsValue]
    .filter((f): f is ReportField => !!f)
    .map((f) => f.fieldName);
  const j = await postJson("/ReportDefinitionService/add", accessToken, accountId, {
    accountId: Number(accountId),
    operand: [
      {
        reportName: `airex-${Date.now()}`,
        reportType: "CAMPAIGN",
        reportDateRangeType: "CUSTOM_DATE",
        dateRange: { startDate: ymdCompact(from), endDate: ymdCompact(to) },
        fields,
        reportDownloadFormat: "TSV",
        reportLanguage: "EN",
        reportSkipReportSummary: "TRUE",
        reportSkipColumnHeader: "FALSE",
      },
    ],
  });
  const rval = j.rval as Record<string, unknown> | undefined;
  const values = (rval?.values ?? []) as unknown[];
  const v = values[0] as Record<string, unknown> | undefined;
  if (!v || v.operationSucceeded === false) {
    const errs = Array.isArray(v?.errors) ? v!.errors : [];
    const msg = errs[0] && typeof errs[0] === "object" ? String((errs[0] as Record<string, unknown>).message ?? "") : "";
    throw new Error(msg || "レポートジョブの作成に失敗しました");
  }
  const def = v.reportDefinition as Record<string, unknown> | undefined;
  const jobId = def?.reportJobId;
  if (jobId == null) throw new Error("reportJobId が取得できませんでした");
  return String(jobId);
}

/** ReportDefinitionService/get をポーリングして、ジョブが COMPLETED になるまで待つ */
async function waitReportJob(accessToken: string, accountId: string, jobId: string): Promise<void> {
  const MAX_ATTEMPTS = 15;
  const INTERVAL_MS = 1500;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(INTERVAL_MS);
    const j = await postJson("/ReportDefinitionService/get", accessToken, accountId, {
      accountId: Number(accountId),
      reportJobIds: [Number(jobId)],
    });
    const rval = j.rval as Record<string, unknown> | undefined;
    const values = (rval?.values ?? []) as unknown[];
    const v = values[0] as Record<string, unknown> | undefined;
    const def = v?.reportDefinition as Record<string, unknown> | undefined;
    const status = def?.reportJobStatus;
    if (status === "COMPLETED") return;
    if (status === "FAILED") {
      throw new Error(`レポートの作成に失敗しました：${def?.reportJobErrorDetail ?? "詳細不明"}`);
    }
    // WAIT・IN_PROGRESS ならもう少し待つ
  }
  throw new Error("レポートの生成に時間がかかっています。しばらくしてからもう一度お試しください。");
}

/** ReportDefinitionService/download: 完成したレポートをTSVのテキストとして取る */
async function downloadReport(accessToken: string, accountId: string, jobId: string): Promise<string> {
  const res = await fetch(`${BASE}/ReportDefinitionService/download`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      "x-z-base-account-id": accountId,
    },
    body: JSON.stringify({ accountId: Number(accountId), reportJobId: Number(jobId) }),
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`レポートのダウンロードに失敗しました（HTTP ${res.status}）：${text.slice(0, 300)}`);
  }
  return text;
}

/** 後片付け（ベストエフォート。失敗しても実績取得自体は成立しているので無視する） */
async function removeReportJob(accessToken: string, accountId: string, jobId: string): Promise<void> {
  try {
    await postJson("/ReportDefinitionService/remove", accessToken, accountId, {
      accountId: Number(accountId),
      operand: [{ reportJobId: Number(jobId) }],
    });
  } catch {
    // 無視（レポート定義が残っても実害はない）
  }
}

function parseNumber(v: string | undefined): number {
  if (!v) return 0;
  const n = Number(v.replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** TSV（1行目がヘッダー）を、英語表示名 → 値 の行の配列にパースする */
function parseTsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const header = lines[0].split("\t");
  const out: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split("\t");
    const row: Record<string, string> = {};
    header.forEach((h, idx) => {
      row[h] = cells[idx] ?? "";
    });
    out.push(row);
  }
  return out;
}

/**
 * MCC 配下も含めて、指定した広告アカウント1件のキャンペーン別実績・日別実績を取る（読み取りのみ）。
 * accountId は広告アカウント自身のID（MCCのIDではない）。from / to は YYYY-MM-DD（両端を含む）。
 *
 * 1) CampaignService/get でキャンペーンの名前・ステータスを取る（同期）。
 * 2) ReportDefinitionService でレポートジョブを作り、完了を待ってTSVをダウンロードする（非同期）。
 * 3) campaignId で突き合わせて、キャンペーン別・日別に集計する。
 */
export async function fetchCampaignMetrics(
  accessToken: string,
  accountId: string,
  from: string,
  to: string
): Promise<{ campaigns: YahooCampaignMetric[]; daily: YahooDailyMetric[] }> {
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    throw new Error("パラメータが正しくありません");
  }

  const [campaigns, columns] = await Promise.all([
    campaignList(accessToken, accountId),
    resolveCampaignReportColumns(accessToken),
  ]);

  const jobId = await addReportJob(accessToken, accountId, columns, from, to);
  let tsv: string;
  try {
    await waitReportJob(accessToken, accountId, jobId);
    tsv = await downloadReport(accessToken, accountId, jobId);
  } finally {
    void removeReportJob(accessToken, accountId, jobId);
  }
  const rows = parseTsv(tsv);

  const byCampaign = new Map<string, YahooCampaignMetric>();
  const byDate = new Map<string, YahooDailyMetric>();
  for (const row of rows) {
    const id = row[columns.campaignId.en] ?? "";
    if (!id) continue;
    const date = row[columns.day.en] ?? "";
    const cost = parseNumber(row[columns.cost.en]);
    const impressions = parseNumber(row[columns.impressions.en]);
    const clicks = parseNumber(row[columns.clicks.en]);
    const conversions = columns.conversions ? parseNumber(row[columns.conversions.en]) : 0;
    const conversionsValue = columns.conversionsValue ? parseNumber(row[columns.conversionsValue.en]) : 0;

    const known = campaigns.get(id);
    const c = byCampaign.get(id) ?? {
      id,
      name: known?.name ?? id,
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
