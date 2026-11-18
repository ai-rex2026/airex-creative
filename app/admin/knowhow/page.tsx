import Link from "next/link";
import { notFound } from "next/navigation";
import { Shell } from "@/components/Shell";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTier } from "@/lib/tier";
import { decideKnowhowAction } from "@/app/knowhow-actions";

export const metadata = { title: "ノウハウ更新案｜AI-REX Studio" };
export const dynamic = "force-dynamic";

type Item = {
  id: string;
  area: string;
  kind: string;
  title: string;
  summary: string;
  proposal: string;
  target: string;
  sources: { title: string; url: string }[];
  evidence: string;
  caveat: string;
  is_guess: boolean;
  risk: string;
  status: string;
  decision_note: string;
  decided_at: string | null;
  fetched_on: string | null;
  form: string;
  applied_text: string;
  rule: { pattern?: string; reason?: string; law?: string; suggestion?: string } | null;
};

const AREA: Record<string, string> = { meo: "MEO", seo: "SEO", aio: "AIO", lpo: "LPO", image: "画像生成", legal: "法令" };
const KIND: Record<string, string> = { add: "追加", change: "変更", nochange: "変更なし" };
const EVIDENCE: Record<string, string> = { official: "公式の根拠", vendor: "事業者・解説の報告", opinion: "意見・分析" };
const TABS: [string, string][] = [["pending", "判断待ち"], ["approved", "承認"], ["held", "保留"], ["rejected", "却下"]];

