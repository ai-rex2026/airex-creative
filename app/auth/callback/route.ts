import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { discoverMetaPages, exchangeLongLivedToken } from "@/lib/meta";

/**
 * OAuth から戻ってくる先。認可コードをセッションに交換して、元いた画面へ返す。
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/analysis";
  const err = url.searchParams.get("error_description") ?? url.searchParams.get("error");

  if (err) {
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(err)}`, url.origin));
  }
  if (!code) {
    return NextResponse.redirect(new URL("/login?error=" + encodeURIComponent("認可コードが返りませんでした"), url.origin));
  }

  const sb = await createClient();
  const { data, error } = await sb.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error.message)}`, url.origin));
  }

  // Search Console / GA4 を読むための更新トークンは、ここでしか受け取れないので保存する。
  // Supabase はプロバイダのトークンを保持しないため、こちらで持つ必要がある。
  const refresh = data.session?.provider_refresh_token;
  const userId = data.session?.user?.id;
  if (refresh && userId) {
    const admin = createAdminClient();
    await admin.from("google_connections").upsert({
      user_id: userId,
      refresh_token: refresh,
      scope: url.searchParams.get("scope") ?? null,
      connected_at: new Date().toISOString(),
    });
  }

  // Meta（Facebook Login経由）。Facebookはrefresh_tokenを発行しないため、
  // 数時間で切れるprovider_tokenをここで60日の長期トークンに交換してから保存する。
  const providerToken = data.session?.provider_token;
  const provider = data.session?.user?.app_metadata?.provider;
  if (providerToken && userId && provider === "facebook") {
    try {
      const { accessToken, expiresAt } = await exchangeLongLivedToken(providerToken);
      const pages = await discoverMetaPages(accessToken);
      // 複数Pageを管理している場合、Instagramビジネスアカウントが紐づく方を優先する
      const chosen = pages.find((p) => p.igBusinessId) ?? pages[0] ?? null;
      if (chosen) {
        const admin = createAdminClient();
        await admin.from("meta_connections").upsert({
          user_id: userId,
          access_token: chosen.pageAccessToken,
          token_expires_at: expiresAt,
          page_id: chosen.pageId,
          page_name: chosen.pageName,
          ig_business_id: chosen.igBusinessId,
          ig_username: chosen.igUsername,
          scope: url.searchParams.get("scope") ?? null,
          connected_at: new Date().toISOString(),
        });
      } else {
        return NextResponse.redirect(
          new URL(`${next}?error=${encodeURIComponent("管理しているFacebook Pageが見つかりませんでした")}`, url.origin)
        );
      }
    } catch (e) {
      return NextResponse.redirect(
        new URL(`${next}?error=${encodeURIComponent(e instanceof Error ? e.message : String(e))}`, url.origin)
      );
    }
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
