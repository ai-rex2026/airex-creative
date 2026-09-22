import { xSignedGet, type TokenSet } from "./oauth";
import type { AdPlatform } from "./platforms";
import { listAccessibleCustomers } from "./google";
import { yahooBaseAccounts } from "./yahoo";
import { microsoftUserId, microsoftSearchAccounts } from "./microsoft";

/**
 * 連携直後に「どの広告アカウントが読めるか」を控える。
 * 失敗しても連携自体は成功扱い（note に理由を残し、設定画面に出す）。
 */

export type AdAccount = { id: string; name: string; /** MCC（管理者アカウント）か。Google 広告のみ */ manager?: boolean };

const X_ADS_BASE = process.env.X_ADS_API_BASE || "https://ads-api.x.com/12";

export async function discoverAccounts(
  platform: AdPlatform,
  t: TokenSet
): Promise<{ accounts: AdAccount[]; note: string | null }> {
  try {
    switch (platform) {
      case "google": {
        // 直接アクセスできるアカウントを名前・種別つきで控える。MCC 配下は選択画面で展開する
        const { accounts, failed } = await listAccessibleCustomers(t.accessToken);
        return {
          accounts: accounts.map((a) => ({ id: a.id, name: a.name, manager: a.manager })),
          note: failed.length > 0 ? `${failed.length}件のアカウントは情報を取れませんでした（解約済みなど）` : null,
        };
      }
      case "yahoo": {
        // BaseAccountService/get で、このアクセストークンが直接アクセスできる全アカウント（MCC・広告アカウント）を取る。
        // レスポンス形式は未検証（lib/ads/yahoo.ts のコメント参照）。失敗しても連携自体は成功扱いにする
        const accounts = await yahooBaseAccounts(t.accessToken);
        return { accounts, note: null };
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
      case "microsoft": {
        // Customer Management Service（SOAP）で GetUser → SearchAccounts。lib/ads/microsoft.ts 参照
        const userId = await microsoftUserId(t.accessToken);
        const accounts = await microsoftSearchAccounts(t.accessToken, userId);
        return { accounts, note: null };
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
