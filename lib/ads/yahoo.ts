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
 * MCC配下の子アカウントの「名前」の取得について、調査の経緯:
 * 1回目: BaseAccountService/get に x-z-base-account-id ヘッダー（MCCのID）を付ければ
 * Google の login-customer-id と同じように配下が取れると仮定 → 本番で確認したところ
 * このヘッダーは BaseAccountService/get には効果がなく（常に自分の直接権限分だけが返る）、誤りだった。
 * 2回目: OpenAPI定義から、MCC配下の列挙は別サービス **AccountLinkService/get**
 * （x-z-base-account-id: MCCのaccountId が必須）だと判明。accountId・accountStatus・
 * ownerShipType（OWNER=同一企業内／NON_OWNER=他企業）の一覧が取れる（accountName は含まない）。
 * 3回目: 配下の accountId を BaseAccountService/get の `{ accountIds: [...] }` に渡して名前を
 * 引き直そうとしたが、NON_OWNER の子アカウントでは常に `totalNumEntries: 0, values: null` になり、
 * 名前が一切引けない不具合を確認。公式OpenAPI定義（Route.yaml）にも「操作対象のビジネスIDが
 * 直接権限を持つ全てのアカウントの一覧を取得します」とあり、BaseAccountService/get はこのビジネスIDが
 * 直接権限を持つアカウントしか返さない、と一旦結論づけた。
 * 4回目（3回目の結論は誤り・訂正）: ユーザーに実際の管理画面での見え方を確認したところ、
 * MCCの管理画面上ではこれらNON_OWNERアカウントも名前付きで一覧表示され、クリックして中の
 * キャンペーンまで操作・閲覧できるとのこと。つまりブラウザでログインしているビジネスID自体は
 * これらのアカウントに対して十分な権限を持っている。BaseAccountService/get が空を返すのは
 * 「権限がない」からではなく、この API が“直接（MCC階層を介さない）権限”という狭い定義でしか
 * 絞り込めない仕様上の制約であり、OAuth連携で使っているビジネスIDそのものの実際の権限とは
 * 一致しない。そこで、BaseAccountService/get より広い範囲を見られる可能性のある
 * **AccountService/get**（x-z-base-account-id にそのアカウント自身のIDを指定して「そのアカウントの
 * 立場として」問い合わせる。公式定義ではヘッダーに指定できるIDはBaseAccountService/getで取得
 * 可能なものに限る、と説明されているが、これはあくまで“推奨される調べ方”の説明であり、実際に
 * MCC経由で操作権限がある子アカウント自身のIDを指定した場合にどう振る舒うかは未検証だったため、
 * 名前が引けなかった子アカウントに対してだけ 1件ずつこの方法で追加リトライするようにした。
 * これでも名前が取れない場合は、原因（HTTPステータス・レスポンス本文）を nameLookupError として
 * 呼び出し元に返す。
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

/**
 * AccountService/get: x-z-base-account-id で指定したアカウント自身の立場として、そのアカウントの
 * 詳細（名前など）を取る。BaseAccountService/get の `{ accountIds: [...] }` で名前が引けなかった
 * 子アカウントに対して、1件ずつ「そのアカウント自身のID」をヘッダーに指定して追加で試す
 * （公式定義ではヘッダーに指定可能なIDはBaseAccountService/getで取得可能なものに限るとされて
 * いるが、MCC経由で実際に操作権限がある子アカウント自身のIDでどう振る舒うかは未検証だったため）。
 */
async function accountSelf(accessToken: string, accountId: string): Promise<{ account?: YahooAccount; diag?: string }> {
  try {
    const res = await fetch(`${BASE}/AccountService/get`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        "x-z-base-account-id": accountId,
      },
      body: JSON.stringify({ accountIds: [Number(accountId)] }),
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
      return { diag: `AccountService/get 失敗（HTTP ${res.status}）：${msg}` };
    }
    const found = extractAccounts(j)[0];
    if (found) return { account: found };
    return { diag: `AccountService/get の結果が空でした。実際のレスポンス：${text.slice(0, 400)}` };
  } catch (e) {
    return { diag: `AccountService/get 呼び出し中にエラー：${e instanceof Error ? e.message : String(e)}` };
  }
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
 * 3) それでも名前が引けなかったものだけ、AccountService/get で1件ずつ（そのアカウント自身の
 *    IDをヘッダーに指定して）追加リトライする。
 * それでも引けない場合は ID をそのまま名前として返しつつ、原因を nameLookupError に入れて返す
 * （選べなくはしない）。
 */
export async function yahooChildAccounts(accessToken: string, mccId: string): Promise<YahooChildAccountsResult> {
  const links = await accountLinks(accessToken, mccId);
  const childIds = [...new Set(links.map((l) => l.accountId).filter((id) => id !== mccId))];
  if (childIds.length === 0) {
    throw new Error("MCC自身以外に配下のアカウントが見つかりませんでした。");
  }

  const byId = new Map<string, YahooAccount>();

  // 1) 一括で名前を引く
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
      // 一括取得に失敗しても、2) の個別リトライに任せるのでここでは止めない
    }
  }

  // 2) 一括で引けなかったものだけ、一件ずつ「そのアカウント自身のID」で追加リトライ
  const stillMissing = childIds.filter((id) => !byId.has(id));
  let lastDiag: string | undefined;
  const CONCURRENCY = 5;
  for (let i = 0; i < stillMissing.length; i += CONCURRENCY) {
    const batch = stillMissing.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((id) => accountSelf(accessToken, id)));
    results.forEach((r, idx) => {
      const id = batch[idx];
      if (r.account) byId.set(id, r.account);
      else if (r.diag) lastDiag = r.diag;
    });
  }

  const accounts = childIds.map((id) => byId.get(id) ?? { id, name: id, manager: false });
  const unresolved = accounts.filter((a) => a.name === a.id).length;
  const nameLookupError =
    unresolved > 0
      ? `${unresolved}/${accounts.length}件のアカウント名を取得できませんでした（IDをそのまま表示しています）。${
          lastDiag ? "詳細：" + lastDiag : ""
        }`
      : undefined;

  return { accounts, nameLookupError };
}
