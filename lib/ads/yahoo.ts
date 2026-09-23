/**
 * ヤフーLINE広告 API（Search Ads API / LY Ads）の最小クライアント（アカウント一覧の発見・MCC配下の展開に使う）。
 * 2026-09 に「Yahoo!広告」から名称変更。API・エンドポイント名は変わらない。
 *
 * - ベースURL: https://ads-search.yahooapis.jp/api/v19
 * - 認証: Authorization: Bearer {アクセストークン}
 * - リクエストボディは「{selector: {...}}」ではなく、Selectorオブジェクトそのものを直接渡す
 *   （公式OpenAPI定義で確認済み。yahoojp-marketing/ads-search-api-documents
 *   design/v19/{baseaccount,accountlink,account}/*.yaml）。
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
