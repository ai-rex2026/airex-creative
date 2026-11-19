import Link from "next/link";
import { notFound } from "next/navigation";
import { Shell } from "@/components/Shell";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTier } from "@/lib/tier";
import { decideKnowhowAction, markKnowhowImplAction } from "@/app/knowhow-actions";
import { MAX_NOTES, MAX_NOTE_CHARS, pickNotes } from "@/lib/knowhow";
import { manualStatus, type ManualRow } from "@/lib/knowhow-manual";

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
  created_at: string;
  form: string;
  applied_text: string;
  impl_status?: string;
  impl_note?: string;
  rule: { pattern?: string; reason?: string; law?: string; suggestion?: string; scopes?: string[]; industries?: string[] } | null;
};

const AREA: Record<string, string> = { meo: "MEO", seo: "SEO", aio: "AIO", lpo: "LPO", image: "画像生成", legal: "法令", ads: "広告" };
const KIND: Record<string, string> = { add: "追加", change: "変更", nochange: "変更なし" };
const EVIDENCE: Record<string, string> = { official: "公式の根拠", vendor: "事業者・解説の報告", opinion: "意見・分析" };
const DONE: Record<string, string> = { approve: "承認しました。反映中です", hold: "保留にしました", reject: "却下しました", reset: "判断待ちに戻しました", impl_done: "実装済みにしました", impl_todo: "実装待ちに戻しました" };
const FORM: Record<string, string> = { note: "AIへの指示", legal_rule: "法令の辞書", code: "コード" };
const STATUS_LABEL: Record<string, string> = { approved: "承認", held: "保留", rejected: "却下" };
/** 日本時間で「2026/11/18 19:59」の形に */
const fmt = (iso: string) =>
  new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
const TABS: [string, string][] = [["pending", "判断待ち"], ["approved", "承認"], ["held", "保留"], ["rejected", "却下"], ["impl", "実装待ち"]];

