/**
 * ヤフーLINE広告 API（Search Ads API / LY Ads）の最小クライアント（アカウント一覧の発見だけに使う）。
 * 2026-09 に「Yahoo!広告」から名称変更。API・エンドポイント名は変わらない。
 *
 * - ベースURL: https://ads-search.yahooapis.jp/api/v19
 * - 認証: Authorization: Bearer {アクセストークン}
 * - BaseAccountService/get は「操作対象のビジネスIDが直接権限を持つ全てのアカウント
 *   （MCCアカウント・広告アカウント）の一覧を提供します」と説明されており、
 *   x-z-base-account-id を決める前に呼ぶ、連携直後の起点となるサービスと判断した
 *
 * レスポンス形式（2026-09、本番の実レスポンスで確認済み）:
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
