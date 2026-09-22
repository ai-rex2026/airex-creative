import { createHmac, randomBytes } from "crypto";
import { exchangeLongLivedToken } from "@/lib/meta";
import type { AdPlatform } from "./platforms";

/**
 * 広告媒体ごとの OAuth。認可URLの組み立て・コード交換・トークン更新。
 *
 * 媒体ごとにクセが違う：
 * - Google / ヤフーLINE広告 / Microsoft … 標準の認可コード。refresh_token で更新する
 * - Meta … refresh_token が無い。短期トークンを60日の長期トークンに交換し、期限前に同じ交換で延ばす
 * - TikTok … 認可後に auth_code が返る。アクセストークンに期限がない
 * - X … Ads API は OAuth 1.0a（3-legged）。OAuth 2.0 では広告アカウントに届かない。トークンに期限がない
 */

export type TokenSet = {
  accessToken: string;
  refreshToken?: string | null;
  /** OAuth 1.0a（X）のトークンシークレット */
  tokenSecret?: string | null;
  expiresAt?: string | null;
  scope?: string | null;
  extra?: Record<string, unknown>;
};

const GRAPH = "https://graph.facebook.com/v21.0";

export function appOrigin(reqUrl: string): string {
  const fixed = process.env.APP_ORIGIN?.trim().replace(/\/+$/, "");
  return fixed || new URL(reqUrl).origin;
}

export function redirectUriFor(platform: AdPlatform, reqUrl: string): string {
  return `${appOrigin(reqUrl)}/api/ads/${platform}/callback`;
}

const env = (k: string) => process.env[k] ?? "";
const inSeconds = (s: number | string | undefined) =>
  new Date(Date.now() + Number(s ?? 3600) * 1000).toISOString();

async function postForm(url: string, body: Record<string, string>, label: string) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(20000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) {
    throw new Error(`${label}：${j.error_description ?? j.error?.message ?? j.error ?? `HTTP ${res.status}`}`);
  }
  return j as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
}

