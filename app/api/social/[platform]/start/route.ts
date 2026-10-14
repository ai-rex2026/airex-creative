import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { isSnsPlatform, snsPlatformDef } from "@/lib/social-connect/platforms";
import { credsFor } from "@/lib/social-connect/app-creds";
import { buildAuthUrl, pkcePair, redirectUriFor } from "@/lib/social-connect/oauth";

/**
 * 公式SNSアカウントの連携を始める。設定画面の「連携する」から来て、各SNSの認可画面へ送る。
 * 戻り先は /api/social/{platform}/callback。CSRF対策の state（Xは code_verifier も）は
 * httpOnly クッキーに持つ（app/api/ads/[platform]/start と同じ形）。
 */
export async function GET(req: Request, ctx: { params: Promise<{ platform: string }> }) {
  const { platform } = await ctx.params;
  const url = new URL(req.url);
  // 戻り先（SNS運用の各媒体の画面から来たときはそこへ戻す）
  const backTo = /^\/sns(\/[a-z]+)?$/.test(url.searchParams.get("back") ?? "") ? url.searchParams.get("back")! : "/settings";
  const back = (msg: string) => NextResponse.redirect(new URL(`${backTo}?sns_error=${encodeURIComponent(msg)}`, url.origin));

  if (!isSnsPlatform(platform)) return back("未対応のSNSです");

  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login?callbackUrl=%2Fsettings", url.origin));
  // SNSアカウントのトークンは、ゲスト（ログアウトすると開けなくなる一時アカウント）には預からない
  if (user.is_anonymous) return back("SNSアカウントを連携するには、先に無料登録してください");

  // 自社のアプリの鍵があればそれで、無ければ共通のアプリで連携する
  const creds = await credsFor(user.id, platform);
  if (!creds) return back(`${snsPlatformDef(platform).name}の連携に使うアプリの鍵がありません。SNS運用の「アプリの鍵」から登録してください`);

  const redirectUri = redirectUriFor(platform, req.url);
  const state = randomBytes(16).toString("hex");
  const cookie: { state: string; verifier?: string; clientId: string; back: string } = { state, clientId: creds.clientId, back: backTo };

  let authUrl: string;
  if (platform === "x") {
    const { verifier, challenge } = pkcePair();
    cookie.verifier = verifier;
    authUrl = buildAuthUrl(platform, creds, redirectUri, state, challenge);
  } else {
    authUrl = buildAuthUrl(platform, creds, redirectUri, state);
  }

  const res = NextResponse.redirect(authUrl);
  res.cookies.set(`sns_oauth_${platform}`, JSON.stringify(cookie), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/social",
    maxAge: 600,
  });
  return res;
}
