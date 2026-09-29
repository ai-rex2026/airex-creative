import { randomBytes, createHash } from "crypto";
import type { SnsPlatform } from "./platforms";

/**
 * 公式SNSアカウント連携の OAuth 2.0。認可URLの組み立て・コード交換・トークン更新。
 *
 * - X … OAuth 2.0 + PKCE（confidential client）。スコープ tweet.read users.read offline.access
 * - TikTok … Login Kit の OAuth 2.0。スコープ user.info.basic,user.info.stats,video.list
 *
 * どちらもトークンに期限があり refresh_token で更新できる（lib/ads/oauth.ts の
 * TikTok/X 広告連携＝期限なしとは別の仕様）。
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

const env = (k: string) => process.env[k] ?? "";
const inSeconds = (s: number | string | undefined) =>
  new Date(Date.now() + Number(s ?? 3600) * 1000).toISOString();

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** PKCE の code_verifier / code_challenge（X のみで使う。TikTok は使わない） */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

/** 認可URLを組み立てる。X は pkceChallenge が必須 */
export function buildAuthUrl(platform: SnsPlatform, redirectUri: string, state: string, pkceChallenge?: string): string {
  if (platform === "x") {
    const u = new URL("https://x.com/i/oauth2/authorize");
    u.searchParams.set("client_id", env("X_CLIENT_ID"));
    u.searchParams.set("redirect_uri", redirectUri);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("scope", "tweet.read users.read offline.access");
    u.searchParams.set("state", state);
    u.searchParams.set("code_challenge", pkceChallenge ?? "");
    u.searchParams.set("code_challenge_method", "S256");
    return u.toString();
  }
  // tiktok
  const u = new URL("https://www.tiktok.com/v2/auth/authorize/");
  u.searchParams.set("client_key", env("TIKTOK_LOGIN_CLIENT_KEY"));
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "user.info.basic,user.info.stats,video.list");
  u.searchParams.set("state", state);
  return u.toString();
}

/** 認可コード → トークン */
export async function exchangeCode(
  platform: SnsPlatform,
  code: string,
  redirectUri: string,
  pkceVerifier?: string
): Promise<SnsTokenSet> {
  if (platform === "x") {
    const basic = Buffer.from(`${env("X_CLIENT_ID")}:${env("X_CLIENT_SECRET")}`).toString("base64");
    const res = await fetch("https://api.twitter.com/2/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${basic}` },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        code_verifier: pkceVerifier ?? "",
        client_id: env("X_CLIENT_ID"),
      }),
      signal: AbortSignal.timeout(20000),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.access_token) {
      throw new Error(`X のトークン取得に失敗しました：${j.error_description ?? j.error ?? `HTTP ${res.status}`}`);
    }
    return { accessToken: j.access_token, refreshToken: j.refresh_token ?? null, expiresAt: inSeconds(j.expires_in), scope: j.scope ?? null };
  }

  // tiktok
  const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "cache-control": "no-cache" },
    body: new URLSearchParams({
      client_key: env("TIKTOK_LOGIN_CLIENT_KEY"),
      client_secret: env("TIKTOK_LOGIN_CLIENT_SECRET"),
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

/** 期限が近いトークンを更新する。refresh_token が無ければ null */
export async function refreshTokens(
  platform: SnsPlatform,
  current: { accessToken: string; refreshToken: string | null }
): Promise<SnsTokenSet | null> {
  if (!current.refreshToken) return null;

  if (platform === "x") {
    const basic = Buffer.from(`${env("X_CLIENT_ID")}:${env("X_CLIENT_SECRET")}`).toString("base64");
    const res = await fetch("https://api.twitter.com/2/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${basic}` },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: current.refreshToken, client_id: env("X_CLIENT_ID") }),
      signal: AbortSignal.timeout(20000),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.access_token) {
      throw new Error(`X のトークン更新に失敗しました：${j.error_description ?? j.error ?? `HTTP ${res.status}`}`);
    }
    return { accessToken: j.access_token, refreshToken: j.refresh_token ?? current.refreshToken, expiresAt: inSeconds(j.expires_in), scope: j.scope ?? null };
  }

  // tiktok
  const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: env("TIKTOK_LOGIN_CLIENT_KEY"),
      client_secret: env("TIKTOK_LOGIN_CLIENT_SECRET"),
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
