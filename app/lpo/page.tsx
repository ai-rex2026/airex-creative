import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Shell } from "@/components/Shell";
import { LpoCreate } from "@/components/lpo/LpoCreate";

export const metadata = { title: "LPO運用｜AI-REX Studio" };
// URL から作るときは、サイトの読み取り・何を売っているかの判定・LP改善の作成・表示速度の計測を Action で行う
export const maxDuration = 300;

/** LPO運用の対象一覧（2026-11-11 新設） */
export default async function LpoPage() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login?callbackUrl=%2Flpo");
  if (user.is_anonymous) redirect("/login?mode=signup&callbackUrl=%2Flpo");

  const [{ data: rows }, { data: analyses }] = await Promise.all([
    sb.from("lpo_projects").select("id, name, url, plan, plan_done, speed, created_at").eq("owner_id", user.id).order("created_at", { ascending: false }),
    sb.from("analyses").select("id, url, created_at, diagnosis").eq("owner_id", user.id).eq("status", "done").order("created_at", { ascending: false }).limit(40),
  ]);
  const options = (analyses ?? []).map((a) => ({
    id: String(a.id),
    label: `${(a.diagnosis as { brand?: { name?: string } } | null)?.brand?.name || String(a.url).replace(/^https?:\/\//, "")}（${new Date(String(a.created_at)).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" })}）`,
  }));

  return (
    <Shell active="lpo">
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        <h2 style={{ fontSize: 20 }}>LPO運用</h2>
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 6 }}>
          広告の受け皿になる LP を、LP改善・表示速度改善・ヒートマップ分析で直していきます。分析レポートから取り込むと、そのレポートの LP改善と表示速度を引き継ぎます。
        </p>

        {(rows ?? []).length > 0 && (
          <div className="rows" style={{ marginTop: 20 }}>
            <div className="rh">登録済みの LP</div>
            {(rows ?? []).map((r) => {
              const total = ((r.plan as { groups?: { items?: unknown[] }[] } | null)?.groups ?? []).reduce((s, g) => s + (g.items?.length ?? 0), 0);
              const done = Array.isArray(r.plan_done) ? r.plan_done.length : 0;
              const score = (r.speed as { score?: number | null } | null)?.score;
              return (
                <div className="r" key={r.id}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <b>{r.name || "（名称未設定）"}</b>
                    <small>
                      {String(r.url).replace(/^https?:\/\//, "")}
                      {total > 0 && ` ／ LP改善 ${Math.min(done, total)}/${total} 済み`}
                      {typeof score === "number" && ` ／ 表示速度 ${score}点`}
                    </small>
                  </div>
                  <Link className="btn ghost sm" href={`/lpo/${r.id}`}>
                    開く
                  </Link>
                </div>
              );
            })}
          </div>
        )}

        <div className="panel" style={{ marginTop: 22 }}>
          <h2>{(rows ?? []).length ? "LP を追加する" : "まだ LP がありません"}</h2>
          <LpoCreate analyses={options} />
        </div>
      </div>
    </Shell>
  );
}
