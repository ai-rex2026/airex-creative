import { randomBytes, createHash } from "crypto";
import { META_SCOPES, exchangeLongLivedToken } from "@/lib/meta";
import type { SnsPlatform } from "./platforms";
import type { AppCreds } from "./app-creds";

/**
 * 公式SNSアカウント連携の OAuth 2.0。認可URLの組み立て・コード交換・トークン更新。
 *
 * - X … OAuth 2.0 + PKCE（confidential client）。スコープ tweet.read tweet.write users.read offline.access
 *   （tweet.write は SNS運用画面から人が確認した投稿を送るため。2026-10-13 追加。以前に連携した
 *   アカウントは scope に tweet.write が無いので、投稿するには再連携が要る）
 * - TikTok … Login Kit の OAuth 2.0。スコープ user.info.basic,user.info.stats,video.list
 * - Meta（Instagram/Facebook） … Facebook Login for Business の OAuth 2.0（config_id 方式）。
 *   旧来の scope 指定のみの認可URLだと、ページがビジネスポートフォリオ所有の場合に
 *   「どのページへのアクセスを許可するか」を選ぶ画面が出ず、スコープ自体は許可されていても
 *   /me/accounts が常に空配列を返す問題があった（2026/10 に実際に発生・特定）。
 *   developers.facebook.com の「ビジネス向けFacebookログイン」→「設定」で作成した
 *   ログイン設定(Configuration)のIDを META_LOGIN_CONFIG_ID に入れることで、
 *   認可時にページ選択ダイアログが出るようになり解決する。
 *   META_LOGIN_CONFIG_ID が未設定の環境では、従来の scope 指定にフォールバックする。
 *   ここで交換するのはユーザーの長期トークンまで。実際に保存するPageアクセストークンと
 *   Instagramプロフィールの紐付けは lib/social-connect/meta.ts（callbackから呼ぶ）で行う。
 *
 * X・TikTokはトークンに期限があり refresh_token で更新できる。Metaは refresh_token が無く、
 * 短期トークンを60日の長期トークンに交換する方式（lib/ads/oauth.ts のMeta広告連携と同じ仕様）。
 */

export type SnsTokenSet = {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: string | null;
  scope?: string | null;
  extra?: Record<string, unknown>;
};

export function appOrigin(reqUrl: string): string {
  const fixed = process.env.APP_ORIGIN?.trim().replace(/\/+$/, "");
  return fixed || new URL(reqUrl).origin;
}

export function redirectUriFor(platform: SnsPlatform, reqUrl: string): string {
  return `${appOrigin(reqUrl)}/api/social/${platform}/callback`;
}

/** X に求める権限。投稿・スレッド（tweet.write）、画像（media.write）、リポスト、DM（dm.read/dm.write）。2026-10-16 拡張 */
export const X_SCOPES = "tweet.read tweet.write users.read offline.access media.write like.write dm.read dm.write";
/** YouTube に求める権限。動画のアップロード・コメントの返信・自分のチャンネルの読み取り */
export const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.force-ssl",
  "https://www.googleapis.com/auth/youtube.readonly",
].join(" ");
const inSeconds = (s: number | string | undefined) =>
  new Date(Date.now() + Number(s ?? 3600) * 1000).toISOString();

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** PKCE の code_verifier / code_challenge（X のみで使う。TikTok・Meta は使わない） */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

/** 認可URLを組み立てる。X は pkceChallenge が必須 */
export function buildAuthUrl(platform: SnsPlatform, creds: AppCreds, redirectUri: string, state: string, pkceChallenge?: string): string {
  if (platform === "x") {
    const u = new URL("https://x.com/i/oauth2/authorize");
    u.searchParams.set("client_id", creds.clientId);
    u.searchParams.set("redirect_uri", redirectUri);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("scope", X_SCOPES);
    u.searchParams.set("state", state);
    u.searchParams.set("code_challenge", pkceChallenge ?? "");
    u.searchParams.set("code_challenge_method", "S256");
    return u.toString();
  }
  if (platform === "meta") {
    const u = new URL("https://www.facebook.com/v21.0/dialog/oauth");
    u.searchParams.set("client_id", creds.clientId);
    u.searchParams.set("redirect_uri", redirectUri);
    u.searchParams.set("response_type", "code");
    const configId = creds.configId;
    if (configId) {
      // Facebook Login for Business: config_id がページ選択ダイアログを有効にする
      u.searchParams.set("config_id", configId);
    } else {
      // フォールバック（config_id 未設定時の従来挙動）
      u.searchParams.set("scope", META_SCOPES);
    }
    u.searchParams.set("state", state);
    return u.toString();
  }
  if (platform === "youtube") {
    const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    u.searchParams.set("client_id", creds.clientId);
    u.searchParams.set("redirect_uri", redirectUri);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("scope", YOUTUBE_SCOPES);
    u.searchParams.set("access_type", "offline");
    u.searchParams.set("prompt", "consent");
    u.searchParams.set("state", state);
    return u.toString();
  }
  // tiktok
  const u = new URL("https://www.tiktok.com/v2/auth/authorize/");
  u.searchParams.set("client_key", creds.clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "user.info.basic,user.info.stats,video.list,video.upload,video.publish");
  u.searchParams.set("state", state);
  return u.toString();
}

