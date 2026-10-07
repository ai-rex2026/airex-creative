import { appOrigin } from "@/lib/ads/oauth";
import { openToken, sealToken } from "@/lib/ads/crypto";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Googleビジネスプロフィール（店舗）の連携。
 *
 * Search Console / GA4 の連携（Supabaseのログイン経由）とは別の、独立した OAuth にしている。
 * 理由：店舗を管理している Google アカウントは、ログインに使っているアカウントと別のことがある。
 * ログイン経由にすると、別アカウントで許可した時点でログイン中のユーザーまで切り替わってしまう。
 * この連携はログインを変えず、許可したアカウントのトークンだけを gbp_connections に預かる。
 */

export const GBP_SCOPES = [
  "https://www.googleapis.com/auth/business.manage",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

export function gbpRedirectUri(reqUrl: string): string {
  return `${appOrigin(reqUrl)}/api/gbp/callback`;
}

export function hasGbpApp(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function gbpAuthUrl(redirectUri: string, state: string): string {
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID ?? "");
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", GBP_SCOPES);
  // 更新トークンを確実に受け取るために両方要る
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "select_account consent");
  // どのアカウントで許可するかを毎回選ばせる（店舗の管理アカウントはログインと別のことが多い）
  u.searchParams.set("include_granted_scopes", "false");
  u.searchParams.set("state", state);
  return u.toString();
}

async function tokenRequest(body: Record<string, string>) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(20000),
  });
  const j = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !j.access_token) {
    throw new Error(j.error_description ?? j.error ?? `HTTP ${res.status}`);
  }
  return j as { access_token: string; refresh_token?: string; scope?: string };
}

/** 認可コード → 更新トークン・許可されたスコープ・メールアドレス */
export async function exchangeGbpCode(code: string, redirectUri: string) {
  const j = await tokenRequest({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  if (!j.refresh_token) {
    throw new Error(
      "Google から更新トークンが返りませんでした。Google アカウントの「サードパーティ製アプリとサービス」で一度このアプリを削除してから、もう一度連携してください"
    );
  }
  // business.manage が実際に許可されたか。チェックを外された場合は連携として成立しない
  if (!(j.scope ?? "").includes("business.manage")) {
    throw new Error("ビジネスプロフィールの管理（business.manage）が許可されませんでした。許可の画面で、すべての項目にチェックを入れてください");
  }
  let email: string | null = null;
  try {
    const info = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { authorization: `Bearer ${j.access_token}` },
      signal: AbortSignal.timeout(10000),
    }).then((r) => r.json());
    email = typeof info.email === "string" ? info.email : null;
  } catch {
    email = null;
  }
  return { refreshToken: j.refresh_token, scope: j.scope ?? null, email };
}

/** 保存して返す（service role。トークンを含むのでブラウザからは触らせない） */
export async function saveGbpConnection(userId: string, t: { refreshToken: string; scope: string | null; email: string | null }) {
  const admin = createAdminClient();
  const { error } = await admin.from("gbp_connections").upsert({
    user_id: userId,
    refresh_token: sealToken(t.refreshToken),
    scope: t.scope,
    email: t.email,
    connected_at: new Date().toISOString(),
  });
  if (error) throw new Error(`連携情報を保存できませんでした：${error.message}`);
}

/** 連携を解除する。Google 側の許可も取り消し（失敗しても保存分は消す）、この人の店舗の紐付けも外す */
export async function deleteGbpConnection(userId: string) {
  const admin = createAdminClient();
  const { data } = await admin.from("gbp_connections").select("refresh_token").eq("user_id", userId).maybeSingle();
  const refresh = openToken((data?.refresh_token as string | undefined) ?? null);
  if (refresh) {
    await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refresh }),
      signal: AbortSignal.timeout(10000),
    }).catch(() => undefined);
  }
  await admin.from("analyses").update({ meo_gbp_account: null, meo_gbp_location: null }).eq("owner_id", userId);
  const { error } = await admin.from("gbp_connections").delete().eq("user_id", userId);
  if (error) throw new Error(`連携を解除できませんでした：${error.message}`);
}

/** 連携したアカウントのメールアドレス（表示用）。連携していなければ null */
export async function gbpConnectionEmail(userId: string): Promise<{ email: string | null } | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("gbp_connections").select("email").eq("user_id", userId).maybeSingle();
  return data ? { email: (data.email as string | null) ?? null } : null;
}

/** 保存した更新トークンからアクセストークンを取り直す。連携していなければ null */
export async function gbpAccessToken(userId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("gbp_connections").select("refresh_token").eq("user_id", userId).maybeSingle();
  const refresh = openToken((data?.refresh_token as string | undefined) ?? null);
  if (!refresh) return null;
  try {
    const j = await tokenRequest({
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      refresh_token: refresh,
      grant_type: "refresh_token",
    });
    return j.access_token;
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    // 許可が取り消された・期限切れ（テスト中のアプリは7日で切れる）
    if (/invalid_grant/i.test(m) || /expired or revoked/i.test(m)) {
      throw new Error("Googleの許可が切れています。「連携を解除」して、もう一度連携してください");
    }
    throw e;
  }
}
