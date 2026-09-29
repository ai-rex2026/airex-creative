import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { isSnsPlatform, missingSnsEnv, snsPlatformDef } from "@/lib/social-connect/platforms";
import { buildAuthUrl, pkcePair, redirectUriFor } from "@/lib/social-connect/oauth";

/**
 * 公式SNSアカウントの連携を始める。設定画面の「連携する」から来て、各SNSの認可画面へ送る。
 * 戻り先は /api/social/{platform}/callback。CSRF対策の state（Xは code_verifier も）は
 * httpOnly クッキーに持つ（app/api/ads/[platform]/start と同じ形）。
 */
export async function GET(req: Request, ctx: { params: Promise<{ platform: string }> }) {
  const { platform } = await ctx.params;
  const url = new URL(req.url);
  const back = (msg: string) => NextResponse.redirect(new URL(`/settings?sns_error=${encodeURIComponent(msg)}`, url.origin));

  if (!isSnsPlatform(platform)) return back("未対応のSNSです");

  const missing = missingSnsEnv(snsPlatformDef(platform));
  if (missing.length) return back(`${snsPlatformDef(platform).name}の連携は未設定です（${missing.join(" / ")}）`);

  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login?callbackUrl=%2Fsettings", url.origin));
  // SNSアカウントのトークンは、ゲスト（ログアウトすると開けなくなる一時アカウント）には預からない
  if (user.is_anonymous) return back("SNSアカウントを連携するには、先に本登録してください");

  const redirectUri = redirectUriFor(platform, req.url);
  const state = randomBytes(16).toString("hex");
  const cookie: { state: string; verifier?: string } = { state };

  let authUrl: string;
  if (platform === "x") {
    const { verifier, challenge } = pkcePair();
    cookie.verifier = verifier;
    authUrl = buildAuthUrl(platform, redirectUri, state, challenge);
  } else {
    authUrl = buildAuthUrl(platform, redirectUri, state);
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