/** 認可コード → トークン */
export async function exchangeCode(
  platform: SnsPlatform,
  creds: AppCreds,
  code: string,
  redirectUri: string,
  pkceVerifier?: string
): Promise<SnsTokenSet> {
  if (platform === "x") {
    const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64");
    const res = await fetch("https://api.twitter.com/2/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${basic}` },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        code_verifier: pkceVerifier ?? "",
        client_id: creds.clientId,
      }),
      signal: AbortSignal.timeout(20000),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.access_token) {
      throw new Error(`X のトークン取得に失敗しました：${j.error_description ?? j.error ?? `HTTP ${res.status}`}`);
    }
    return { accessToken: j.access_token, refreshToken: j.refresh_token ?? null, expiresAt: inSeconds(j.expires_in), scope: j.scope ?? null };
  }

  if (platform === "meta") {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/oauth/access_token?` +
        new URLSearchParams({
          client_id: creds.clientId,
          client_secret: creds.clientSecret,
          redirect_uri: redirectUri,
          code,
        }),
      { signal: AbortSignal.timeout(15000) }
    );
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.access_token) {
      throw new Error(`Meta のトークン取得に失敗しました：${j.error?.message ?? `HTTP ${res.status}`}`);
    }
    // 数時間で切れる短期トークンを、60日の長期トークン（ユーザートークン）に換える。
    // 実際にInstagramデータの取得に使うPageトークンへの変換は callback 側（lib/social-connect/meta.ts）で行う
    const long = await exchangeLongLivedToken(j.access_token as string, creds.own ? { appId: creds.clientId, appSecret: creds.clientSecret } : undefined);
    return { accessToken: long.accessToken, expiresAt: long.expiresAt, scope: META_SCOPES };
  }

  if (platform === "youtube") {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: creds.clientId, client_secret: creds.clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
      signal: AbortSignal.timeout(20000),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.access_token) throw new Error(`YouTube（Google）のトークン取得に失敗しました：${j.error_description ?? j.error ?? `HTTP ${res.status}`}`);
    return { accessToken: j.access_token, refreshToken: j.refresh_token ?? null, expiresAt: inSeconds(j.expires_in), scope: j.scope ?? null };
  }

  // tiktok
  const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "cache-control": "no-cache" },
    body: new URLSearchParams({
      client_key: creds.clientId,
      client_secret: creds.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
    signal: AbortSignal.timeout(20000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) {
    throw new Error(`TikTok のトークン取得に失敗しました：${j.error_description ?? j.error ?? `HTTP ${res.status}`}`);
  }
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token ?? null,
    expiresAt: inSeconds(j.expires_in),
    scope: j.scope ?? null,
    extra: { openId: j.open_id },
  };
}

/**
 * 期限が近いトークンを更新する。refresh_token が無ければ null。
 * Meta は refresh_token を保存しない（Pageトークンは、ユーザーがPage管理者であり続ける限り
 * 明示的に無効化されない＝lib/ads/oauth.ts のMeta広告連携と同じ考え方）ため、ここには来ない。
 */
export async function refreshTokens(
  platform: SnsPlatform,
  creds: AppCreds,
  current: { accessToken: string; refreshToken: string | null }
): Promise<SnsTokenSet | null> {
  if (!current.refreshToken) return null;

  if (platform === "x") {
    const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64");
    const res = await fetch("https://api.twitter.com/2/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${basic}` },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: current.refreshToken, client_id: creds.clientId }),
      signal: AbortSignal.timeout(20000),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.access_token) {
      throw new Error(`X のトークン更新に失敗しました：${j.error_description ?? j.error ?? `HTTP ${res.status}`}`);
    }
    return { accessToken: j.access_token, refreshToken: j.refresh_token ?? current.refreshToken, expiresAt: inSeconds(j.expires_in), scope: j.scope ?? null };
  }

  if (platform === "youtube") {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: creds.clientId, client_secret: creds.clientSecret, refresh_token: current.refreshToken, grant_type: "refresh_token" }),
      signal: AbortSignal.timeout(20000),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.access_token) throw new Error(`YouTube（Google）のトークン更新に失敗しました：${j.error_description ?? j.error ?? `HTTP ${res.status}`}`);
    return { accessToken: j.access_token, refreshToken: current.refreshToken, expiresAt: inSeconds(j.expires_in), scope: j.scope ?? null };
  }

  // tiktok
  const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: creds.clientId,
      client_secret: creds.clientSecret,
      grant_type: "refresh_token",
      refresh_token: current.refreshToken,
    }),
    signal: AbortSignal.timeout(20000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) {
    throw new Error(`TikTok のトークン更新に失敗しました：${j.error_description ?? j.error ?? `HTTP ${res.status}`}`);
  }
  return { accessToken: j.access_token, refreshToken: j.refresh_token ?? current.refreshToken, expiresAt: inSeconds(j.expires_in), scope: j.scope ?? null };
}
