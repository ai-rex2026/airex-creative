import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Shell } from "@/components/Shell";
import { INDUSTRY_LABEL, type Industry } from "@/lib/types";

export const metadata = { title: "店舗｜AI-REX Studio" };

type Row = {
  id: string;
  name: string | null;
  industry: Industry | null;
  meo_gbp_location: string | null;
  meo_store: { address?: string | null; rating?: number | null; reviewCount?: number | null } | null;
};

/** 店舗の一覧。店舗は分析レポートとは独立していて、ここから運用画面（クチコミ・投稿・プロフィール・AI検索）へ入る */
export default async function StoresPage() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login?callbackUrl=%2Fstores");
  if (user.is_anonymous) redirect("/login?mode=signup&callbackUrl=%2Fstores");

  const { data } = await sb
    .from("stores")
    .select("id, name, industry, meo_gbp_location, meo_store")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false });
  const rows = (data ?? []) as Row[];
  // 担当店の数字（オルコネの「ダッシュボード」）：集客スコア・口コミ・未返信・確認待ち
  const ids = rows.map((r) => r.id);
  const [scores, pending, unreplied] = ids.length
    ? await Promise.all([
        sb.from("meo_kit_steps").select("store_id, result").eq("step", "score").in("store_id", ids),
        sb.from("meo_auto_log").select("store_id").eq("status", "pending").in("store_id", ids).limit(2000),
        sb.from("meo_reviews").select("store_id").eq("reply_status", "unreplied").in("store_id", ids).limit(5000),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];
  const scoreOf = new Map((scores.data ?? []).map((x) => [String(x.store_id), x.result as { total?: number; rank?: string } | null]));
  const countBy = (list: { store_id: unknown }[] | null) => {
    const m = new Map<string, number>();
    for (const x of list ?? []) m.set(String(x.store_id), (m.get(String(x.store_id)) ?? 0) + 1);
    return m;
  };
  const pendingOf = countBy(pending.data as { store_id: unknown }[] | null);
  const unrepliedOf = countBy(unreplied.data as { store_id: unknown }[] | null);

  return (
    <Shell active="stores">
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        <h2 style={{ fontSize: 20 }}>店舗（MEO運用）</h2>
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 6 }}>
          運用する店舗の一覧です。店舗は分析レポートとは別に登録します。
        </p>

        {rows.length === 0 ? (
          <div className="panel" style={{ marginTop: 22 }}>
            <h2>まだ店舗がありません</h2>
            <p>Googleマップ上の店舗を検索して登録すると、クチコミ返信・プロフィール更新・AI検索の確認を店舗ごとに管理できます。</p>
            <p style={{ marginTop: 22 }}>
              <Link className="btn" href="/stores/new">店舗を登録する<span className="arw">→</span></Link>
            </p>
          </div>
        ) : (
          <>
            <div className="rows" style={{ marginTop: 20 }}>
              <div className="rh">登録済みの店舗</div>
              {rows.map((r) => (
                <div className="r" key={r.id}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <b>{r.name || "（店舗名未設定）"}</b>
                    <small>
                      {r.meo_store?.address ?? "住所未取得"} ／ {INDUSTRY_LABEL[r.industry ?? "general"]} ／ Google連携：
                      {r.meo_gbp_location ? "済み" : "未連携"}
                    </small>
                    <small style={{ display: "block", marginTop: 2 }}>
                      集客スコア：{scoreOf.get(r.id)?.total != null ? `${scoreOf.get(r.id)?.total}点（${scoreOf.get(r.id)?.rank ?? "-"}）` : "未採点"}
                      {" ／ "}口コミ：{r.meo_store?.reviewCount != null ? `${r.meo_store.reviewCount}件` : "—"}
                      {r.meo_store?.rating != null ? `（★${Number(r.meo_store.rating).toFixed(1)}）` : ""}
                      {" ／ "}未返信：{unrepliedOf.get(r.id) ?? 0}件
                      {(pendingOf.get(r.id) ?? 0) > 0 && <b style={{ marginLeft: 6, color: "#8A6A1E" }}>確認待ち {pendingOf.get(r.id)}件</b>}
                    </small>
                  </div>
                  <Link className="btn ghost sm" href={`/stores/${r.id}`}>運用画面を開く</Link>
                </div>
              ))}
            </div>
            <p style={{ marginTop: 20 }}>
              <Link className="btn ghost sm" href="/stores/new">＋ 店舗を追加する</Link>
            </p>
          </>
        )}
      </div>
    </Shell>
  );
}
