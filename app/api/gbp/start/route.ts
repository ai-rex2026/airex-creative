import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { gbpAuthUrl, gbpRedirectUri, hasGbpApp } from "@/lib/gbp/oauth";

/**
 * Googleビジネスプロフィールの連携を始める（MEO運用の「設定」タブ、または設定画面から）。
 * ログイン（Supabase）とは別の OAuth。戻り先は /api/gbp/callback。state は httpOnly クッキーに持つ。
 * ?store=<id> があれば、終わったあとにその店舗の設定へ戻す。
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const store = url.searchParams.get("store") ?? "";
  // 戻り先に使うので、パスに使える文字だけ通す（オープンリダイレクト・パス操作の防止）
  const safeId = /^[A-Za-z0-9_-]{1,64}$/.test(store) ? store : "";
  const dest = safeId ? `/stores/${safeId}/settings` : "/settings";
  const back = (msg: string) => NextResponse.redirect(new URL(`${dest}?gbp_error=${encodeURIComponent(msg)}`, url.origin));

  if (!hasGbpApp()) return back("Google連携が未設定です（GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET）");

  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.redirect(new URL(`/login?callbackUrl=${encodeURIComponent(dest)}`, url.origin));
  if (user.is_anonymous) return back("店舗を連携するには、先に無料登録してください");

  const state = randomBytes(16).toString("hex");
  const res = NextResponse.redirect(gbpAuthUrl(gbpRedirectUri(req.url), state));
  res.cookies.set("gbp_oauth", JSON.stringify({ state, store: safeId }), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/gbp",
    maxAge: 600,
  });
  return res;
}
