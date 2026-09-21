import { createAdminClient } from "@/lib/supabase/admin";
import { openToken, sealToken } from "./crypto";
import { refreshTokens, type TokenSet } from "./oauth";
import type { AdAccount } from "./accounts";
import type { AdPlatform } from "./platforms";

/**
 * ad_connections の読み書き。トークンを含むので service role でしか触らない
 * （テーブルは RLS 有効・ポリシーなし＝ブラウザからは読めない）。
 */

export async function saveConnection(
  userId: string,
  platform: AdPlatform,
  t: TokenSet,
  accounts: AdAccount[],
  meta: Record<string, unknown>
) {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { error } = await admin.from("ad_connections").upsert({
    user_id: userId,
    platform,
    access_token: sealToken(t.accessToken),
    refresh_token: sealToken(t.refreshToken),
    token_secret: sealToken(t.tokenSecret),
    token_expires_at: t.expiresAt ?? null,
    accounts,
    meta: { ...(t.extra ?? {}), ...meta },
    scope: t.scope ?? null,
    connected_at: now,
    updated_at: now,
  });
  if (error) throw new Error(`連携情報を保存できませんでした：${error.message}`);
}

export type AdCredentials = {
  platform: AdPlatform;
  accessToken: string;
  /** OAuth 1.0a（X）のみ */
  tokenSecret: string | null;
  accounts: AdAccount[];
  meta: Record<string, unknown>;
};

/**
 * 実績取得の入口。保存済みトークンを返し、期限が5分以内（Meta は10日以内）なら先に更新して保存する。
 * 連携していなければ null。
 */
export async function getAdCredentials(userId: string, platform: AdPlatform): Promise<AdCredentials | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("ad_connections")
    .select("access_token, refresh_token, token_secret, token_expires_at, accounts, meta, scope")
    .eq("user_id", userId)
    .eq("platform", platform)
    .maybeSingle();
  if (!data) return null;

  let accessToken = openToken(data.access_token as string | null);
  if (!accessToken) return null;
  const refreshToken = openToken(data.refresh_token as string | null);

  const expires = data.token_expires_at ? new Date(data.token_expires_at as string).getTime() : null;
  const margin = platform === "meta" ? 10 * 86400_000 : 5 * 60_000;
  if (expires !== null && expires - Date.now() < margin) {
    const fresh = await refreshTokens(platform, { accessToken, refreshToken });
    if (fresh) {
      accessToken = fresh.accessToken;
      await admin
        .from("ad_connections")
        .update({
          access_token: sealToken(fresh.accessToken),
          refresh_token: sealToken(fresh.refreshToken ?? refreshToken),
          token_expires_at: fresh.expiresAt ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId)
        .eq("platform", platform);
    }
  }

  return {
    platform,
    accessToken,
    tokenSecret: openToken(data.token_secret as string | null),
    accounts: (data.accounts as AdAccount[]) ?? [],
    meta: (data.meta as Record<string, unknown>) ?? {},
  };
}
