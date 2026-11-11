import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { BANNER_BUCKET } from "@/lib/banner-studio/types";

/**
 * バナー制作の素材・絵・動画を、同じオリジンで返す（2026-11-11）。
 * PNG（html-to-image）や MP4（canvas）の書き出しは、別オリジンの画像だと失敗することがあるため。
 * パスの先頭が本人の user id のものだけ返す。
 */
export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const p = (path ?? []).map((x) => decodeURIComponent(x)).join("/");
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (!p.startsWith(`${user.id}/`) || p.includes("..")) return new Response("Not found", { status: 404 });
  const { data, error } = await createAdminClient().storage.from(BANNER_BUCKET).download(p);
  if (error || !data) return new Response("Not found", { status: 404 });
  const type = /\.mp4$/i.test(p) ? "video/mp4" : /\.jpe?g$/i.test(p) ? "image/jpeg" : /\.webp$/i.test(p) ? "image/webp" : "image/png";
  return new Response(data, { headers: { "content-type": type, "cache-control": "private, max-age=3600" } });
}
