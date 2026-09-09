"use client";

import { useState, useTransition } from "react";
import { addInput, replanForBudget } from "@/app/actions";
import { BUDGETS, type BudgetBand } from "@/lib/types";
import type { SiteScan } from "@/lib/site-scan";
import { Spinner } from "./Loading";

/**
 * 分析の材料を集める画面。
 *
 * 出力（施策）と入力を分ける。サイトから自動で取れるものは取り、
 * 取れないもの（広告アカウント・別ドメインのLP・非公開のSNS）だけを足してもらう。
 */

const PLATFORMS = ["Instagram", "X（Twitter）", "Facebook", "TikTok", "YouTube", "LINE", "別ドメインのLP", "その他"];

export function Inputs({
  id,
  url,
  site,
  budget,
  margin,
  onBudget,
  onMargin,
  extra,
  hasGoogle,
}: {
  id: string;
  url: string | null;
  site: SiteScan | null;
  budget: BudgetBand | null;
  margin: number;
  onBudget: (b: BudgetBand | null) => void;
  onMargin: (m: number) => void;
  extra: { platform: string; url: string }[] | null;
  hasGoogle: boolean;
}) {
  const [list, setList] = useState(extra ?? []);
  const [platform, setPlatform] = useState(PLATFORMS[0]);
  const [value, setValue] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, start] = useTransition();

  function add() {
    const v = value.trim();
    if (!v || busy) return;
    setErr(null);
    start(async () => {
      try {
        const next = await addInput(id, platform, v);
        setList(next);
        setValue("");
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    });
  }

  return (
    <>
      <div className="sec-head">
        <span className="ic">↓</span>
        <div>
          <h2 id="sec-inputs">分析に使っている材料</h2>
          <div className="sub">サイトから取れたものと、足していただいたもの</div>
        </div>
        <span className="rule" />
      </div>

      <div className="rows measure">
        <div className="rh">サイトから自動で取得<small>入力は不要です</small></div>
        {url && (
          <div className="r">
            <div style={{ flex: 1, minWidth: 0 }}><b>分析対象</b><small>{url}</small></div>
            <span className="tag ok">取得済み</span>
          </div>
        )}
        {(site?.social ?? []).map((s, i) => (
          <div className="r" key={i}>
            <div style={{ flex: 1, minWidth: 0 }}><b>{s.platform}</b><small>{s.handle}</small></div>
            <span className="tag ok">検出</span>
          </div>
        ))}
        {(site?.conversions ?? []).map((c, i) => (
          <div className="r" key={`cv${i}`}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <b>申し込みの受け口：{c.kind}</b>
              <small>{c.detail}</small>
            </div>
            <span className={`tag${c.measurable ? " ok" : " warn"}`}>{c.measurable ? "計測できます" : "計測できません"}</span>
          </div>
        ))}
        <div className="r">
          <div style={{ flex: 1, minWidth: 0 }}>
            <b>Google 連携（Search Console / GA4）</b>
            <small>{hasGoogle ? "実測データをレポートに反映しています" : "連携すると、検索順位とアクセス数が推定ではなく実測になります"}</small>
          </div>
          {hasGoogle ? <span className="tag ok">連携済み</span> : <a className="tag" href="/settings">連携する</a>}
        </div>
      </div>

      <div className="sec-head">
        <span className="ic">＋</span>
        <div>
          <h2>足していただきたい材料</h2>
          <div className="sub">サイトから辿れないものは、こちらで拾えません</div>
        </div>
        <span className="rule" />
      </div>

      {list.length > 0 && (
        <div className="rows measure">
          {list.map((x, i) => (
            <div className="r" key={i}>
              <div style={{ flex: 1, minWidth: 0 }}><b>{x.platform}</b><small>{x.url}</small></div>
              <span className="tag">追加済み</span>
            </div>
          ))}
        </div>
      )}

      <div className="addin measure">
        <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
          {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="URL またはアカウント名"
          onKeyDown={(e) => { if (e.key === "Enter") add(); }}
        />
        <button className="btn" onClick={add} disabled={busy || !value.trim()}>
          {busy ? <Spinner label="追加中" /> : "追加"}
        </button>
      </div>
      {err && <div className="alert" style={{ marginTop: 10 }}>{err}</div>}
      <div className="note">
        <i className="i">i</i>
        <span>
          別ドメインで運用しているLPや、サイトからリンクしていないSNSは自動では見つけられません。
          <b style={{ fontWeight: 600 }}>すでに実施している施策を重複して提案しないため</b>にも、ここに足してください。
          足した材料は、次に施策を作り直したときから反映されます。
        </span>
      </div>

      <div className="sec-head">
        <span className="ic">¥</span>
        <div>
          <h2>予算と粗利率</h2>
          <div className="sub">入れると、媒体ごとの実額と損益分岐CPAが出ます</div>
        </div>
        <span className="rule" />
      </div>

      <div className="budget measure">
        <div className="bh">月間広告予算<span>任意</span></div>
        <div className="bb">
          {BUDGETS.map((b) => (
            <button key={b.id} className={budget === b.id ? "on" : ""} onClick={() => onBudget(budget === b.id ? null : b.id)}>
              {b.label}
            </button>
          ))}
        </div>
        <p>金額を1点で聞くと持っていない精度を偽ることになるので、幅で受けて幅で返します。</p>
      </div>

      <div className="budget measure" style={{ marginTop: 12 }}>
        <div className="bh">粗利率<span>損益分岐CPAの計算に使います</span></div>
        <div className="bb">
          {[0.3, 0.4, 0.5, 0.6, 0.7, 0.8].map((m) => (
            <button key={m} className={Math.abs(margin - m) < 0.001 ? "on" : ""} onClick={() => onMargin(m)}>
              {Math.round(m * 100)}%
            </button>
          ))}
        </div>
        <p>業種のめやすを初期値にしています。実際の粗利率に合わせて押し替えてください。</p>
      </div>

      {budget && (
        <div className="note">
          <i className="i">i</i>
          <span>
            予算を変えても、すでに作った媒体構成は自動では作り直しません。
            <button
              className="linkbtn"
              disabled={busy}
              onClick={() => { setErr(null); start(async () => { try { await replanForBudget(id, budget); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } }); }}
            >
              この予算で作り直す
            </button>
          </span>
        </div>
      )}
    </>
  );
}
