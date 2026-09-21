import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { isAdPlatform } from "@/lib/ads/platforms";
import { exchangeCode, redirectUriFor, xAccessToken } from "@/lib/ads/oauth";
import { discoverAccounts } from "@/lib/ads/accounts";
import { saveConnection } from "@/lib/ads/tokens";

/**
 * 媒体の認可画面から戻ってくる先。コードをトークンに換えて保存し、設定画面へ返す。
 */
export async function GET(req: Request, ctx: { params: Promise<{ platform: string }> }) {
  const { platform } = await ctx.params;
  const url = new URL(req.url);
  const cookieName = `ad_oauth_${platform}`;
  // 使い終えた state は必ず消す（開始時と同じ path でないと消えない）
  const back = (q: string) => {
    const res = NextResponse.redirect(new URL(`/settings?${q}`, url.origin));
    res.cookies.set(cookieName, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/api/ads", maxAge: 0 });
    return res;
  };
  const fail = (msg: string) => back(`ad_error=${encodeURIComponent(msg.slice(0, 240))}`);

  if (!isAdPlatform(platform)) return fail("未対応の広告媒体です");

  const jar = await cookies();
  let saved: { state: string; secret?: string } | null = null;
  try {
    saved = JSON.parse(jar.get(cookieName)?.value ?? "null");
  } catch {
    saved = null;
  }

  const denied = url.searchParams.get("error_description") ?? url.searchParams.get("error") ?? url.searchParams.get("denied");
  if (denied) return fail(`連携がキャンセルされました（${denied}）`);
  if (!saved?.state) return fail("連携の開始から時間が経ちすぎました。もう一度「連携する」から始めてください");

  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user || user.is_anonymous) return fail("ログインが切れました。ログインし直してから連携してください");

  try {
    let tokens;
    if (platform === "x") {
      const oauthToken = url.searchParams.get("oauth_token");
      const verifier = url.searchParams.get("oauth_verifier");
      if (!oauthToken || !verifier || oauthToken !== saved.state || !saved.secret) {
        return fail("X からの応答を確認できませんでした。もう一度お試しください");
      }
      tokens = await xAccessToken(oauthToken, saved.secret, verifier);
    } else {
      // TikTok だけ、コードが auth_code という名前で返る
      const code = platform === "tiktok" ? url.searchParams.get("auth_code") : url.searchParams.get("code");
      if (!code) return fail("認可コードが返りませんでした");
      if (url.searchParams.get("state") !== saved.state) return fail("連携の確認に失敗しました。もう一度お試しください");
      tokens = await exchangeCode(platform, code, redirectUriFor(platform, req.url));
    }

    const { accounts, note } = await discoverAccounts(platform, tokens);
    await saveConnection(user.id, platform, tokens, accounts, note ? { note } : {});
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }

  return back(`ad_ok=${platform}`);
}
