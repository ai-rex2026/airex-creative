import { createAdminClient } from "@/lib/supabase/admin";
import { openToken, sealToken } from "./crypto";
import { refreshTokens, type TokenSet } from "./oauth";
import type { AdAccount } from "./accounts";
import { isAdPlatform, type AdPlatform } from "./platforms";

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

/**
 * 定期実行（/api/cron/ad-tokens）用。使われていなくてもトークンが切れないように、まとめて更新する。
 *
 * - Google / Yahoo! / Microsoft … refresh_token でアクセストークンを取り直す。
 *   使わないまま放っておくと refresh_token 自体が失効する媒体があるため、定期的に触る
 * - Meta … 60日トークンの期限まで20日を切ったら再交換して延ばす
 * - TikTok / X … 期限がないので対象外
 *
 * 更新に失敗したら meta.tokenError に残し、設定画面に「再連携してください」と出す。
 * 成功すれば消す。
 */
export async function refreshAllAdTokens() {
  const admin = createAdminClient();
  const { data } = await admin
    .from("ad_connections")
    .select("user_id, platform, access_token, refresh_token, token_expires_at, meta");

  const result = { checked: 0, refreshed: 0, skipped: 0, failed: 0 };

  for (const row of data ?? []) {
    const platform = row.platform as string;
    if (!isAdPlatform(platform) || platform === "tiktok" || platform === "x") continue;
    result.checked++;

    const meta = { ...((row.meta as Record<string, unknown> | null) ?? {}) };
    const save = (patch: Record<string, unknown>) =>
      admin
        .from("ad_connections")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("user_id", row.user_id)
        .eq("platform", platform);

    try {
      const accessToken = openToken(row.access_token as string | null);
      if (!accessToken) {
        result.skipped++;
        continue;
      }
      if (platform === "meta" && row.token_expires_at) {
        const left = new Date(row.token_expires_at as string).getTime() - Date.now();
        if (left > 20 * 86400_000) {
          result.skipped++;
          continue;
        }
      }
      const refreshToken = openToken(row.refresh_token as string | null);
      const fresh = await refreshTokens(platform, { accessToken, refreshToken });
      if (!fresh) {
        result.skipped++;
        continue;
      }
      delete meta.tokenError;
      await save({
        access_token: sealToken(fresh.accessToken),
        refresh_token: sealToken(fresh.refreshToken ?? refreshToken),
        token_expires_at: fresh.expiresAt ?? null,
        meta,
      });
      result.refreshed++;
    } catch (e) {
      result.failed++;
      meta.tokenError = `トークンを更新できませんでした。もう一度連携してください（${
        e instanceof Error ? e.message.slice(0, 80) : "原因不明"
      }）`;
      await save({ meta });
    }
  }
  return result;
}
