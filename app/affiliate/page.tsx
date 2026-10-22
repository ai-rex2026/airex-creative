import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Shell } from "@/components/Shell";
import { loadCostTotals } from "@/lib/affiliate/cost";
import { fmtYen } from "@/lib/affiliate/usage";
import { hasDataForSeo } from "@/lib/affiliate/dataforseo";

export const metadata = { title: "アフィリエイト運用｜AI-REX Studio" };

export default async function AffiliatePage() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login?callbackUrl=%2Faffiliate");
  if (user.is_anonymous) redirect("/login?mode=signup&callbackUrl=%2Faffiliate");

  const [{ data: camps }, costs, { data: kws }] = await Promise.all([
    sb.from("aff_campaigns").select("id, name, client_name, product_name, created_at").order("created_at", { ascending: false }),
    loadCostTotals(sb),
    sb.from("aff_keywords").select("campaign_id"),
  ]);
  const kwCount = new Map<string, number>();
  for (const k of kws ?? []) kwCount.set(k.campaign_id as string, (kwCount.get(k.campaign_id as string) ?? 0) + 1);
  const rows = camps ?? [];

  return (
    <Shell active="affiliate">
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        <h2 style={{ fontSize: 20 }}>アフィリエイト運用</h2>
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 6 }}>
          商材ごとに、検索結果の上位にいるランキング／比較メディアを調べ、どの記事のどの順位に自社が載っているか（陣取りボード）をまとめます。メディアへの打診や掲載の承認は人が行います。
        </p>
        {!hasDataForSeo() && (
          <p style={{ fontSize: 12.5, color: "#92400e", background: "#fef3c7", padding: "8px 12px", borderRadius: 8, marginTop: 12 }}>
            DataForSEO の認証情報（DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD）が未設定です。設定するまでは Claude の検索で代用し、スポンサー広告の枠は取得できません。
          </p>
        )}
        {rows.length === 0 ? (
          <div className="panel" style={{ marginTop: 22 }}>
            <h2>まだ案件がありません</h2>
            <p>商品LPのURLを入れると、AIが案件とキーワード候補を作ります。</p>
            <p style={{ marginTop: 22 }}>
              <Link className="btn" href="/affiliate/new">案件を作る<span className="arw">→</span></Link>
            </p>
          </div>
        ) : (
          <>
            <div className="rows" style={{ marginTop: 20 }}>
              <div className="rh">案件</div>
              {rows.map((r) => (
                <div className="r" key={r.id as string}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <b>{(r.name as string) || "（名称未設定）"}</b>
                    <small>
                      {[r.client_name, r.product_name].filter(Boolean).join(" ／ ")} ／ KW {kwCount.get(r.id as string) ?? 0}件 ／ AI利用料 {fmtYen(costs.get(r.id as string) ?? 0)}
                    </small>
                  </div>
                  <Link className="btn ghost sm" href={`/affiliate/${r.id}`}>開く</Link>
                </div>
              ))}
            </div>
            <p style={{ marginTop: 20 }}>
              <Link className="btn ghost sm" href="/affiliate/new">＋ 案件を追加する</Link>
            </p>
          </>
        )}
      </div>
    </Shell>
  );
}
