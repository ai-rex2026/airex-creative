import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Shell } from "@/components/Shell";

export const metadata = { title: "広告運用｜AI-REX Studio" };

/** 広告運用の入口（2026-11-11 新設）。媒体との連携は準備中で、いまはバナー制作だけ */
export default async function AdsPage() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login?callbackUrl=%2Fads");
  const { count } = await sb.from("banner_projects").select("id", { count: "exact", head: true }).eq("owner_id", user.id);

  return (
    <Shell active="ads">
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        <h2 style={{ fontSize: 20 }}>広告運用</h2>
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 6 }}>広告のクリエイティブづくりと、各媒体での運用をまとめる場所です。</p>
        <div className="rows" style={{ marginTop: 20 }}>
          <div className="r">
            <div style={{ flex: 1, minWidth: 0 }}>
              <b>バナー制作</b>
              <small>URL・商品の説明・素材から、コピーと絵の基本パターンを作り、媒体ごとのサイズと短い動画に展開します{count ? `（${count}件）` : ""}</small>
            </div>
            <Link className="btn sm" href="/ads/banners">
              開く
            </Link>
          </div>
          <div className="r">
            <div style={{ flex: 1, minWidth: 0 }}>
              <b>媒体との連携（準備中）</b>
              <small>Meta・Google・Yahoo!・LINE・TikTok・X の広告アカウントとの連携は準備中です。できたバナーは各媒体の管理画面から入稿してください。</small>
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}
