/**
 * Yahoo! 広告 API（Search Ads API / LY Ads）の最小クライアント（アカウント一覧の発見だけに使う）。
 *
 * 確認できた事実（2026-09 時点。公式サイトが JS 描画のSPAで詳細ページを機械的に読めなかったため、
 * yahoojp-marketing/ads-search-api-documents の design/v19/Route.yaml と
 * ads-search-api-python-samples の README から拾えた範囲）:
 * - ベースURL: https://ads-search.yahooapis.jp/api/v19
 * - 認証: Authorization: Bearer {アクセストークン}
 * - AccountService/get（POST）は x-z-base-account-id ヘッダー（対象アカウントID）が必須
 * - BaseAccountService は「操作対象のビジネスIDが直接権限を持つ全てのアカウント
 *   （MCCアカウント・広告アカウント）の一覧を提供します」と説明されており、
 *   x-z-base-account-id を決める前に呼ぶ、連携直後の起点となるサービスと判断した
 *
 * 未検証の注意：BaseAccountService/get のリクエストボディとレスポンスの正確なJSON
 * フィールド名は、ドキュメントサイトの該当ページを機械的に取得できず確認できていない。
 * 実際の Yahoo!広告 API 利用申込・アプリ登録が済み次第、本番で1回連携して確認・調整する。
 * 失敗しても discoverAccounts の呼び出し元（lib/ads/accounts.ts）が例外を捕まえて
 * 「アカウント一覧を取れませんでした：〜」という注記に変えるので、連携（トークン保存）
 * 自体は失敗しない。
 */

const BASE = process.env.YAHOO_ADS_API_BASE || "https://ads-search.yahooapis.jp/api/v19";

export type YahooAccount = { id: string; name: string; manager?: boolean };

/** レスポンスの形が候補のどれに当たるかを総当たりで探す（フィールド名を断定できないため） */
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
    const r = c as Record<string, unknown>;
    const id = r.accountId ?? r.baseAccountId ?? r.id;
    const name = r.accountName ?? r.name;
    const type = r.accountType ?? r.type;
    if (id != null) {
      out.push({
        id: String(id),
        name: name != null ? String(name) : String(id),
        manager: typeof type === "string" ? /mcc|manager/i.test(type) : undefined,
      });
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
    throw new Error(`Yahoo! 広告のアカウント一覧を取得できませんでした：${msg}`);
  }
  const accounts = extractAccounts(j);
  if (accounts.length === 0) {
    // 調査用：実際のレスポンスの先頭を注記にそのまま出す（トークン等の秘匿情報は含まれない。
    // これで実際のフィールド名が分かり次第、上の extractAccounts の候補を直す）
    throw new Error(
      `Yahoo! 広告のアカウント一覧のレスポンス形式が想定と異なります（要確認）。実際のレスポンス：${text.slice(0, 500)}`
    );
  }
  return accounts;
}
