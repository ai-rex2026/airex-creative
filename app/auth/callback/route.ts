import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

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

  return NextResponse.redirect(new URL(next, url.origin));
}