/** ノウハウ更新案の受信箱。管理者だけ（ほかの人には存在も見せない）。スマホで1件ずつ 承認／保留／却下 を選ぶ */
export default async function KnowhowInbox({ searchParams }: { searchParams: Promise<{ s?: string; err?: string }> }) {
  const { tier } = await getTier();
  if (tier !== "admin") notFound();
  const sp = await searchParams;
  const status = TABS.some(([k]) => k === sp.s) ? (sp.s as string) : "pending";

  const sb = createAdminClient();
  const [{ data }, counts] = await Promise.all([
    sb.from("knowhow_items").select("*").eq("status", status).order("created_at", { ascending: false }).limit(100),
    sb.from("knowhow_items").select("status").limit(2000),
  ]);
  const items = (data ?? []) as Item[];
  const n = new Map<string, number>();
  for (const r of counts.data ?? []) n.set(String(r.status), (n.get(String(r.status)) ?? 0) + 1);

  return (
    <Shell active="admin">
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <h2 style={{ fontSize: 20 }}>ノウハウ更新案</h2>
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 6, lineHeight: 1.9 }}>
          調査で見つけた更新案を、1件ずつ判断します。承認すると、領域ごとのAIへの指示と法令チェックに反映されます（「反映される文」が、そのまま追加されます）。「判断待ちに戻す」か「却下」にすると、すぐ外れます。
        </p>
        {sp.err && <p style={{ marginTop: 12, fontSize: 13, color: "var(--ng)" }}>{sp.err}</p>}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 18 }}>
          {TABS.map(([k, label]) => (
            <Link key={k} href={`/admin/knowhow?s=${k}`} className={`tag${status === k ? " on" : ""}`} style={{ textDecoration: "none" }}>
              {label} {n.get(k) ?? 0}
            </Link>
          ))}
        </div>

        {items.length === 0 && (
          <div className="panel" style={{ marginTop: 18 }}>
            <h2>ここには何もありません</h2>
          </div>
        )}

        {items.map((it) => (
          <section key={it.id} style={{ marginTop: 18, background: "#fff", border: "1px solid var(--line)", borderRadius: 6, padding: "20px 20px 18px" }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <span className="tag score">{AREA[it.area] ?? it.area}</span>
              <span className="tag warn">{KIND[it.kind] ?? it.kind}</span>
              <span className="tag warn">{EVIDENCE[it.evidence] ?? it.evidence}</span>
              {it.is_guess && <span className="tag ng">推測を含む</span>}
              {it.risk === "legal" && <span className="tag ng">法令に関わる</span>}
            </div>
            <h3 style={{ fontSize: 16, marginTop: 10, lineHeight: 1.6 }}>{it.title}</h3>
            <p style={{ fontSize: 13, marginTop: 8, lineHeight: 1.9 }}>{it.summary}</p>
            <p style={{ fontSize: 13, marginTop: 8, lineHeight: 1.9 }}>
              <b>提案：</b>
              {it.proposal}
            </p>
            {it.target && <p style={{ fontSize: 12.5, marginTop: 6, color: "var(--muted)" }}>変える場所：{it.target}</p>}
            {it.caveat && <p style={{ fontSize: 12.5, marginTop: 6, color: "var(--muted)", lineHeight: 1.8 }}>注意：{it.caveat}</p>}
            <p style={{ fontSize: 12.5, marginTop: 8 }}>
              出典：
              {it.sources.map((s, i) => (
                <span key={s.url}>
                  {i > 0 && "／"}
                  <a href={s.url} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>
                    {s.title}
                  </a>
                </span>
              ))}
              {it.fetched_on && <span style={{ color: "var(--muted)" }}>（{it.fetched_on} 取得）</span>}
            </p>

            {it.status === "approved" && it.kind !== "nochange" && (
              <p style={{ fontSize: 12.5, marginTop: 8 }}>
                <span className="tag ok">反映中</span>
              </p>
            )}

            <form action={decideKnowhowAction} style={{ marginTop: 14, display: "grid", gap: 10 }}>
              <input type="hidden" name="id" value={it.id} />
              <input type="hidden" name="back" value={status} />
              {it.form === "legal_rule" && it.rule ? (
                <div style={{ fontSize: 12.5, background: "var(--sunk)", border: "1px solid var(--line)", borderRadius: 6, padding: "10px 12px", lineHeight: 1.8 }}>
                  <b>法令チェックの辞書に追加されるルール</b>
                  <div style={{ marginTop: 4 }}>
                    検出する表現：<code>{it.rule.pattern}</code>
                    <br />
                    理由：{it.rule.reason}（{it.rule.law}）
                    <br />
                    言い換え：{it.rule.suggestion}
                  </div>
                </div>
              ) : it.kind === "nochange" ? (
                <p style={{ fontSize: 12.5, color: "var(--muted)" }}>「変更なし」の案なので、承認してもルールには何も追加されません（判断の記録のみ）。</p>
              ) : (
                <label style={{ fontSize: 12.5, display: "grid", gap: 4 }}>
                  <b>反映される文（承認すると、{AREA[it.area] ?? it.area}のAIへの指示に追加されます。直せます・200文字まで）</b>
                  <textarea className="box" name="applied_text" rows={3} maxLength={200} defaultValue={it.applied_text} />
                </label>
              )}
              <textarea className="box" name="note" rows={2} placeholder="メモ（任意）" defaultValue={it.decision_note} />
              {it.risk === "legal" && it.status !== "approved" && (
                <label style={{ fontSize: 13, display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <input type="checkbox" name="confirmed" style={{ marginTop: 4 }} />
                  <span>出典の原文で内容を確認しました（承認するときだけ必要）</span>
                </label>
              )}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {it.status !== "approved" && (
                  <button className="btn sm" name="decision" value="approve" type="submit">承認</button>
                )}
                {it.status !== "held" && (
                  <button className="btn sm ghost" name="decision" value="hold" type="submit">保留</button>
                )}
                {it.status !== "rejected" && (
                  <button className="btn sm ghost" name="decision" value="reject" type="submit">却下</button>
                )}
                {it.status !== "pending" && (
                  <button className="btn sm ghost" name="decision" value="reset" type="submit">判断待ちに戻す</button>
                )}
              </div>
            </form>
          </section>
        ))}
      </div>
    </Shell>
  );
}
