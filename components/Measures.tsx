"use client";

import { useState, useTransition } from "react";
import { makeRunbook, regenerateSummaryTab, toggleMeasure } from "@/app/actions";
import type { Measure } from "@/lib/measures";
import type { CategoryEvaluation } from "@/lib/summary-tab";
import { sortMeasuresByPriority } from "@/lib/summary-tab";
import { Spinner } from "./Loading";
import { CasePhotoFrame } from "./CasePhotoFrame";
import { isCasePhoto } from "@/lib/case-photo";

/**
 * サマリータブ（旧「施策」タブ）。
 *
 * 2026-10-04: 「KPIを絞って、絞った分だけ施策を出す」という考え方から、
 * 「全データを評価してから、弱い所・測れない所に効く施策を優先して見せる」
 * という考え方へ転換した。KPI選択UIはここから無くし、入力タブへ表示専用で
 * 移した（components/Inputs.tsx）。
 *
 * 施策同士は優先順位で並べ替えないという元の方針は変わらないが、ここに限って
 * 「優先度の高い施策」という並びだけは、カテゴリスコアの低さ（一次）＋
 * Measure.impact/effort（二次）で並べる（決定済み。sortMeasuresByPriority）。
 */

const SCORE_LABEL: Record<string, string> = { 強: "強", 標準: "標準", 弱: "弱" };

function CategoryCard({ ev }: { ev: CategoryEvaluation }) {
  const tone = ev.score === null ? "na" : ev.score === "強" ? "ok" : ev.score === "標準" ? "warn" : "ng";
  return (
    <a className={`cat-card ${tone}`} href={`#${ev.sectionAnchor}`}>
      <b>{ev.category}</b>
      <span className="sc">{ev.score === null ? "分析不可" : SCORE_LABEL[ev.score]}</span>
      <small>{ev.basis}</small>
    </a>
  );
}

