import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { exchangeGbpCode, gbpRedirectUri, saveGbpConnection } from "@/lib/gbp/oauth";

/**
 * Google の許可画面から戻ってくる先。コードを更新トークンに換えて保存し、元の画面へ返す。
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const jar = await cookies();
  let saved: { state?: string; analysis?: string } | null = null;
  try {
    saved = JSON.parse(jar.get("gbp_oauth")?.value ?? "null");
  } catch {
    saved = null;
  }
  const safeId = saved?.analysis && /^[A-Za-z0-9_-]{1,64}$/.test(saved.analysis) ? saved.analysis : "";
  const dest = safeId ? `/analysis/${safeId}/meo/settings` : "/settings";

  // 使い終えた state は必ず消す（開始時と同じ path でないと消えない）
  const back = (q: string) => {
    const res = NextResponse.redirect(new URL(`${dest}?${q}`, url.origin));
    res.cookies.set("gbp_oauth", "", { httpOnly: true, secure: true, sameSite: "lax", path: "/api/gbp", maxAge: 0 });
    return res;
  };
  const fail = (msg: string) => back(`gbp_error=${encodeURIComponent(msg.slice(0, 240))}`);

  const denied = url.searchParams.get("error");
  if (denied) return fail(denied === "access_denied" ? "連携がキャンセルされました" : `連携できませんでした（${denied}）`);
  if (!saved?.state) return fail("連携の開始から時間が経ちすぎました。もう一度「Googleで連携する」から始めてください");

  const code = url.searchParams.get("code");
  if (!code) return fail("認可コードが返りませんでした");
  if (url.searchParams.get("state") !== saved.state) return fail("連携の確認に失敗しました。もう一度お試しください");

  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user || user.is_anonymous) return fail("ログインが切れました。ログインし直してから連携してください");

  try {
    const t = await exchangeGbpCode(code, gbpRedirectUri(req.url));
    await saveGbpConnection(user.id, t);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
  return back("gbp_ok=1");
}
