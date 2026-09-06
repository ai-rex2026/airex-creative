import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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
  const { error } = await sb.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error.message)}`, url.origin));
  }
  return NextResponse.redirect(new URL(next, url.origin));
}
