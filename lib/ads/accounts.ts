import { xSignedGet, type TokenSet } from "./oauth";
import type { AdPlatform } from "./platforms";

/**
 * 連携直後に「どの広告アカウントが読めるか」を控える。
 * 失敗しても連携自体は成功扱い（note に理由を残し、設定画面に出す）。
 *
 * Yahoo! / Microsoft は、アカウント一覧の取得にアカウント種別や顧客IDの指定が要るので、
 * 実績取得の段階で実装する（いまは空で返す）。
 */

export type AdAccount = { id: string; name: string };

const GOOGLE_ADS_VERSION = process.env.GOOGLE_ADS_API_VERSION || "v24";
const X_ADS_BASE = process.env.X_ADS_API_BASE || "https://ads-api.x.com/12";

export async function discoverAccounts(
  platform: AdPlatform,
  t: TokenSet
): Promise<{ accounts: AdAccount[]; note: string | null }> {
  try {
    switch (platform) {
      case "google": {
        const res = await fetch(`https://googleads.googleapis.com/${GOOGLE_ADS_VERSION}/customers:listAccessibleCustomers`, {
          headers: {
            authorization: `Bearer ${t.accessToken}`,
            // 開発者トークンは任意（クラウド管理に移行済みなら不要）。あるときだけ付ける
            ...(process.env.GOOGLE_ADS_DEVELOPER_TOKEN ? { "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN } : {}),
          },
          signal: AbortSignal.timeout(20000),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) return { accounts: [], note: `アカウント一覧を取れませんでした：${j.error?.message ?? `HTTP ${res.status}`}` };
        const names: string[] = j.resourceNames ?? [];
        return { accounts: names.map((n) => ({ id: n.replace("customers/", ""), name: n.replace("customers/", "") })), note: null };
      }
      case "meta": {
        const res = await fetch(
          `https://graph.facebook.com/v21.0/me/adaccounts?` +
            new URLSearchParams({ fields: "id,name", limit: "50", access_token: t.accessToken }),
          { signal: AbortSignal.timeout(20000) }
        );
        const j = await res.json().catch(() => ({}));
        if (!res.ok) return { accounts: [], note: `アカウント一覧を取れませんでした：${j.error?.message ?? `HTTP ${res.status}`}` };
        const rows: { id: string; name?: string }[] = j.data ?? [];
        return { accounts: rows.map((r) => ({ id: r.id, name: r.name ?? r.id })), note: null };
      }
      case "tiktok": {
        const res = await fetch(
          `https://business-api.tiktok.com/open_api/v1.3/oauth2/advertiser/get/?` +
            new URLSearchParams({ app_id: process.env.TIKTOK_APP_ID ?? "", secret: process.env.TIKTOK_SECRET ?? "" }),
          { headers: { "Access-Token": t.accessToken }, signal: AbortSignal.timeout(20000) }
        );
        const j = await res.json().catch(() => ({}));
        if (j.code !== 0) return { accounts: [], note: `アカウント一覧を取れませんでした：${j.message ?? `HTTP ${res.status}`}` };
        const rows: { advertiser_id: string; advertiser_name?: string }[] = j.data?.list ?? [];
        return { accounts: rows.map((r) => ({ id: r.advertiser_id, name: r.advertiser_name ?? r.advertiser_id })), note: null };
      }
      case "x": {
        if (!t.tokenSecret) return { accounts: [], note: null };
        const res = await xSignedGet(`${X_ADS_BASE}/accounts`, { token: t.accessToken, tokenSecret: t.tokenSecret });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          return {
            accounts: [],
            note: `アカウント一覧を取れませんでした（HTTP ${res.status}）。X の Ads API の利用承認が済んでいるか確認してください`,
          };
        }
        const rows: { id: string; name?: string }[] = j.data ?? [];
        return { accounts: rows.map((r) => ({ id: r.id, name: r.name ?? r.id })), note: null };
      }
      default:
        return { accounts: [], note: null };
    }
  } catch (e) {
    return { accounts: [], note: `アカウント一覧を取れませんでした：${e instanceof Error ? e.message : String(e)}` };
  }
}
