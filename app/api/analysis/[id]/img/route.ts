import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SiteScan } from "@/lib/site-scan";
import type { CustomImage } from "@/lib/analysis";

/**
 * バナーに載せる画像を、こちらのドメイン経由で返す。
 *
 * 外部ドメインの画像をそのまま <img> に入れると、PNG に書き出すときに
 * canvas が汚染されて書き出しごと失敗する。同一オリジンにするために挟む。
 *
 * 任意のURLを取りに行けると社内ネットワークへの踏み台になるので、
 * **その分析のサイトから実際に拾った画像URLだけ**を通す。
 *
 * `c`（custom）はサイトの画像ではなく、利用者がアップロードした独自素材。
 * こちらは外部URLではなく Storage 上のパスなので、本人の分析に紐づく
 * custom_images に載っているパスかどうかを確認してから Storage から返す。
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const u = url.searchParams.get("u");
  const c = url.searchParams.get("c");
  if (!u && !c) return new Response("missing url", { status: 400 });

  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return new Response("unauthorized", { status: 401 });

  if (c) {
    const { data: row } = await sb.from("analyses").select("custom_images").eq("id", id).eq("owner_id", user.id).single();
    const list = (row?.custom_images as CustomImage[] | null) ?? [];
    if (!list.some((x) => x.path === c)) return new Response("not allowed", { status: 403 });

    const admin = createAdminClient();
    const { data: file, error } = await admin.storage.from("banner-uploads").download(c);
    if (error || !file) return new Response("fetch failed", { status: 502 });

    return new Response(await file.arrayBuffer(), {
      headers: {
        "content-type": file.type || "application/octet-stream",
        "cache-control": "private, max-age=3600",
      },
    });
  }

  const { data } = await sb.from("analyses").select("site").eq("id", id).eq("owner_id", user.id).single();
  const site = data?.site as SiteScan | null;
  // 許可リストとの完全一致だけを通す。部分一致にすると回避できてしまう
  if (!u || !site?.images?.includes(u)) return new Response("not allowed", { status: 403 });

  let res: Response;
  try {
    res = await fetch(u, {
      headers: { "user-agent": "Mozilla/5.0", accept: "image/*" },
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    return new Response("fetch failed", { status: 502 });
  }
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || !type.startsWith("image/")) return new Response("not an image", { status: 415 });

  const buf = await res.arrayBuffer();
  if (buf.byteLength > 8_000_000) return new Response("too large", { status: 413 });

  return new Response(buf, {
    headers: {
      "content-type": type,
      "cache-control": "private, max-age=3600",
    },
  });
}
