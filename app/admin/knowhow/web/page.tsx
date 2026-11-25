import Link from "next/link";
import { notFound } from "next/navigation";
import { Shell } from "@/components/Shell";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTier } from "@/lib/tier";
import { discoverSkillsAction, runWebScanAction } from "@/app/knowhow-actions";
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
          公式サイト以外のウェブと X から、領域ごとにノウハウ案を集めます。見つかったページの本文を実際に読み、出典がある内容を案にします（根拠が1か所だけの案には、その旨を注記します。広告で公式ページを含まない案には、公式での確認を促す注意書きを付けます。X は広告では使いません）。案は受信箱（判断待ち）に「意見・分析」または「事業者・解説の報告」として入り、自動では反映しません。
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

        {sp.skills && (
          <div className="tag ok" style={{ marginTop: 12, display: "block", whiteSpace: "pre-wrap", lineHeight: 1.8 }}>
            Skill を探しました（{sp.st === "skipped" ? "今週は済み" : sp.st === "failed" ? "失敗" : "完了"}）：{sp.n}
            {sp.reg ? `\n登録：\n${sp.reg}` : ""}
            {"\n"}判断待ちに入れた案 {sp.new ?? 0} 件{Number(sp.left ?? 0) > 0 ? `（取り込みが残っています。公式ページの画面の「過去分を含めて全部取り込む」を押してください）` : ""}
          </div>
        )}
        <section className="card" style={{ marginTop: 16, padding: 16 }}>
          <h3 style={{ fontSize: 16 }}>X で話題の Agent Skills を探す</h3>
          <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 6, lineHeight: 1.9 }}>
            X で反応のある投稿（「SKILL.md」「Agent Skills」「Claude Code スキル」など）に付いた GitHub の SKILL.md を探し、AI がこのSaaSのノウハウ（サイト・LP・SEO・広告・法令など）の材料になるかを判定します。なるものだけ取り込み対象に登録し、案（判断待ち）にします（1回に最大5件）。対象外のものは「対象外」として残し、同じ判定をやり直しません。Skill の本文は読むだけで、指示としては実行しません。承認するまで何にも反映されません。
          </p>
          <form action={discoverSkillsAction} style={{ marginTop: 10 }}>
            <PendingButton className="btn sm" pendingText="探しています。2〜4分かかります（このままお待ちください。終わると結果が出ます）">Skill を探す</PendingButton>
          </form>
          <form action={discoverSkillsAction} style={{ marginTop: 8 }}>
            <input type="hidden" name="again" value="1" />
            <PendingButton className="btn sm ghost" pendingText="やり直しています。2〜4分かかります（このままお待ちください）">今週済みでもやり直す</PendingButton>
          </form>
        </section>

        {WEB_AREAS.map((area) => (
          <section key={area} className="card" style={{ marginTop: 16, padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <h3 style={{ fontSize: 16 }}>{WEB_AREA_LABEL[area]}</h3>
              <form action={runWebScanAction}>
                <input type="hidden" name="area" value={area} />
                <PendingButton className="btn sm" pendingText="集めています。2〜4分かかります（このままお待ちください。終わると結果が出ます）">{WEB_AREA_LABEL[area]}を集める</PendingButton>
              </form>
              <form action={runWebScanAction}>
                <input type="hidden" name="area" value={area} />
                <input type="hidden" name="again" value="1" />
                <PendingButton className="btn sm ghost" pendingText="やり直しています。2〜4分かかります（このままお待ちください）">今週済みの分も含めてやり直す</PendingButton>
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
