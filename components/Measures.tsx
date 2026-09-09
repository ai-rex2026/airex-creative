"use client";

import { useState, useTransition } from "react";
import { makeRunbook, regenerateMeasures, selectKpis, toggleMeasure } from "@/app/actions";
import type { KpiTree } from "@/lib/kpi";
import type { Measure } from "@/lib/measures";
import { Spinner } from "./Loading";
import { CasePhotoFrame } from "./CasePhotoFrame";
import { isCasePhoto } from "@/lib/case-photo";

/**
 * KPIを決めてから施策を並べる画面。
 *
 * 施策は優先順位で並べ替えない。担当も工数も違うものを一列にすると動けなくなる。
 * 代わりに効果の見込みを添えて、判断は見る人に委ねる。
 */

type Picked = { id: string; name: string; custom?: boolean };

export function Measures({
  id,
  kpi,
  measures,
  selected,
  done,
  log,
  hygiene,
}: {
  id: string;
  kpi: KpiTree;
  measures: Measure[];
  selected: Picked[];
  done: string[];
  log: { title: string; at: string }[];
  hygiene: { label: string; how: string }[];
}) {
  const [picked, setPicked] = useState<Picked[]>(
    selected.length ? selected : kpi.candidates.filter((c) => c.trackable !== "追えません").map((c) => ({ id: c.id, name: c.name }))
  );
  const [list, setList] = useState<Measure[]>(measures);
  const [doneIds, setDoneIds] = useState<string[]>(done);
  const [logs, setLogs] = useState(log);
  const [open, setOpen] = useState<string | null>(null);
  const [custom, setCustom] = useState("");
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

  // 保存できなかったら画面を戻す。黙って握りつぶすと、押した本人は
  // 保存されたと思ったまま次の画面に進んでしまう
  function toggleKpi(c: Picked) {
    const prev = picked;
    const next = picked.some((p) => p.id === c.id) ? picked.filter((p) => p.id !== c.id) : [...picked, c];
    setPicked(next);
    setErr(null);
    void selectKpis(id, next).catch((e) => {
      setPicked(prev);
      setErr(e instanceof Error ? e.message : "KPIを保存できませんでした");
    });
  }

  function addCustom() {
    const name = custom.trim();
    if (!name || busy) return;
    setErr(null);
    const kid = `c${Date.now()}`;
    const next = [...picked, { id: kid, name, custom: true }];
    setPicked(next);
    setCustom("");
    start(async () => {
      try {
        await selectKpis(id, next);
        // KPI を足したら全体に跳ね返す。継ぎ足すと、既存の施策が新しい KPI を
        // 踏まえていない状態のまま残る
        const res = await regenerateMeasures(id);
        setList(res.items);
        setDoneIds(res.done);
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

  const shown = list.filter((m) => picked.length === 0 || m.kpis?.some((k) => picked.some((p) => p.id === k)));
  const kpiName = (k: string) => picked.find((p) => p.id === k)?.name ?? kpi.candidates.find((c) => c.id === k)?.name ?? k;

  return (
    <>
      <div className="sec-head">
        <span className="ic">◎</span>
        <div>
          <h2 id="sec-kpi">追うKPI</h2>
          <div className="sub">{kpi.model}</div>
        </div>
        <span className="rule" />
      </div>

      {kpi.branches?.length > 0 && (
        <div className="tree measure">
          {kpi.branches.map((b, i) => (
            <div className="b" key={i}>
              <span className="nd">{b.node}</span>
              <span className="fm">{b.formula}</span>
              {b.note && <span className="nt">{b.note}</span>}
            </div>
          ))}
        </div>
      )}

      <div className="kpis-pick measure">
        {kpi.candidates.map((c) => {
          const on = picked.some((p) => p.id === c.id);
          const dead = c.trackable === "追えません";
          return (
            <button key={c.id} className={`k${on ? " on" : ""}${dead ? " dead" : ""}`} onClick={() => toggleKpi({ id: c.id, name: c.name })}>
              <span className="tp">
                <b>{c.name}</b>
                <i className={dead ? "ng" : c.trackable === "実測できます" ? "ok" : "warn"}>{c.trackable}</i>
              </span>
              <small>{c.why}</small>
              <small className="how">{c.how}</small>
            </button>
          );
        })}
        {picked.filter((p) => p.custom).map((p) => (
          <button key={p.id} className="k on custom" onClick={() => toggleKpi(p)}>
            <span className="tp"><b>{p.name}</b><i className="warn">自分で追加</i></span>
            <small>このKPIに効く施策を下に足しています</small>
          </button>
        ))}
      </div>

      <div className="kpi-add measure">
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="ほかに追いたい指標があれば入力（例：リピート率）"
          onKeyDown={(e) => { if (e.key === "Enter") addCustom(); }}
        />
        <button className="btn" onClick={addCustom} disabled={busy || !custom.trim()}>
          {busy ? <Spinner label="施策を作り直しています" /> : "追加して施策を作り直す"}
        </button>
      </div>
      {err && <div className="alert" style={{ marginTop: 10 }}>{err}</div>}

      <div className="sec-head">
        <span className="ic">▸</span>
        <div>
          <h2 id="sec-measures">施策</h2>
          <div className="sub">選んだKPIに効くものだけを出しています。順位はつけていません</div>
        </div>
        <span className="rule" />
      </div>

      <div className="mlist measure">
        {shown.length === 0 && <div className="note"><i className="i">i</i><span>KPIを選ぶと、そのKPIに効く施策が出ます。</span></div>}
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
                {m.kpis?.map((k) => <span className="chip" key={k}>{kpiName(k)}</span>)}
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
