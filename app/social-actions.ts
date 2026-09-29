"use server";

import { createClient } from "@/lib/supabase/server";
import { isSnsPlatform, type SnsPlatform } from "@/lib/social-connect/platforms";
import { disconnectSns, snsConnectionsFor } from "@/lib/social-connect/tokens";

/** 画面に出してよい形。トークンは含めない */
export type SnsConnectionView = {
  platform: SnsPlatform;
  connected_at: string;
  label: string | null;
  followers: number | null;
};

async function currentUser() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  return user;
}

/**
 * 連携済みの公式SNSアカウント。sns_connections は RLS で閉じているので、
 * ログイン中の本人の行だけを service role で読む（app/ad-actions.ts の adConnections と同じ形）。
 */
export async function snsConnections(): Promise<SnsConnectionView[]> {
  const user = await currentUser();
  if (!user || user.is_anonymous) return [];
  try {
    const rows = await snsConnectionsFor(user.id);
    return rows
      .filter((r) => isSnsPlatform(r.platform as string))
      .map((r) => {
        const profile = (r.profile as Record<string, unknown>) ?? {};
        const label =
          (profile.username as string | undefined) ?? (profile.displayName as string | undefined) ?? (profile.name as string | undefined) ?? null;
        const followersRaw = (profile as { followers?: unknown; followerCount?: unknown }).followers ?? (profile as { followerCount?: unknown }).followerCount;
        const followers = typeof followersRaw === "number" ? followersRaw : null;
        return { platform: r.platform as SnsPlatform, connected_at: r.connected_at as string, label, followers };
      });
  } catch {
    // テーブル未作成などで設定画面ごと落とさない
    return [];
  }
}

/** 連携を解除する（保存したトークンを削除）。各SNS側のアクセス許可はそれぞれの設定から取り消せる */
export async function disconnectSnsAction(platform: string) {
  const user = await currentUser();
  if (!user || !isSnsPlatform(platform)) return;
  await disconnectSns(user.id, platform);
}
