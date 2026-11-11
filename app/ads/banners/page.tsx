import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Shell } from "@/components/Shell";
import { BannerCreate } from "@/components/banner-studio/BannerCreate";

export const metadata = { title: "バナー制作｜AI-REX Studio" };

/** 広告運用 ＞ バナー制作の一覧（2026-11-11 新設） */
export default async function BannersPage() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login?callbackUrl=%2Fads%2Fbanners");
  if (user.is_anonymous) redirect("/login?mode=signup&callbackUrl=%2Fads%2Fbanners");
  const { data: rows } = await sb.from("banner_projects").select("id, name, url, description, created_at").eq("owner_id", user.id).order("created_at", { ascending: false });

  return (
    <Shell active="ads" sub="banners">
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        <h2 style={{ fontSize: 20 }}>バナー制作</h2>
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 6 }}>
          URL や商品・サービスの説明、素材から、法令チェックつきのコピーと絵の基本パターンを作り（絵は fal）、選んだ媒体のサイズへの展開と、5秒の短い動画まで作れます。文字は画面で重ねるので、日本語が崩れません。
        </p>
        {(rows ?? []).length > 0 && (
          <div className="rows" style={{ marginTop: 20 }}>
            <div className="rh">作成済み</div>
            {(rows ?? []).map((r) => (
              <div className="r" key={r.id}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b>{r.name || "（名称未設定）"}</b>
                  <small>
                    {r.url ? String(r.url).replace(/^https?:\/\//, "") : String(r.description ?? "").slice(0, 40)}／{new Date(String(r.created_at)).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" })}
                  </small>
                </div>
                <Link className="btn ghost sm" href={`/ads/banners/${r.id}`}>
                  開く
                </Link>
              </div>
            ))}
          </div>
        )}
        <div className="panel" style={{ marginTop: 22 }}>
          <h2>{(rows ?? []).length ? "新しく作る" : "まだありません"}</h2>
          <BannerCreate />
        </div>
      </div>
    </Shell>
  );
}
