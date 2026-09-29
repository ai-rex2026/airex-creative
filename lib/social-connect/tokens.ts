import { createAdminClient } from "@/lib/supabase/admin";
import { openToken, sealToken } from "@/lib/ads/crypto";
import { refreshTokens, type SnsTokenSet } from "./oauth";
import type { SnsPlatform } from "./platforms";

/**
 * sns_connections の読み書き。トークンを含むので service role でしか触らない
 * （テーブルは RLS 有効・ポリシーなし＝ブラウザからは読めない。ad_connections と同じ形）。
 * 暗号化は lib/ads/crypto.ts の sealToken/openToken をそのまま使い回す（鍵は AD_TOKEN_ENC_KEY で共通）。
 */

export async function saveSnsConnection(userId: string, platform: SnsPlatform, t: SnsTokenSet, profile: Record<string, unknown>) {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { error } = await admin.from("sns_connections").upsert({
    user_id: userId,
    platform,
    access_token: sealToken(t.accessToken),
    refresh_token: sealToken(t.refreshToken),
    token_expires_at: t.expiresAt ?? null,
    profile,
    scope: t.scope ?? null,
    connected_at: now,
    updated_at: now,
  });
  if (error) throw new Error(`連携情報を保存できませんでした：${error.message}`);
}

export type SnsCredentials = {
  platform: SnsPlatform;
  accessToken: string;
  profile: Record<string, unknown>;
};

/**
 * 実績取得の入口。保存済みトークンを返し、期限が5分以内なら先に更新して保存する。
 * 連携していなければ null。更新に失敗しても、まだ有効かもしれない手元のトークンをそのまま返す
 * （呼び出し側の実際のAPI呼び出しで改めて失敗すれば、そこで「再連携してください」に倒れる）。
 */
export async function getSnsCredentials(userId: string, platform: SnsPlatform): Promise<SnsCredentials | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("sns_connections")
    .select("access_token, refresh_token, token_expires_at, profile")
    .eq("user_id", userId)
    .eq("platform", platform)
    .maybeSingle();
  if (!data) return null;

  let accessToken = openToken(data.access_token as string | null);
  if (!accessToken) return null;
  const refreshToken = openToken(data.refresh_token as string | null);

  const expires = data.token_expires_at ? new Date(data.token_expires_at as string).getTime() : null;
  if (expires !== null && expires - Date.now() < 5 * 60_000) {
    try {
      const fresh = await refreshTokens(platform, { accessToken, refreshToken });
      if (fresh) {
        accessToken = fresh.accessToken;
        await admin
          .from("sns_connections")
          .update({
            access_token: sealToken(fresh.accessToken),
            refresh_token: sealToken(fresh.refreshToken ?? refreshToken),
            token_expires_at: fresh.expiresAt ?? null,
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", userId)
          .eq("platform", platform);
      }
    } catch {
      // 更新に失敗しても、まだ有効かもしれない手元のトークンで続行する
    }
  }

  return { platform, accessToken, profile: (data.profile as Record<string, unknown>) ?? {} };
}

/** 連携を解除する（保存したトークンを削除）。媒体側のアクセス許可は各媒体の設定から取り消せる */
export async function disconnectSns(userId: string, platform: SnsPlatform) {
  const admin = createAdminClient();
  await admin.from("sns_connections").delete().eq("user_id", userId).eq("platform", platform);
}

/** 設定画面表示用。ユーザーの連携済みSNS一覧（トークンは含めない） */
export async function snsConnectionsFor(userId: string): Promise<{ platform: string; connected_at: string; profile: unknown }[]> {
  const admin = createAdminClient();
  const { data } = await admin.from("sns_connections").select("platform, connected_at, profile").eq("user_id", userId);
  return data ?? [];
}
