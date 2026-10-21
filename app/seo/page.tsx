import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Shell } from "@/components/Shell";
import { listProjects } from "@/lib/aio/store";
import { INDUSTRY_LABEL } from "@/lib/types";

export const metadata = { title: "SEO運用｜AI-REX Studio" };

/**
 * SEO運用の対象一覧（2026-10-21 新設）。対象は AIO と同じ「会社（プロジェクト）」で共有する
 * （記事・文体・WordPress 連携・内部対策のリストを AIO と使い回すため）。
 */
export default async function SeoPage() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login?callbackUrl=%2Fseo");
  if (user.is_anonymous) redirect("/login?mode=signup&callbackUrl=%2Fseo");

  const rows = await listProjects(sb, user.id);

  return (
    <Shell active="seo">
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        <h2 style={{ fontSize: 20 }}>SEO運用</h2>
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 6 }}>
          検索で見込み客に届くための運用です。自社サイトのコラム記事、別ドメインのサテライトサイト（比較・解説メディア）の記事、自社サイト・LP の内部対策を、AI の下書きと人の承認で回します。対象は AIO（AI検索対策）と共通です。
        </p>

        {rows.length === 0 ? (
          <div className="panel" style={{ marginTop: 22 }}>
            <h2>まだ対象がありません</h2>
            <p>会社やサービスの URL を入れて登録します（AIO と共通の対象になります）。</p>
            <p style={{ marginTop: 22 }}>
              <Link className="btn" href="/seo/new">対象を登録する<span className="arw">→</span></Link>
            </p>
          </div>
        ) : (
          <>
            <div className="rows" style={{ marginTop: 20 }}>
              <div className="rh">登録済みの対象</div>
              {rows.map((r) => (
                <div className="r" key={r.id}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <b>{r.name || "（名称未設定）"}</b>
                    <small>
                      {r.area ? `${r.area}で` : ""}{r.category || "探し方 未設定"} ／ {INDUSTRY_LABEL[r.industry]}{r.url ? ` ／ ${r.url.replace(/^https?:\/\//, "")}` : ""}
                    </small>
                  </div>
                  <Link className="btn ghost sm" href={`/seo/${r.id}`}>開く</Link>
                </div>
              ))}
            </div>
            <p style={{ marginTop: 20 }}>
              <Link className="btn ghost sm" href="/seo/new">＋ 対象を追加する</Link>
            </p>
          </>
        )}
      </div>
    </Shell>
  );
}