/** X 以外の認可URL */
export function buildAuthUrl(platform: Exclude<AdPlatform, "x">, redirectUri: string, state: string): string {
  switch (platform) {
    case "google": {
      const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      u.searchParams.set("client_id", env("GOOGLE_CLIENT_ID"));
      u.searchParams.set("redirect_uri", redirectUri);
      u.searchParams.set("response_type", "code");
      u.searchParams.set("scope", "https://www.googleapis.com/auth/adwords");
      // 更新トークンを確実に受け取るために両方要る
      u.searchParams.set("access_type", "offline");
      u.searchParams.set("prompt", "consent");
      u.searchParams.set("state", state);
      return u.toString();
    }
    case "yahoo": {
      const u = new URL("https://biz-oauth.yahoo.co.jp/oauth/v1/authorize");
      u.searchParams.set("client_id", env("YAHOO_ADS_CLIENT_ID"));
      u.searchParams.set("redirect_uri", redirectUri);
      u.searchParams.set("response_type", "code");
      u.searchParams.set("scope", "yahooads");
      u.searchParams.set("state", state);
      return u.toString();
    }
    case "meta": {
      const u = new URL(`https://www.facebook.com/v21.0/dialog/oauth`);
      u.searchParams.set("client_id", env("META_APP_ID"));
      u.searchParams.set("redirect_uri", redirectUri);
      u.searchParams.set("response_type", "code");
      // 広告の実績を読むだけ。書き込み（ads_management）は求めない
      u.searchParams.set("scope", "ads_read");
      u.searchParams.set("state", state);
      return u.toString();
    }
    case "microsoft": {
      const u = new URL("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
      u.searchParams.set("client_id", env("MICROSOFT_CLIENT_ID"));
      u.searchParams.set("redirect_uri", redirectUri);
      u.searchParams.set("response_type", "code");
      u.searchParams.set("scope", "https://ads.microsoft.com/msads.manage offline_access");
      u.searchParams.set("state", state);
      return u.toString();
    }
    case "tiktok": {
      const u = new URL("https://business-api.tiktok.com/portal/auth");
      u.searchParams.set("app_id", env("TIKTOK_APP_ID"));
      u.searchParams.set("redirect_uri", redirectUri);
      u.searchParams.set("state", state);
      return u.toString();
    }
  }
}

/** 認可コード → トークン（X 以外） */
export async function exchangeCode(
  platform: Exclude<AdPlatform, "x">,
  code: string,
  redirectUri: string
): Promise<TokenSet> {
  switch (platform) {
    case "google": {
      const j = await postForm(
        "https://oauth2.googleapis.com/token",
        {
          code,
          client_id: env("GOOGLE_CLIENT_ID"),
          client_secret: env("GOOGLE_CLIENT_SECRET"),
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        },
        "Google のトークン取得に失敗しました"
      );
      if (!j.refresh_token) {
        throw new Error(
          "Google から更新トークンが返りませんでした。Google アカウントの「サードパーティ製アプリとサービス」で一度このアプリを削除してから、もう一度連携してください"
        );
      }
      return { accessToken: j.access_token, refreshToken: j.refresh_token, expiresAt: inSeconds(j.expires_in), scope: j.scope };
    }
    case "yahoo": {
      const j = await postForm(
        "https://biz-oauth.yahoo.co.jp/oauth/v1/token",
        {
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          client_id: env("YAHOO_ADS_CLIENT_ID"),
          client_secret: env("YAHOO_ADS_CLIENT_SECRET"),
        },
        "ヤフーLINE広告のトークン取得に失敗しました"
      );
      return { accessToken: j.access_token, refreshToken: j.refresh_token ?? null, expiresAt: inSeconds(j.expires_in) };
    }
    case "meta": {
      const res = await fetch(
        `${GRAPH}/oauth/access_token?` +
          new URLSearchParams({
            client_id: env("META_APP_ID"),
            client_secret: env("META_APP_SECRET"),
            redirect_uri: redirectUri,
            code,
          }),
        { signal: AbortSignal.timeout(15000) }
      );
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.access_token) throw new Error(`Meta のトークン取得に失敗しました：${j.error?.message ?? `HTTP ${res.status}`}`);
      // 数時間で切れる短期トークンを、60日の長期トークンに換える
      const long = await exchangeLongLivedToken(j.access_token as string);
      return { accessToken: long.accessToken, expiresAt: long.expiresAt, scope: "ads_read" };
    }
    case "microsoft": {
      const j = await postForm(
        "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        {
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          client_id: env("MICROSOFT_CLIENT_ID"),
          client_secret: env("MICROSOFT_CLIENT_SECRET"),
          scope: "https://ads.microsoft.com/msads.manage offline_access",
        },
        "Microsoft のトークン取得に失敗しました"
      );
      return { accessToken: j.access_token, refreshToken: j.refresh_token ?? null, expiresAt: inSeconds(j.expires_in), scope: j.scope };
    }
    case "tiktok": {
      const res = await fetch("https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ app_id: env("TIKTOK_APP_ID"), secret: env("TIKTOK_SECRET"), auth_code: code }),
        signal: AbortSignal.timeout(20000),
      });
      const j = await res.json().catch(() => ({}));
      if (j.code !== 0 || !j.data?.access_token) {
        throw new Error(`TikTok のトークン取得に失敗しました：${j.message ?? `HTTP ${res.status}`}`);
      }
      const scope = Array.isArray(j.data.scope) ? j.data.scope.join(",") : (j.data.scope ?? null);
      return {
        accessToken: j.data.access_token as string,
        refreshToken: (j.data.refresh_token as string | undefined) ?? null,
        scope,
        extra: { advertiserIds: j.data.advertiser_ids ?? [] },
      };
    }
  }
}

/**
 * 期限が近いトークンを更新する。null が返ったら更新不要（または更新手段がない）。
 * Google / ヤフーLINE広告 / Microsoft は refresh_token、Meta は長期トークンの再交換。
 */
export async function refreshTokens(
  platform: AdPlatform,
  current: { accessToken: string; refreshToken: string | null }
): Promise<TokenSet | null> {
  switch (platform) {
    case "google": {
      if (!current.refreshToken) return null;
      const j = await postForm(
        "https://oauth2.googleapis.com/token",
        {
          client_id: env("GOOGLE_CLIENT_ID"),
          client_secret: env("GOOGLE_CLIENT_SECRET"),
          refresh_token: current.refreshToken,
          grant_type: "refresh_token",
        },
        "Google のトークン更新に失敗しました"
      );
      return { accessToken: j.access_token, refreshToken: current.refreshToken, expiresAt: inSeconds(j.expires_in) };
    }
    case "yahoo": {
      if (!current.refreshToken) return null;
      const j = await postForm(
        "https://biz-oauth.yahoo.co.jp/oauth/v1/token",
        {
          grant_type: "refresh_token",
          refresh_token: current.refreshToken,
          client_id: env("YAHOO_ADS_CLIENT_ID"),
          client_secret: env("YAHOO_ADS_CLIENT_SECRET"),
        },
        "ヤフーLINE広告のトークン更新に失敗しました"
      );
      return { accessToken: j.access_token, refreshToken: j.refresh_token ?? current.refreshToken, expiresAt: inSeconds(j.expires_in) };
    }
    case "microsoft": {
      if (!current.refreshToken) return null;
      const j = await postForm(
        "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        {
          grant_type: "refresh_token",
          refresh_token: current.refreshToken,
          client_id: env("MICROSOFT_CLIENT_ID"),
          client_secret: env("MICROSOFT_CLIENT_SECRET"),
          scope: "https://ads.microsoft.com/msads.manage offline_access",
        },
        "Microsoft のトークン更新に失敗しました"
      );
      return { accessToken: j.access_token, refreshToken: j.refresh_token ?? current.refreshToken, expiresAt: inSeconds(j.expires_in) };
    }
    case "meta": {
      const long = await exchangeLongLivedToken(current.accessToken);
      return { accessToken: long.accessToken, expiresAt: long.expiresAt };
    }
    default:
      return null; // TikTok / X は期限がない
  }
}

