import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { isSnsPlatform } from "@/lib/social-connect/platforms";
import { exchangeCode, redirectUriFor, type SnsTokenSet } from "@/lib/social-connect/oauth";
import { saveSnsConnection } from "@/lib/social-connect/tokens";
import { fetchXProfile } from "@/lib/social-connect/x";
import { fetchTikTokProfile } from "@/lib/social-connect/tiktok";
import { fetchMetaProfileAndToken } from "@/lib/social-connect/meta";

/**
 * 各SNSの認可画面から戻ってくる先。コードをトークンに換えてプロフィールを取得・保存し、
 * 設定画面へ返す（app/api/ads/[platform]/callback と同じ形）。
 *
 * Meta（Instagram/Facebook）だけは exchangeCode が返すのがユーザーの長期トークンで、
 * 実際に保存するPageアクセストークン・Instagramプロフィールへの変換は
 * fetchMetaProfileAndToken（lib/social-connect/meta.ts）でもう一段行う。
 */
export async function GET(req: Request, ctx: { params: Promise<{ platform: string }> }) {
  const { platform } = await ctx.params;
  const url = new URL(req.url);
  const cookieName = `sns_oauth_${platform}`;
  // 使い終えた state は必ず消す（開始時と同じ path でないと消えない）
  const back = (q: string) => {
    const res = NextResponse.redirect(new URL(`/settings?${q}`, url.origin));
    res.cookies.set(cookieName, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/api/social", maxAge: 0 });
    return res;
  };
  const fail = (msg: string) => back(`sns_error=${encodeURIComponent(msg.slice(0, 240))}`);

  if (!isSnsPlatform(platform)) return fail("未対応のSNSです");

  const jar = await cookies();
  let saved: { state: string; verifier?: string } | null = null;
  try {
    saved = JSON.parse(jar.get(cookieName)?.value ?? "null");
  } catch {
    saved = null;
  }

  const denied = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  if (denied) return fail(`連携がキャンセルされました（${denied}）`);
  if (!saved?.state) return fail("連携の開始から時間が経ちすぎました。もう一度「連携する」から始めてください");

  const code = url.searchParams.get("code");
  if (!code) return fail("認可コードが返りませんでした");
  if (url.searchParams.get("state") !== saved.state) return fail("連携の確認に失敗しました。もう一度お試しください");

  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user || user.is_anonymous) return fail("ログインが切れました。ログインし直してから連携してください");

  try {
    const tokens = await exchangeCode(platform, code, redirectUriFor(platform, req.url), saved.verifier);

    let finalTokens: SnsTokenSet = tokens;
    let profile: Record<string, unknown>;
    if (platform === "x") {
      profile = (await fetchXProfile(tokens.accessToken)) as unknown as Record<string, unknown>;
    } else if (platform === "tiktok") {
      profile = (await fetchTikTokProfile(tokens.accessToken)) as unknown as Record<string, unknown>;
    } else {
      const r = await fetchMetaProfileAndToken(tokens.accessToken);
      finalTokens = r.tokens;
      profile = r.profile;
    }

    await saveSnsConnection(user.id, platform, finalTokens, profile);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }

  return back(`sns_ok=${platform}`);
}