export function Measures({
  id,
  measures,
  categoryEvaluations,
  done,
  log,
  hygiene,
}: {
  id: string;
  measures: Measure[];
  categoryEvaluations: CategoryEvaluation[] | null;
  done: string[];
  log: { title: string; at: string }[];
  hygiene: { label: string; how: string }[];
}) {
  const [list, setList] = useState<Measure[]>(measures);
  const [evaluations, setEvaluations] = useState<CategoryEvaluation[] | null>(categoryEvaluations);
  const [doneIds, setDoneIds] = useState<string[]>(done);
  const [logs, setLogs] = useState(log);
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [rbBusy, setRbBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  /** 実行プロンプトは使うときに作る。全件先に作ると費用が積み上がる */
  async function buildRunbook(mid: string) {
    setRbBusy(mid);
    setErr(null);
    try {
      const rb = await makeRunbook(id, mid);
      setList((ms) => ms.map((m) => (m.id === mid ? { ...m, runbook: rb } : m)));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRbBusy(null);
    }
  }

  async function copy(mid: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(mid);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      setErr("コピーできませんでした。手動で選択してください");
    }
  }

  /** サマリー（カテゴリ評価＋施策）を作り直す。数十秒〜1〜2分かかる */
  function rebuild() {
    if (busy) return;
    setErr(null);
    start(async () => {
      try {
        const res = await regenerateSummaryTab(id);
        setList(res.items);
        setEvaluations(res.evaluations);
        setDoneIds(res.done);
        setOpen(null);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    });
  }

  function markDone(m: Measure, v: boolean) {
    const prev = doneIds;
    const prevLogs = logs;
    setDoneIds(v ? [...new Set([...prev, m.id])] : prev.filter((x) => x !== m.id));
    // 記録は押した場に出す。リロードするまで出ないと、押せたのか分からない
    if (v) setLogs([{ title: m.title, at: new Date().toISOString() }, ...logs.filter((x) => x.title !== m.title)]);
    setErr(null);
    void toggleMeasure(id, m.id, v).catch((e) => {
      setDoneIds(prev);
      setLogs(prevLogs);
      setErr(e instanceof Error ? e.message : "記録を保存できませんでした");
    });
  }

  // 旧形式の分析（category_evaluationsがまだ無い）はカード無しで施策だけ表示する。
  // 再計算・移行バッチは行わない方針（2026-10-04決定）
  const shown = evaluations ? sortMeasuresByPriority(list, evaluations) : list;

  return (
    <>
      {evaluations && evaluations.length > 0 && (
        <>
          <div className="sec-head">
            <span className="ic">◉</span>
            <div>
              <h2 id="sec-category-eval">カテゴリ別評価</h2>
              <div className="sub">実測できたものだけを評価しています。クリックで詳細に移動します</div>
            </div>
            <span className="rule" />
          </div>
          <div className="cat-grid measure">
            {evaluations.map((ev) => <CategoryCard ev={ev} key={ev.category} />)}
          </div>
        </>
      )}

      {!evaluations && (
        <div className="note">
          <i className="i">i</i>
          <span>この分析はカテゴリ別評価の導入前に作られたため、カードは表示できません。下の施策は引き続き確認できます。</span>
        </div>
      )}

      <div className="sec-head">
        <span className="ic">▸</span>
        <div>
          <h2 id="sec-measures">優先度の高い施策</h2>
          <div className="sub">スコアが低いカテゴリ・分析不可のカテゴリに効くものを優先して並べています</div>
        </div>
        <span className="rule" />
        <button className="redo" onClick={rebuild} disabled={busy}>
          {busy ? <Spinner label="作り直しています" /> : "施策を作り直す"}
        </button>
      </div>

      {busy && (
        <div className="note">
          <i className="i">…</i>
          <span>
            いま作り直しています。1〜2分かかります。
            この画面を開いたままにしてください。終わると下の一覧が入れ替わります。
          </span>
        </div>
      )}
      {err && <div className="alert" style={{ marginTop: 10 }}>{err}</div>}

      <div className="mlist measure">
        {shown.length === 0 && <div className="note"><i className="i">i</i><span>まだ施策がありません。</span></div>}
        {shown.map((m) => {
          const isDone = doneIds.includes(m.id);
          const isOpen = open === m.id;
          return (
            <div className={`m${isDone ? " done" : ""}`} key={m.id}>
              <button className="hd" onClick={() => setOpen(isOpen ? null : m.id)} aria-expanded={isOpen}>
                <span className={`imp ${m.impact === "大" ? "hi" : m.impact === "中" ? "mid" : "lo"}`}>効果 {m.impact}</span>
                <span className="tt">{m.title}</span>
                <span className="ef">{m.effort}</span>
                <span className="ar">{isOpen ? "閉じる" : "手順を見る"}</span>
              </button>
              <div className="kk">
                {m.node && <span className="chip node">{m.node}</span>}
                {m.flags && m.flags.length > 0 && <span className="chip law">法令の指摘 {m.flags.length}</span>}
              </div>
              {isOpen && (
                <div className="bd">
                  <p className="why"><b>この見込みの根拠</b>{m.impactWhy}</p>
                  <div className="who"><b>担当</b>{m.owner}</div>
                  <ol>{m.steps?.map((s, i) => <li key={i}>{s}</li>)}</ol>
                  <div className="chk"><b>完了の判断</b>{m.done}</div>
                  {isCasePhoto(`${m.title} ${m.impactWhy} ${(m.steps ?? []).join(" ")}`) && <CasePhotoFrame />}
                  {m.flags?.map((f, i) => (
                    <div className="mlaw" key={i}>
                      <b>{f.law}「{f.text}」</b>
                      <span>{f.reason}</span>
                      <span className="fix">言い換え：{f.suggestion}</span>
                    </div>
                  ))}
                  {m.runbook ? (
                    <div className="rb">
                      <div className="rh">
                        <b>AIに貼って実行する</b>
                        <span className="kd">{m.runbook.kind}</span>
                        <button className="cp" onClick={() => copy(m.id, m.runbook!.prompt)}>
                          {copied === m.id ? "コピーしました" : "コピー"}
                        </button>
                      </div>
                      <pre>{m.runbook.prompt}</pre>
                      {m.runbook.requires?.length > 0 && (
                        <div className="req">
                          <b>必要なもの</b>
                          <span>{m.runbook.requires.join(" / ")}</span>
                        </div>
                      )}
                      {m.runbook.limits && (
                        <div className="lim">
                          <b>貼っただけでは終わらないこと</b>
                          <span>{m.runbook.limits}</span>
                        </div>
                      )}
                      {m.runbook.flags && m.runbook.flags.length > 0 && (
                        <div className="lim law">
                          <b>プロンプトに含まれる注意語</b>
                          <span>
                            {m.runbook.flags.map((f) => `「${f.text}」`).join("・")}
                            。貼り先で生成された文言は、こちらの法令チェックを通っていません。
                          </span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <button className="rbmake" disabled={rbBusy === m.id} onClick={() => buildRunbook(m.id)}>
                      {rbBusy === m.id ? <Spinner label="実行プロンプトを作っています" /> : "＋ AIに貼る実行プロンプトを作る"}
                    </button>
                  )}

                  <button className={`mk${isDone ? " on" : ""}`} onClick={() => markDone(m, !isDone)}>
                    {isDone ? "済みを取り消す" : "やった"}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {logs.length > 0 && (
        <>
          <div className="sec-head">
            <span className="ic">✓</span>
            <div>
              <h2 id="sec-log">実施した施策の記録</h2>
              <div className="sub">施策を作り直しても、ここは消えません</div>
            </div>
            <span className="rule" />
          </div>
          <div className="rows measure">
            {logs.map((l, i) => (
              <div className="r" key={i}>
                <div style={{ flex: 1, minWidth: 0 }}><b style={{ fontWeight: 400 }}>{l.title}</b></div>
                <span className="tag">{new Date(l.at).toLocaleDateString("ja-JP")}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {hygiene.length > 0 && (
        <>
          <div className="sec-head">
            <span className="ic">✓</span>
            <div>
              <h2 id="sec-hygiene">ついでに直すもの</h2>
              <div className="sub">KPIには直結しませんが、放置する理由もない項目です</div>
            </div>
            <span className="rule" />
          </div>
          <div className="rows measure">
            {hygiene.map((h, i) => (
              <div className="r" key={i}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b style={{ fontWeight: 400 }}>{h.label}</b>
                  <small>{h.how}</small>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