// ── X（OAuth 1.0a） ────────────────────────────────────────────────────────

const X_OAUTH = "https://api.twitter.com/oauth";

function pct(s: string) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

/** OAuth 1.0a の Authorization ヘッダーを作る。url はクエリなし、クエリは query に分けて渡す */
export function oauth1Header(
  method: string,
  url: string,
  o: { token?: string; tokenSecret?: string; extra?: Record<string, string>; query?: Record<string, string> }
): string {
  const oauth: Record<string, string> = {
    oauth_consumer_key: env("X_API_KEY"),
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_version: "1.0",
    ...(o.token ? { oauth_token: o.token } : {}),
    ...(o.extra ?? {}),
  };
  const all: Record<string, string> = { ...oauth, ...(o.query ?? {}) };
  const paramString = Object.keys(all)
    .sort()
    .map((k) => `${pct(k)}=${pct(all[k])}`)
    .join("&");
  const base = [method.toUpperCase(), pct(url), pct(paramString)].join("&");
  const signingKey = `${pct(env("X_API_SECRET"))}&${pct(o.tokenSecret ?? "")}`;
  oauth.oauth_signature = createHmac("sha1", signingKey).update(base).digest("base64");
  return (
    "OAuth " +
    Object.keys(oauth)
      .sort()
      .map((k) => `${pct(k)}="${pct(oauth[k])}"`)
      .join(", ")
  );
}

/** X に署名付きで GET する（アカウント一覧・のちの実績取得で使う） */
export async function xSignedGet(url: string, tokens: { token: string; tokenSecret: string }, query: Record<string, string> = {}) {
  const qs = Object.keys(query).length ? `?${new URLSearchParams(query)}` : "";
  return fetch(url + qs, {
    headers: { authorization: oauth1Header("GET", url, { token: tokens.token, tokenSecret: tokens.tokenSecret, query }) },
    signal: AbortSignal.timeout(20000),
  });
}

async function xOauthPost(path: string, header: string, label: string) {
  const res = await fetch(`${X_OAUTH}/${path}`, {
    method: "POST",
    headers: { authorization: header },
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${label}（HTTP ${res.status}）：${text.slice(0, 160)}`);
  return new URLSearchParams(text);
}

/** 1) リクエストトークンを取る。認可画面に送る前に必要 */
export async function xRequestToken(callbackUrl: string): Promise<{ token: string; secret: string }> {
  const p = await xOauthPost(
    "request_token",
    oauth1Header("POST", `${X_OAUTH}/request_token`, { extra: { oauth_callback: callbackUrl } }),
    "X のリクエストトークン取得に失敗しました"
  );
  const token = p.get("oauth_token");
  const secret = p.get("oauth_token_secret");
  if (!token || !secret || p.get("oauth_callback_confirmed") !== "true") {
    throw new Error("X のリクエストトークンが返りませんでした（X_API_KEY と、開発者ポータルのコールバックURLを確認してください）");
  }
  return { token, secret };
}

export function xAuthorizeUrl(requestToken: string): string {
  return `${X_OAUTH}/authorize?oauth_token=${encodeURIComponent(requestToken)}`;
}

/** 2) 認可後に戻ってきた verifier をアクセストークンに換える */
export async function xAccessToken(requestToken: string, requestSecret: string, verifier: string): Promise<TokenSet> {
  const p = await xOauthPost(
    "access_token",
    oauth1Header("POST", `${X_OAUTH}/access_token`, {
      token: requestToken,
      tokenSecret: requestSecret,
      extra: { oauth_verifier: verifier },
    }),
    "X のアクセストークン取得に失敗しました"
  );
  const token = p.get("oauth_token");
  const secret = p.get("oauth_token_secret");
  if (!token || !secret) throw new Error("X のアクセストークンが返りませんでした");
  return {
    accessToken: token,
    tokenSecret: secret,
    extra: { screenName: p.get("screen_name"), userId: p.get("user_id") },
  };
}