/** ノウハウ更新案の受信箱。管理者だけ（ほかの人には存在も見せない）。スマホで1件ずつ 承認／保留／却下 を選ぶ */
export default async function KnowhowInbox({ searchParams }: { searchParams: Promise<{ s?: string; a?: string; by?: string; from?: string; to?: string; err?: string; done?: string }> }) {
  const { tier } = await getTier();
  if (tier !== "admin") notFound();
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.s) ? (sp.s as string) : "pending";
  // 「実装待ち」は、承認済みのコードの案のうち、まだ実装していないもの
  const status = tab === "impl" ? "approved" : tab;
  // 絞り込み：カテゴリ（領域）と日付（追加日／判断日）。日付は日本時間の日付で指定する
  const area = sp.a && sp.a in AREA ? sp.a : "";
  const by = sp.by === "decided" ? "decided" : "created";
  const dateOk = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");
  const from = dateOk(sp.from);
  const to = dateOk(sp.to);
  const dateCol = by === "decided" ? "decided_at" : "created_at";
  // Supabase のクエリ型は深く、ジェネリクスで包むと型の展開が終わらないので、ここだけ any で受ける
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filtered = (q: any) => {
    let r = q;
    if (area) r = r.eq("area", area);
    if (from) r = r.gte(dateCol, `${from}T00:00:00+09:00`);
    if (to) r = r.lte(dateCol, `${to}T23:59:59.999+09:00`);
    return r;
  };
  const qs = (over: Record<string, string>) => {
    const p = new URLSearchParams();
    const cur: Record<string, string> = { s: tab, a: area, by: by === "decided" ? "decided" : "", from, to, ...over };
    for (const [k, v] of Object.entries(cur)) if (v) p.set(k, v);
    return p.toString();
  };
  const back = qs({});

  const sb = createAdminClient();
  const { data: mrows } = await sb.from("knowhow_manual_checks").select("key,title,interval_days,last_checked_at").limit(100);
  const overdue = ((mrows ?? []) as Pick<ManualRow, "key" | "title" | "interval_days" | "last_checked_at">[])
    .map((m) => ({ m, st: manualStatus(m) }))
    .filter((x) => x.st.overdue);
  const [{ data }, counts]: [{ data: unknown }, { data: { status: string; form: string; impl_status: string }[] | null }] = await Promise.all([
    filtered((tab === "impl" ? sb.from("knowhow_items").select("*").eq("form", "code").eq("impl_status", "todo") : sb.from("knowhow_items").select("*")).eq("status", status)).order(by === "decided" ? "decided_at" : "created_at", { ascending: false }).limit(100),
    filtered(sb.from("knowhow_items").select("status, form, impl_status")).limit(2000),
  ]);
  const items = (data ?? []) as Item[];
  // AI の指示の「枠」の使用状況。実際の反映（knowhowBlock）と同じ選び方で数える。SEO と AIO は記事づくりで同じ枠を共有する
  const { data: noteRows } = await sb
    .from("knowhow_items")
    .select("id, area, applied_text")
    .eq("status", "approved")
    .eq("form", "note")
    .neq("kind", "nochange")
    .neq("applied_text", "")
    .order("decided_at", { ascending: true })
    .limit(2000);
  const POOLS: [string, string[]][] = [["MEO", ["meo"]], ["SEO・AIO（記事づくりで共有）", ["seo", "aio"]], ["LPO", ["lpo"]], ["画像生成", ["image"]]];
  const slot = POOLS.map(([label, areas]) => {
    const r = pickNotes((noteRows ?? []).filter((x) => areas.includes(String(x.area))));
    return { label, count: r.used.length, total: r.used.length + r.skipped.length, chars: r.chars, skipped: r.skipped.map((x) => String(x.id)), areas };
  });
  const notInSlot = new Set(slot.flatMap((s) => s.skipped));
  const n = new Map<string, number>();
  for (const r of counts.data ?? []) {
    n.set(String(r.status), (n.get(String(r.status)) ?? 0) + 1);
    if (r.status === "approved" && r.form === "code" && r.impl_status === "todo") n.set("impl", (n.get("impl") ?? 0) + 1);
  }
  const filterOn = !!(area || from || to);

  return (
    <Shell active="admin">
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <h2 style={{ fontSize: 20 }}>ノウハウ更新案</h2>
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 6, lineHeight: 1.9 }}>
          調査で見つけた更新案を、1件ずつ判断します。承認すると、領域ごとのAIへの指示と法令チェックに反映されます（「反映される文」が、そのまま追加されます）。「判断待ちに戻す」か「却下」にすると、すぐ外れます。
        </p>
        <p style={{ fontSize: 12.5, marginTop: 6 }}>
          <Link href="/admin/knowhow/sources" style={{ textDecoration: "underline" }}>確認している公式ページ（週1回・変わったときだけ案を作成）</Link>
        </p>
        {overdue.length > 0 && (
          <p style={{ marginTop: 10, fontSize: 13, color: "var(--ng)", lineHeight: 1.8 }}>
            点検が必要なページが {overdue.length} 件あります：{overdue.map((x) => `${x.m.title}（${x.st.label}）`).join("、")}。
            <Link href="/admin/knowhow/sources" style={{ textDecoration: "underline", marginLeft: 6 }}>点検する</Link>
          </p>
        )}
        {sp.err && <p style={{ marginTop: 12, fontSize: 13, color: "var(--ng)" }}>{sp.err}</p>}
        {sp.done && DONE[sp.done] && (
          <p className="tag ok" style={{ marginTop: 12 }}>
            {DONE[sp.done]}
          </p>
        )}

        <div style={{ fontSize: 12.5, marginTop: 14, background: "var(--sunk)", border: "1px solid var(--line)", borderRadius: 6, padding: "10px 12px", lineHeight: 1.9 }}>
          <b>AIへの指示の枠の使用状況</b>（1回の呼び出しに足せるのは {MAX_NOTES} 件・{MAX_NOTE_CHARS} 文字まで。承認が古い順に入ります）
          {slot.map((s) => (
            <div key={s.label}>
              {s.label}：{s.count}／{MAX_NOTES} 件・{s.chars}／{MAX_NOTE_CHARS} 文字
              {s.skipped.length > 0 && <span style={{ color: "var(--ng)" }}>　枠に入っていない承認済み {s.skipped.length} 件</span>}
            </div>
          ))}
          <div style={{ color: "var(--muted)" }}>法令の辞書・コードの案は、この枠に数えません。</div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 18 }}>
          {TABS.map(([k, label]) => (
            <Link key={k} href={`/admin/knowhow?${qs({ s: k })}`} className={`tag${tab === k ? " on" : ""}`} style={{ textDecoration: "none" }}>
              {label} {n.get(k) ?? 0}
            </Link>
          ))}
        </div>

        <form method="get" style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", fontSize: 12.5 }}>
          <input type="hidden" name="s" value={tab} />
          <label style={{ display: "grid", gap: 3 }}>
            カテゴリ
            <select className="box" name="a" defaultValue={area} style={{ padding: "6px 8px" }}>
              <option value="">すべて</option>
              {Object.entries(AREA).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </label>
          <label style={{ display: "grid", gap: 3 }}>
            日付の基準
            <select className="box" name="by" defaultValue={by} style={{ padding: "6px 8px" }}>
              <option value="created">追加日</option>
              <option value="decided">判断日</option>
            </select>
          </label>
          <label style={{ display: "grid", gap: 3 }}>
            から
            <input className="box" type="date" name="from" defaultValue={from} style={{ padding: "5px 8px" }} />
          </label>
          <label style={{ display: "grid", gap: 3 }}>
            まで
            <input className="box" type="date" name="to" defaultValue={to} style={{ padding: "5px 8px" }} />
          </label>
          <button className="btn sm" type="submit">絞り込む</button>
          {filterOn && (
            <Link className="btn sm ghost" href={`/admin/knowhow?s=${tab}`}>解除</Link>
          )}
        </form>
        <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 8 }}>
          {filterOn ? "絞り込み中：" : ""}該当 {items.length}件（新しい順）
        </p>

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
              <span className="tag score">実装の形：{FORM[it.form] ?? it.form}</span>
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

            <p style={{ fontSize: 12, marginTop: 6, color: "var(--muted)" }}>
              追加：{fmt(it.created_at)}
              {it.decided_at && `　／　${STATUS_LABEL[it.status] ?? "判断"}：${fmt(it.decided_at)}`}
            </p>
            {it.status === "approved" && it.kind !== "nochange" && it.form !== "code" && (
              <p style={{ fontSize: 12.5, marginTop: 8 }}>
                {notInSlot.has(it.id) ? <span className="tag ng">枠に入っていません（上限を超えているため、AIの指示に足されていません）</span> : <span className="tag ok">反映中</span>}
              </p>
            )}
            {it.status === "approved" && it.form === "code" && (
              <form action={markKnowhowImplAction} style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 12.5 }}>
                <input type="hidden" name="id" value={it.id} />
                {it.impl_status === "done" ? (
                  <>
                    <span className="tag ok">実装済み</span>
                    <button className="btn sm ghost" name="to" value="todo" type="submit">実装待ちに戻す</button>
                  </>
                ) : (
                  <>
                    <span className="tag warn">実装待ち（承認しただけでは何も変わりません）</span>
                    <button className="btn sm" name="to" value="done" type="submit">実装済みにする</button>
                  </>
                )}
              </form>
            )}

            <form action={decideKnowhowAction} style={{ marginTop: 14, display: "grid", gap: 10 }}>
              <input type="hidden" name="id" value={it.id} />
              <input type="hidden" name="back" value={back} />
              {it.form === "legal_rule" && it.rule ? (
                <div style={{ fontSize: 12.5, background: "var(--sunk)", border: "1px solid var(--line)", borderRadius: 6, padding: "10px 12px", lineHeight: 1.8 }}>
                  <b>法令チェックの辞書に追加されるルール</b>
                  <div style={{ marginTop: 4 }}>
                    検出する表現：<code>{it.rule.pattern}</code>
                    <br />
                    理由：{it.rule.reason}（{it.rule.law}）
                    <br />
                    言い換え：{it.rule.suggestion}
                    <br />
                    適用する用途：{it.rule.scopes?.length ? it.rule.scopes.join("・") : "すべて"}
                    {it.rule.industries?.length ? `／業種：${it.rule.industries.join("・")}` : ""}
                  </div>
                </div>
              ) : it.form === "code" ? (
                <label style={{ fontSize: 12.5, display: "grid", gap: 4 }}>
                  <b>コードで実装する案です。承認すると「実装待ち」に入ります（AIへの指示・辞書には何も足されません）。何をどう実装するかをメモできます</b>
                  <textarea className="box" name="impl_note" rows={3} maxLength={1000} defaultValue={it.impl_note ?? ""} />
                </label>
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
