"use client";

import { useState, useTransition } from "react";
import { makeRunbook, regenerateSummaryTab, toggleMeasure } from "@/app/actions";
import type { Measure } from "@/lib/measures";
import type { CategoryEvaluation } from "@/lib/summary-tab";
import { categoryForMeasure, fromConfirmedTags, isUnverifiableTagMeasure, reconcileSources, sortMeasuresByPriority } from "@/lib/summary-tab";
import { Spinner } from "./Loading";
import { PlatformIcon, normalizePlatform } from "./PlatformIcons";
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

function CategoryCard({ ev, onNavigate }: { ev: CategoryEvaluation; onNavigate: (anchor: string) => void }) {
  const tone = ev.score === null ? "na" : ev.score === "強" ? "ok" : ev.score === "標準" ? "warn" : "ng";
  const body = (
    <>
      <b>{ev.category}</b>
      <span className="sc">{ev.score === null ? "分析不可" : SCORE_LABEL[ev.score]}</span>
      <small>{ev.basis}</small>
    </>
  );
  // 「広告」のように分析データタブに欄が無いものは、別のページ（設定など）へ移動する
  if (ev.sectionAnchor.startsWith("/")) {
    return <a className={`cat-card ${tone}`} href={ev.sectionAnchor}>{body}</a>;
  }
  return (
    <button type="button" className={`cat-card ${tone}`} onClick={() => onNavigate(ev.sectionAnchor)}>
      {body}
    </button>
  );
}

