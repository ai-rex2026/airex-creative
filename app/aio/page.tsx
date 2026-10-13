import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Shell } from "@/components/Shell";
import { listProjects } from "@/lib/aio/store";
import { INDUSTRY_LABEL } from "@/lib/types";

export const metadata = { title: "AIO（AI検索対策）｜AI-REX Studio" };

/**
 * AIO の対象一覧。店舗（MEO）とは別に、会社・サービス単位で登録する
 * （2026-10-13 のミーティング：店舗じゃないところもターゲットにできるように、左の MEO の並びに置く）。
 */
export default async function AioPage() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login?callbackUrl=%2Faio");
  if (user.is_anonymous) redirect("/login?mode=signup&callbackUrl=%2Faio");

  const rows = await listProjects(sb, user.id);

  return (
    <Shell active="aio">
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        <h2 style={{ fontSize: 20 }}>AIO（AI検索対策）</h2>
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 6 }}>
          ChatGPT・Gemini などに「おすすめを教えて」と聞かれたとき、自社が候補に挙がるかを実測し、挙がるための文章（自社サイト記事・note・プレスリリース・FAQ）を AI が下書きします。会社・サービス単位で登録します（店舗は MEO運用と共用できます）。
        </p>

        {rows.length === 0 ? (
          <div className="panel" style={{ marginTop: 22 }}>
            <h2>まだ対象がありません</h2>
            <p>会社やサービスの URL を入れると、AI が「探し方」の候補を考えます。登録後に「今どうか」を実測できます。</p>
            <p style={{ marginTop: 22 }}>
              <Link className="btn" href="/aio/new">対象を登録する<span className="arw">→</span></Link>
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
                  <Link className="btn ghost sm" href={`/aio/${r.id}`}>開く</Link>
                </div>
              ))}
            </div>
            <p style={{ marginTop: 20 }}>
              <Link className="btn ghost sm" href="/aio/new">＋ 対象を追加する</Link>
            </p>
          </>
        )}
      </div>
    </Shell>
  );
}
