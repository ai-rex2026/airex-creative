"use client";

import { useState } from "react";
import Link from "next/link";
import type { Analysis } from "@/lib/analysis";
import type { ScoreLevel } from "@/lib/types";

const PILL: Record<string, [string, string]> = {
  queued: ["待機中", ""],
  running: ["処理中", "run"],
  done: ["完了", "ok"],
  failed: ["失敗", "ng"],
};

const WIDTH: Record<ScoreLevel, number> = { 強: 92, 標準: 58, 弱: 26 };

export function AnalysisList({ rows }: { rows: Analysis[] }) {
  const [status, setStatus] = useState<string>("all");
  const [rating, setRating] = useState<string>("all");

  const count = (s: string) => rows.filter((r) => r.status === s).length;
  const rated = (v: string) => rows.filter((r) => r.summary?.overall === v).length;

  const shown = rows.filter(
    (r) =>
      (status === "all" || r.status === status) &&
      (rating === "all" || r.summary?.overall === rating)
  );

  return (
    <>
      <div className="chipbar">
        <span style={{ fontSize: 12, color: "var(--faint)" }}>評価</span>
        {(["良好", "標準", "要改善"] as const).map((v) => (
          <button key={v} className={`f${rating === v ? " on" : ""}`}
            onClick={() => setRating(rating === v ? "all" : v)}>
            {v} {rated(v)}
          </button>
        ))}
        <span className="sep" />
        {[["all", "すべて", rows.length], ["done", "完了", count("done")], ["running", "処理中", count("running")],
          ["queued", "待機中", count("queued")], ["failed", "失敗", count("failed")]].map(([k, label, n]) => (
          <button key={k as string} className={`f${status === k ? " on" : ""}`} onClick={() => setStatus(k as string)}>
            {label as string} {n as number}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="panel">
          <h2>該当する分析がありません</h2>
          <p>絞り込みを外すか、新しく分析してください。</p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {shown.map((a) => {
            const [text, cls] = PILL[a.status] ?? ["", ""];
            const to = a.status === "done" ? `/analysis/${a.id}/report` : `/analysis/${a.id}/waiting`;
            const site = a.url ? a.url.replace(/^https?:\/\//, "").replace(/\/$/, "") : "入力テキスト";
            const s = a.summary;
            return (
              <div key={a.id} className="card" style={{ padding: 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <b style={{ fontSize: 15 }}>{site}</b>
                  <span className={`tag ${cls === "ok" ? "ok" : cls === "ng" ? "ng" : ""}`}>{text}</span>
                  <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--faint)" }}>
                    {new Date(a.created_at).toLocaleDateString("ja-JP")}
                  </span>
                </div>

                {s && (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
                      <span style={{ fontSize: 11.5, color: "var(--faint)" }}>総合評価</span>
                      <span className={`tag ${s.overall === "良好" ? "ok" : s.overall === "要改善" ? "ng" : "warn"}`}>
                        {s.overall}
                      </span>
                      <span className="tag score">推定</span>
                    </div>
                    <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 10 }}>{s.excerpt}</p>

                    <div style={{ marginTop: 12 }}>
                      {([["CVR", s.scores.cvr], ["SEO", s.scores.seo], ["ターゲ", s.scores.targeting], ["LP", s.scores.lp]] as const).map(
                        ([label, lv]) => (
                          <div className="sc" key={label}>
                            <span>{label}</span>
                            <span className={`t${lv === "弱" ? " weak" : ""}`}><span style={{ width: `${WIDTH[lv]}%` }} /></span>
                            <span className="v">{lv}</span>
                          </div>
                        )
                      )}
                    </div>

                    <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                      <span className="tag score">最強 {s.best}</span>
                      <span className="tag warn">最弱 {s.worst}</span>
                    </div>

                    {s.firstSteps?.[0] && (
                      <div style={{ marginTop: 14, paddingLeft: 12, borderLeft: "2px solid var(--gold)" }}>
                        <div className="label">次の一手</div>
                        <p style={{ fontSize: 13, marginTop: 4 }}>{s.firstSteps[0].action}</p>
                      </div>
                    )}
                  </>
                )}

                <Link className="btn ghost" href={to} style={{ width: "100%", justifyContent: "center", marginTop: 16 }}>
                  {a.status === "done" ? "レポートを表示" : "進捗を見る"}
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