export function Measures({
  id,
  measures,
  categoryEvaluations,
  done,
  log,
  hygiene,
  onNavigate,
  trackingMissing = false,
  speedShown = true,
  isGuest = false,
}: {
  id: string;
  measures: Measure[];
  categoryEvaluations: CategoryEvaluation[] | null;
  done: string[];
  log: { title: string; at: string }[];
  hygiene: { label: string; how: string }[];
  /** カテゴリカードをクリックしたとき、分析データタブの該当セクションへ切り替えてスクロールする */
  onNavigate: (anchor: string) => void;
  /** サイトからGTM・広告タグのどちらも検出できなかったか（計測まわりの施策を出してよいか） */
  trackingMissing?: boolean;
  /** 分析データタブに「表示速度（実測）」の欄があるか（表示速度の施策のリンク先に使う） */
  speedShown?: boolean;
  /** 未登録（ゲスト）なら「施策を作り直す」は無料登録へ進める */
  isGuest?: boolean;
}) {
  // 計測タグ設置系の施策は設置済みか確認できないため出さない（古い分析に残っていても表示しない）
  // ただし分析データの「計測タグの導入状況」で未導入と確認できたタグを元にした施策は出す
  const visible = (m: Measure) => !isUnverifiableTagMeasure(m, trackingMissing || fromConfirmedTags(m));
  const [list, setList] = useState<Measure[]>(() => measures.filter(visible));
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
        setList(res.items.filter(visible));
        // 「広告」は保存していない（画面を開くたびに連携の有無から作る）ので、作り直した後も残す
        setEvaluations((prev) => {
          const ad = prev?.find((e) => e.category === "広告");
          if (!ad || !res.evaluations) return res.evaluations;
          const rest = res.evaluations.filter((e) => e.category !== "広告");
          const at = rest.findIndex((e) => e.category === "広告の準備");
          return [...rest.slice(0, at + 1), ad, ...rest.slice(at + 1)];
        });
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
  // 作成済みの施策も、題名の話題（LP・表示速度）に合わせてリンク先と「（もし未実施であれば）」を補正して出す
  const fixed = list.map((m) => reconcileSources(m, speedShown));
  const shown = evaluations ? sortMeasuresByPriority(fixed, evaluations) : fixed;
  // 効果「大」は常に見せ、「中・小」は件数が多いときだけ折り畳む
  const FOLD_AT = 8;
  const fold = shown.length > FOLD_AT;
  // 効果「大」が無いときは、先頭（並べ替え済み）の数件だけを見せて残りを折り畳む
  const bigCount = shown.filter((m) => m.impact === "大").length;
  const head = bigCount > 0 ? bigCount : 5;
  const top = fold ? shown.slice(0, head) : shown;
  const rest = fold ? shown.slice(head) : [];

  const renderItem = (m: Measure) => {
          const isDone = doneIds.includes(m.id);
          const isOpen = open === m.id;
          return (
            <div className={`m${isDone ? " done" : ""}`} key={m.id}>
              <button className="hd" onClick={() => setOpen(isOpen ? null : m.id)} aria-expanded={isOpen}>
                <span className={`imp ${m.impact === "大" ? "hi" : m.impact === "中" ? "mid" : "lo"}`}>効果 {m.impact}</span>
                <span className="tt">{normalizePlatform(m.title) !== "unknown" && <><PlatformIcon platform={m.title} size={14} />{" "}</>}{m.title}</span>
                <span className="ef">{m.effort}</span>
                <span className="ar">{isOpen ? "閉じる" : "手順を見る"}</span>
              </button>
              <div className="kk">
                {evaluations && (() => {
                  const cat = categoryForMeasure(m, evaluations);
                  return cat ? <span className="chip cat">{cat.category}</span> : null;
                })()}
                {m.flags && m.flags.length > 0 && <span className="chip law">法令の指摘 {m.flags.length}</span>}
                {/* 元にした分析データの章へのリンク。同じ章を元にした打ち手が複数あっても1つにまとめる */}
                {[...new Map((m.sources ?? []).map((x) => [x.anchor, x])).values()].map((x) => (
                  <button
                    type="button"
                    key={x.anchor}
                    className="chip src"
                    onClick={() => onNavigate(x.anchor)}
                    title="分析データタブの該当の章へ移動します"
                  >
                    分析データ：{x.chapter} →
                  </button>
                ))}
                {m.outside && <span className="chip outside">分析データ外の提案</span>}
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
                    {isDone ? "実施済みを取り消す" : "実施済み"}
                  </button>
                </div>
              )}
            </div>
          );
  };

  return (
    <>
      {evaluations && evaluations.length > 0 && (
        <>
          <div className="sec-head">
            <div>
              <h2 id="sec-category-eval">カテゴリ別評価</h2>
              <div className="sub">実測できたものだけを評価しています。クリックで詳細に移動します</div>
            </div>
            <span className="rule" />
          </div>
          <div className="cat-grid measure">
            {evaluations.map((ev) => <CategoryCard ev={ev} key={ev.category} onNavigate={onNavigate} />)}
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
        <div>
          <h2 id="sec-measures">優先度の高い施策</h2>
          <div className="sub">スコアが低いカテゴリ・分析不可のカテゴリに効くものを優先して並べています</div>
        </div>
        <span className="rule" />
        {isGuest ? (
          // 未登録ユーザーは作り直せない（AIを呼ぶため）。押したら無料登録へ進める
          <a className="redo" href="/login?mode=signup" title="施策の作り直しは無料の会員登録でご利用いただけます">
            施策を作り直す
          </a>
        ) : (
          <button className="redo" onClick={rebuild} disabled={busy}>
            {busy ? <Spinner label="作り直しています" /> : "施策を作り直す"}
          </button>
        )}
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
        {top.map((m) => renderItem(m))}
        {rest.length > 0 && (
          <details className="mfold">
            <summary>{bigCount > 0 ? "効果 中・小の施策" : "ほかの施策"}（{rest.length}件）を表示する</summary>
            {rest.map((m) => renderItem(m))}
          </details>
        )}
        {/* 2026-10-06: 「ついでに直すもの」も施策一覧の下に同じ形の折りたたみで出す（以前は独立した章だった） */}
        {hygiene.length > 0 && (
          <details className="mfold" id="sec-hygiene">
            <summary>ついでに直すもの（KPIには直結しないものの直した方がよい項目、{hygiene.length}件）を表示する</summary>
            {/* PDF（印刷）では summary を消して中身を開くので、見出しを代わりに出す */}
            <div className="hyg-h">ついでに直すもの（KPIには直結しないものの直した方がよい項目）</div>
            {hygiene.map((h, i) => (
              <div className="hyg" key={i}>
                <b>{h.label}</b>
                <small>{h.how}</small>
              </div>
            ))}
          </details>
        )}
      </div>

      {logs.length > 0 && (
        <>
          <div className="sec-head">
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

    </>
  );
}
