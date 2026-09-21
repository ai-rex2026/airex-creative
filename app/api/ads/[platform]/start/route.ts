import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { isAdPlatform, missingEnv, platformDef } from "@/lib/ads/platforms";
import { buildAuthUrl, redirectUriFor, xAuthorizeUrl, xRequestToken } from "@/lib/ads/oauth";

/**
 * 広告媒体の連携を始める。設定画面の「連携する」から来て、媒体の認可画面へ送る。
 * 戻り先は /api/ads/{platform}/callback。CSRF 対策の state は httpOnly クッキーに持つ。
 */
export async function GET(req: Request, ctx: { params: Promise<{ platform: string }> }) {
  const { platform } = await ctx.params;
  const url = new URL(req.url);
  const back = (msg: string) => NextResponse.redirect(new URL(`/settings?ad_error=${encodeURIComponent(msg)}`, url.origin));

  if (!isAdPlatform(platform)) return back("未対応の広告媒体です");

  const missing = missingEnv(platformDef(platform));
  if (missing.length) return back(`${platformDef(platform).name}の連携は未設定です（${missing.join(" / ")}）`);

  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login?callbackUrl=%2Fsettings", url.origin));
  // 広告アカウントのトークンは、ゲスト（ログアウトすると開けなくなる一時アカウント）には預からない
  if (user.is_anonymous) return back("広告アカウントを連携するには、先に本登録してください");

  const redirectUri = redirectUriFor(platform, req.url);
  let authUrl: string;
  const cookie: { state: string; secret?: string } = { state: "" };

  try {
    if (platform === "x") {
      const rt = await xRequestToken(redirectUri);
      cookie.state = rt.token; // X は state を持てないので、リクエストトークンで突き合わせる
      cookie.secret = rt.secret;
      authUrl = xAuthorizeUrl(rt.token);
    } else {
      cookie.state = randomBytes(16).toString("hex");
      authUrl = buildAuthUrl(platform, redirectUri, cookie.state);
    }
  } catch (e) {
    return back(e instanceof Error ? e.message : String(e));
  }

  const res = NextResponse.redirect(authUrl);
  res.cookies.set(`ad_oauth_${platform}`, JSON.stringify(cookie), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/ads",
    maxAge: 600,
  });
  return res;
}
