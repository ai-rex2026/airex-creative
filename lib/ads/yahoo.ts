/**
 * ヤフーLINE広告 API（Search Ads API / LY Ads）の最小クライアント（アカウント一覧の発見・MCC配下の展開に使う）。
 * 2026-09 に「Yahoo!広告」から名称変更。API・エンドポイント名は変わらない。
 *
 * - ベースURL: https://ads-search.yahooapis.jp/api/v19
 * - 認証: Authorization: Bearer {アクセストークン}
 * - リクエストボディは「{selector: {...}}」ではなく、Selectorオブジェクトそのものを直接渡す
 *   （公式OpenAPI定義で確認済み。yahoojp-marketing/ads-search-api-documents
 *   design/v19/{baseaccount,accountlink}/*.yaml）。
 *
 * BaseAccountService/getのレスポンス形式（2026-09、本番の実レスポンスで確認済み）:
 * {
 *   "rval": {
 *     "authorizationBusinessId": "...",
 *     "totalNumEntries": 2,
 *     "values": [
 *       {
 *         "account": {
 *           "accountId": 1002473759,
 *           "accountName": "株式会社アドレクス",
 *           "accountStatus": "SERVING",
 *           "isMccAccount": "TRUE",        // 文字列 "TRUE"/"FALSE"
 *           "isRootMccAccount": "TRUE",
 *           ...
 *         },
 *         "errors": null,
 *         "operationSucceeded": true
 *       },
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
 * MCC配下の展開（yahooChildAccounts）について、調査の経緯（最終的な結論は末尾）:
 * 1回目: BaseAccountService/get に x-z-base-account-id ヘッダー（MCCのID）を付ければ
 * Google の login-customer-id と同じように配下が取れると仮定 → 本番で確認したところ
 * このヘッダーは BaseAccountService/get には効果がなく（常に自分の直接権限分だけが返る）、誤りだった。
 * 2回目: OpenAPI定義（design/v19/accountlink/）から、MCC配下の列挙は別サービス
 * **AccountLinkService/get**（Google の customer_client クエリに相当）だと判明。こちらは
 * x-z-base-account-id: <MCCのaccountId> が必須（本番のエラーで確認済み）で、配下の
 * accountId・accountStatus・ownerShipType（OWNER=同一企業内／NON_OWNER=他企業）の一覧が取れる
 * （accountName は含まれない）。代理店の MCC には、クライアント別企業の NON_OWNER アカウントが
 * ひもづくのが普通。
 * 3回目: 配下の accountId を BaseAccountService/get の `{ accountIds: [...] }` セレクタに渡して
 * 名前を引き直そうとしたが、NON_OWNER の子アカウントでは常に `totalNumEntries: 0, values: null`
 * （＝該当エントリそのものが返らない）になり、名前が一切引けない不具合を確認。
 * 4回目（確定・根本原因）: 公式OpenAPI定義（design/v19/Route.yaml）を直接確認したところ、
 * BaseAccountService/get のエンドポイント定義には x-z-base-account-id ヘッダーのパラメータが
 * そもそも存在しない（AccountService/get・AccountLinkService/get・AccountManagementService/get には
 * `parameters: - in: header, name: x-z-base-account-id, required: true` があるが、
 * BaseAccountService/get にはない）。さらに公式説明文に「操作対象のビジネスIDが直接権限を持つ
 * 全てのアカウントの一覧を取得します」と明記されている。つまり BaseAccountService/get は常に
 * 「このアクセストークンの持ち主（代理店のビジネスID）が直接権限を持つアカウント」だけを返す
 * 仕様で、ヘッダーや accountIds セレクタで絞り込んでも、直接権限のないアカウント（NON_OWNER の
 * 他社アカウントなど）は決して含まれない。AccountService/get（アカウント設定の取得）も同様に、
 * x-z-base-account-id に指定できるのは「BaseAccountService/get で取得可能なアカウントID」に
 * 限定されると公式に明記されており、同じ理由で NON_OWNER アカウントには使えない。
 * → 結論：現状の API 仕様では、代理店のビジネスIDが直接権限を持たない NON_OWNER アカウントの
 * 名前を取得する公式な手段は存在しない。AccountLinkService/get で MCC 配下のリンク（ID・
 * ステータス・ownerShipType）は見えても、そのアカウント自体の詳細（名前）を引く経路が API 上に
 * ない。これはコードの不具合ではなく、ヤフーLINE広告 API の権限モデル上の制約であり、名前を
 * 表示するには各クライアントアカウント側でこのビジネスIDに「直接の操作権限（担当者権限）」を
 * 別途付与してもらう必要がある（MCC配下へのリンクだけでは不十分）。それまでの間、コード側では
 * ID をそのまま名前として表示する（選べなくはしない）。
 */

const BASE = process.env.YAHOO_ADS_API_BASE || "https://ads-search.yahooapis.jp/api/v19";

export type YahooAccount = { id: string; name: string; manager?: boolean };

/** rval.values の各エントリは { account: {...}, errors, operationSucceeded } でラップされている */
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
 * 2) BaseAccountService/get にその accountIds を渡して名前・MCC判定を引き直す。
 * ただし、代理店のビジネスIDが「直接の操作権限」を持たない NON_OWNER（他企業＝クライアント）の
 * 子アカウントは、BaseAccountService/get の仕様上そもそも結果に含まれない（ヘッダーや
 * accountIds セレクタでは絞り込めない、公式OpenAPI定義で確認済み。ファイル冒頭のコメント参照）。
 * その場合は ID をそのまま名前として返しつつ、原因（直接の操作権限が必要）を nameLookupError に
 * 入れて返す（選べなくはしない）。
 */
export async function yahooChildAccounts(accessToken: string, mccId: string): Promise<YahooChildAccountsResult> {
  const links = await accountLinks(accessToken, mccId);
  const childIds = [...new Set(links.map((l) => l.accountId).filter((id) => id !== mccId))];
  if (childIds.length === 0) {
    throw new Error("MCC自身以外に配下のアカウントが見つかりませんでした。");
  }
  const ownerShipById = new Map(links.map((l) => [l.accountId, l.ownerShipType]));

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
      // 名前の引き直しに失敗しても、下で ID フォールバックするのでここでは止めない
    }
  }

  const accounts = childIds.map((id) => byId.get(id) ?? { id, name: id, manager: false });
  const unresolvedIds = accounts.filter((a) => a.name === a.id).map((a) => a.id);
  const unresolvedNonOwner = unresolvedIds.filter((id) => ownerShipById.get(id) === "NON_OWNER").length;
  const nameLookupError =
    unresolvedIds.length > 0
      ? `${unresolvedIds.length}/${accounts.length}件のアカウント名を取得できませんでした（IDをそのまま表示しています）。` +
        (unresolvedNonOwner > 0
          ? `うち${unresolvedNonOwner}件は他社（クライアント）のアカウント（NON_OWNER）です。ヤフーLINE広告APIの仕様上、この代理店ビジネスIDに直接の操作権限（担当者権限）がないアカウントは名前を取得できません。名前を表示するには、各クライアントのヤフーLINE広告アカウント側で、このビジネスIDに直接の操作権限を付与してもらう必要があります（MCC配下へのリンクだけでは不十分です）。`
          : "")
      : undefined;

  return { accounts, nameLookupError };
}
