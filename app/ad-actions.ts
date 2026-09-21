"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdPlatform, type AdPlatform } from "@/lib/ads/platforms";

/** 画面に出してよい形。トークンは含めない */
export type AdConnectionView = {
  platform: AdPlatform;
  connected_at: string;
  accounts: { id: string; name: string }[];
  note: string | null;
};

async function currentUser() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  return user;
}

/**
 * 連携済みの広告媒体。ad_connections は RLS で閉じているので、
 * ログイン中の本人の行だけを service role で読む。
 */
export async function adConnections(): Promise<AdConnectionView[]> {
  const user = await currentUser();
  if (!user || user.is_anonymous) return [];
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("ad_connections")
      .select("platform, connected_at, accounts, meta")
      .eq("user_id", user.id);
    return (data ?? [])
      .filter((r) => isAdPlatform(r.platform as string))
      .map((r) => ({
        platform: r.platform as AdPlatform,
        connected_at: r.connected_at as string,
        accounts: (r.accounts as { id: string; name: string }[]) ?? [],
        note: ((r.meta as { note?: string } | null)?.note as string | undefined) ?? null,
      }));
  } catch {
    // テーブル未作成などで設定画面ごと落とさない
    return [];
  }
}

/** 連携を解除する（保存したトークンを削除）。媒体側のアクセス許可は各媒体の設定から取り消せる */
export async function disconnectAd(platform: string) {
  const user = await currentUser();
  if (!user || !isAdPlatform(platform)) return;
  const admin = createAdminClient();
  await admin.from("ad_connections").delete().eq("user_id", user.id).eq("platform", platform);
}
