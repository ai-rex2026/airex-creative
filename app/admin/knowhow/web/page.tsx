import Link from "next/link";
import { notFound } from "next/navigation";
import { Shell } from "@/components/Shell";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTier } from "@/lib/tier";
import { runWebScanAction } from "@/app/knowhow-actions";
import { PendingButton } from "@/components/admin/PendingButton";
import { WEB_AREAS, WEB_AREA_LABEL, WEB_PLANS, weekKey } from "@/lib/knowhow-web";
import { unitsFor } from "@/lib/knowhow-web-run";

export const metadata = { title: "第三者の情報から集める｜AI-REX Studio" };
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) : "";

type Run = { key: string; area: string; unit: string; status: string; attempts: number; created: number; read: number; note: string; ran_at: string };

/** 公式サイト以外のウェブ・X からノウハウ案を集める（管理者だけ）。領域ごとに手動で流して、出来を確かめてから週1の自動実行に入れる */
export default async function KnowhowWeb({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { tier } = await getTier();
  if (tier !== "admin") notFound();
  const sp = await searchParams;
  const week = weekKey(new Date());
  const { data } = await createAdminClient().from("knowhow_web_runs").select("*").eq("week", week).limit(100);
  const runs = (data ?? []) as Run[];
  const runOf = (area: string, unit: string) => runs.find((r) => r.area === area && r.unit === unit);

  return (
    <Shell active="admin">
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <p style={{ fontSize: 12.5 }}>
          <Link href="/admin/knowhow" style={{ textDecoration: "underline" }}>← ノウハウ更新案</Link>
        </p>
        <h2 style={{ fontSize: 20, marginTop: 8 }}>第三者の情報から集める（ウェブ・X）</h2>
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 6, lineHeight: 1.9 }}>
          公式サイト以外のウェブと X から、領域ごとにノウハウ案を集めます。見つかったページの本文を実際に読み、<b>独立した2か所以上</b>に書かれている内容だけを案にします（広告は、公式ページの根拠が1つ以上必要です。X は広告では使いません）。案は受信箱（判断待ち）に「意見・分析」または「事業者・解説の報告」として入り、自動では反映しません。
        </p>
        <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 6, lineHeight: 1.9 }}>
          いまは手動だけです（週1回の自動実行は、各領域の出来を確かめてから入れます）。同じ週に済んだ調べ物は飛ばすので、押し直しても有料の検索・AI は繰り返しません。X の検索は1日12回までです。
        </p>
        {sp.err && <p style={{ marginTop: 12, fontSize: 13, color: "var(--ng)" }}>{sp.err}</p>}
        {sp.area && (
          <div className="tag ok" style={{ marginTop: 12, display: "block", whiteSpace: "pre-wrap", lineHeight: 1.8 }}>
            {WEB_AREA_LABEL[sp.area as keyof typeof WEB_AREA_LABEL] ?? sp.area}を集めました：判断待ちに入れた案 {sp.new ?? 0} 件{"\n"}
            {sp.u}
          </div>
        )}

        {WEB_AREAS.map((area) => (
          <section key={area} className="card" style={{ marginTop: 16, padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <h3 style={{ fontSize: 16 }}>{WEB_AREA_LABEL[area]}</h3>
              <form action={runWebScanAction}>
                <input type="hidden" name="area" value={area} />
                <PendingButton className="btn sm" pendingText="集めています。2〜4分かかります（このままお待ちください。終わると結果が出ます）">{WEB_AREA_LABEL[area]}を集める</PendingButton>
              </form>
            </div>
            <ul style={{ marginTop: 10, fontSize: 12.5, lineHeight: 1.9, color: "var(--muted)" }}>
              {unitsFor(area).map((u) => {
                const r = runOf(area, u.id);
                return (
                  <li key={u.id}>
                    ・{u.label}
                    {u.unit.kind === "x" ? `（${WEB_PLANS[area].xKeywords.join("・")}）` : ""}
                    {r ? (
                      <span>
                        {" "}— {r.status === "done" ? `済み（${fmt(r.ran_at)}・読んだ ${r.read} 件・案 ${r.created} 件）` : `失敗（${r.attempts}回目・${fmt(r.ran_at)}）`}
                        {r.note ? `：${r.note}` : ""}
                      </span>
                    ) : (
                      <span> — 今週はまだ</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </Shell>
  );
}
