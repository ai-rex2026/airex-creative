import { createAdminClient } from "@/lib/supabase/admin";
import { openToken, sealToken } from "@/lib/ads/crypto";
import type { SnsPlatform } from "./platforms";

/**
 * 各社のアプリの鍵（会社ごとに自分の Meta／TikTok／Google／X のアプリを登録する口）。
 *
 * 投稿・DM・動画のアップロードは、各媒体の審査（Meta App Review／TikTok の監査／Google の youtube.upload の確認／
 * X の従量課金）を通ったアプリでないと公開できない。会社が自分のアプリを登録すると、そのアプリで連携・投稿する。
 * 登録が無ければ、このサービス共通のアプリ（環境変数）を使う。
 *
 * 鍵は sns_app_credentials（本人のセッションから読めない表）に暗号化して保存する。
 */

export type AppCreds = { clientId: string; clientSecret: string; configId: string | null; own: boolean };

const ENV: Record<SnsPlatform, { id: string; secret: string; config?: string }> = {
  x: { id: "X_CLIENT_ID", secret: "X_CLIENT_SECRET" },
  meta: { id: "META_APP_ID", secret: "META_APP_SECRET", config: "META_LOGIN_CONFIG_ID" },
  tiktok: { id: "TIKTOK_LOGIN_CLIENT_KEY", secret: "TIKTOK_LOGIN_CLIENT_SECRET" },
  youtube: { id: "YOUTUBE_CLIENT_ID", secret: "YOUTUBE_CLIENT_SECRET" },
};

export function sharedCreds(platform: SnsPlatform): AppCreds | null {
  const e = ENV[platform];
  const id = process.env[e.id];
  const secret = process.env[e.secret];
  if (!id || !secret) return null;
  return { clientId: id, clientSecret: secret, configId: e.config ? (process.env[e.config] ?? null) : null, own: false };
}

export async function ownCreds(userId: string, platform: SnsPlatform): Promise<AppCreds | null> {
  const { data } = await createAdminClient().from("sns_app_credentials").select("client_id, client_secret, extra").eq("user_id", userId).eq("platform", platform).maybeSingle();
  if (!data) return null;
  const secret = openToken(String(data.client_secret));
  if (!secret) return null;
  const extra = (data.extra as Record<string, unknown>) ?? {};
  return { clientId: String(data.client_id), clientSecret: secret, configId: typeof extra.configId === "string" && extra.configId ? extra.configId : null, own: true };
}

/** 連携・投稿に使う鍵：自社アプリがあればそれ、無ければ共通アプリ */
export async function credsFor(userId: string, platform: SnsPlatform): Promise<AppCreds | null> {
  return (await ownCreds(userId, platform)) ?? sharedCreds(platform);
}

/** 保存済みの連携が、どのアプリで発行されたか（client_id）から鍵を選ぶ（トークン更新用） */
export async function credsForClient(userId: string, platform: SnsPlatform, clientId: string | null): Promise<AppCreds | null> {
  const own = await ownCreds(userId, platform);
  if (own && (!clientId || own.clientId === clientId)) return own;
  const shared = sharedCreds(platform);
  if (shared && (!clientId || shared.clientId === clientId)) return shared;
  return own ?? shared;
}

export async function saveOwnCreds(userId: string, platform: SnsPlatform, input: { clientId: string; clientSecret: string; configId?: string | null }) {
  if (!process.env.AD_TOKEN_ENC_KEY) throw new Error("サーバーの暗号鍵（AD_TOKEN_ENC_KEY）が未設定のため、鍵を保存できません");
  const { error } = await createAdminClient()
    .from("sns_app_credentials")
    .upsert(
      {
        user_id: userId,
        platform,
        client_id: input.clientId.trim(),
        client_secret: sealToken(input.clientSecret.trim()),
        extra: input.configId ? { configId: input.configId.trim() } : {},
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,platform" }
    );
  if (error) throw new Error(`保存できませんでした：${error.message}`);
}

export async function deleteOwnCreds(userId: string, platform: SnsPlatform) {
  await createAdminClient().from("sns_app_credentials").delete().eq("user_id", userId).eq("platform", platform);
}

/** 画面に出す分（秘密は出さない） */
export async function credsInfo(userId: string): Promise<Record<string, { clientId: string; updatedAt: string } | undefined>> {
  const { data } = await createAdminClient().from("sns_app_credentials").select("platform, client_id, updated_at").eq("user_id", userId);
  const out: Record<string, { clientId: string; updatedAt: string }> = {};
  for (const r of data ?? []) {
    const id = String(r.client_id);
    out[String(r.platform)] = { clientId: id.length > 10 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id, updatedAt: String(r.updated_at) };
  }
  return out;
}
