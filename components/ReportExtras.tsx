"use client";

import { useEffect, useState } from "react";
import { addMissingSections, missingSections, rebuildAdPlan } from "@/app/report-extra-actions";
import type { SnsCampaign, SnsChannelPlan } from "@/lib/sns-plan";
import type { ChannelStructure } from "@/lib/ad-ops";
import type { GuardHit } from "@/lib/types";

/**
 * AI-REX 本体から取り込んだ項目の表示（SNSオーガニック運用・SNSキャンペーン企画・広告の構成表）と、
 * 以前に作ったレポートへ後から項目を足すための導線。
 */

function Flags({ hits }: { hits: GuardHit[] }) {
  if (!hits?.length) return null;
  return (
    <div className="note warn" style={{ marginTop: 10 }}>
      <i className="i">!</i>
      <span>
        表現チェック：
        {hits.map((h, i) => (
          <span key={i} style={{ display: "block" }}>
            「{h.text}」— {h.reason}（{h.law}）。{h.suggestion}
          </span>
        ))}
      </span>
    </div>
  );
}

/** 広告以外の施策の、SNS 1媒体分の運用プラン */
export function SnsChannelBlock({ c }: { c: SnsChannelPlan }) {
  return (
    <div className="snsplan">
      <div className="top">
        <b>{c.platform}の運用プラン</b>
        <span className="tag">{c.status === "運用中" ? "運用中のアカウントを伸ばす" : "これから始める"}</span>
        {c.frequency && <span className="kpi">投稿頻度：{c.frequency}</span>}
      </div>
      <div className="grid">
        {c.goals.length > 0 && (
          <div>
            <small>運用ゴール</small>
            <ul>{c.goals.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </div>
        )}
        {c.themes.length > 0 && (
          <div>
            <small>投稿テーマ</small>
            <ul>{c.themes.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </div>
        )}
        {c.engagement.length > 0 && (
          <div>
            <small>反応を増やす施策</small>
            <ul>{c.engagement.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </div>
        )}
        {c.hashtags && (
          <div>
            <small>ハッシュタグ戦略</small>
            <p>{c.hashtags}</p>
          </div>
        )}
      </div>
      {c.kpi && <p className="kpiline">見る数字：{c.kpi}</p>}
      <Flags hits={c.flags} />
    </div>
  );
}

/** SNSキャンペーン企画 */
export function SnsCampaignCard({ c }: { c: SnsCampaign }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="tactic">
      <div className="top">
        <b>SNSキャンペーン企画：{c.title}</b>
        {c.period && <span className="kpi">期間の目安：{c.period}</span>}
      </div>
      <p>{c.concept}</p>
      {c.platforms.length > 0 && (
        <div className="chips" style={{ paddingTop: 6 }}>
          {c.platforms.map((p, i) => <span className="chip" key={i}>{p}</span>)}
        </div>
      )}
      {c.mechanics.length > 0 && (
        <>
          <p style={{ marginTop: 10, fontWeight: 600 }}>参加の仕組み</p>
          <ol style={{ paddingLeft: 20 }}>{c.mechanics.map((x, i) => <li key={i}>{x}</li>)}</ol>
        </>
      )}
      {c.cautions.length > 0 && (
        <div className="note" style={{ marginTop: 10 }}>
          <i className="i">i</i>
          <span>
            実施前に確認すること：
            {c.cautions.map((x, i) => <span key={i} style={{ display: "block" }}>・{x}</span>)}
          </span>
        </div>
      )}
      {c.imagePrompt && (
        <details className="flags" style={{ marginTop: 10 }}>
          <summary>キャンペーン画像の生成AIプロンプト（英語・文字なし）</summary>
          <p style={{ fontFamily: "ui-monospace, monospace", fontSize: 12.5, whiteSpace: "pre-wrap" }}>{c.imagePrompt}</p>
          <button
            className="linkbtn"
            onClick={() => {
              void navigator.clipboard?.writeText(c.imagePrompt).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? "コピーしました" : "コピーする"}
          </button>
          <small style={{ display: "block", marginTop: 4 }}>
            日本語の文字は画像生成で崩れるため、画像には文字を入れない指示にしています。文字は後から載せてください。
          </small>
        </details>
      )}
      <Flags hits={c.flags} />
    </div>
  );
}

/** 広告運用設計の冒頭に置く、媒体→キャンペーン→広告グループの構成表 */
export function AdStructureTable({ plan }: { plan: ChannelStructure[] }) {
  if (!plan.length) return null;
  return (
    <div className="kwwrap measure" style={{ marginTop: 14 }}>
      <table className="kw" style={{ minWidth: 640 }}>
        <thead>
          <tr>
            <th>媒体</th>
            <th>キャンペーン</th>
            <th>広告グループ</th>
            <th>役割</th>
          </tr>
        </thead>
        <tbody>
          {plan.flatMap((s) =>
            s.campaigns.flatMap((c, ci) =>
              c.groups.map((g, gi) => (
                <tr key={`${s.channel}-${ci}-${gi}`}>
                  <td>{ci === 0 && gi === 0 ? <b>{s.channel}</b> : ""}</td>
                  <td>{gi === 0 ? <><b>{c.name}</b><br /><small style={{ color: "var(--muted)" }}>{c.purpose}</small></> : ""}</td>
                  <td>{g.name}</td>
                  <td className="act">{g.purpose}</td>
                </tr>
              ))
            )
          )}
        </tbody>
      </table>
    </div>
  );
}

/** 旧形式の広告運用設計を、いまの形式で作り直す */
export function RebuildAdPlanNote({ id }: { id: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="note" style={{ marginTop: 12 }}>
      <i className="i">i</i>
      <span>
        この広告運用設計は以前の形式です。広告手法一覧のすべての媒体（必要に応じて P-MAX を含む）について、
        キャンペーン・広告グループの構成から作り直せます。
        <button
          className="linkbtn"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setErr(null);
            rebuildAdPlan(id)
              .then(() => {
                window.location.href = `/analysis/${id}/waiting`;
              })
              .catch((e: Error) => {
                setErr(e.message);
                setBusy(false);
              });
          }}
        >
          {busy ? "作り直しています…" : "いまの形式で作り直す"}
        </button>
        <small>（広告手法一覧と広告運用設計を作り直すため、5〜10分かかります）</small>
        {err && <small style={{ display: "block", color: "var(--ng)" }}>{err}</small>}
      </span>
    </div>
  );
}

/** 以前に作ったレポートに、後から増えた項目を足す */
export function MissingSectionsBanner({ id }: { id: string }) {
  const [missing, setMissing] = useState<string[]>([]);
  const [state, setState] = useState<"idle" | "working" | "error">("idle");
  const [started, setStarted] = useState(0);

  useEffect(() => {
    missingSections(id).then(setMissing).catch(() => setMissing([]));
  }, [id]);

  // 作成中は20秒おきに確認し、揃ったら画面を読み直す
  useEffect(() => {
    if (state !== "working") return;
    const t = setInterval(() => {
      missingSections(id)
        .then((m) => {
          if (m.length < missing.length) window.location.reload();
          else if (Date.now() - started > 240_000) setState("error");
        })
        .catch(() => undefined);
    }, 20000);
    return () => clearInterval(t);
  }, [id, state, missing.length, started]);

  if (missing.length === 0) return null;
  return (
    <div className="note" style={{ margin: "14px 0" }}>
      <i className="i">i</i>
      <span>
        このレポートには、あとから追加された項目（{missing.join("・")}）がまだありません。
        <button
          className="linkbtn"
          disabled={state === "working"}
          onClick={() => {
            setState("working");
            setStarted(Date.now());
            addMissingSections(id).catch(() => setState("error"));
          }}
        >
          {state === "working" ? "作成しています（1〜2分）…" : "追加する"}
        </button>
        {state === "error" && <small style={{ display: "block", color: "var(--ng)" }}>一部またはすべての項目を作れませんでした（AIの利用上限・混雑など）。時間をおいてもう一度お試しください。</small>}
      </span>
    </div>
  );
}
