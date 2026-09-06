"use client";

import { useState, useTransition } from "react";
import { startAnalysis } from "@/app/actions";
import type { AnalysisMode } from "@/lib/types";
import { IconArrowRight, IconGlobe } from "./Chrome";

export function NewAnalysisForm({ initialUrl }: { initialUrl: string }) {
  const [url, setUrl] = useState(initialUrl);
  const [text, setText] = useState("");
  const [mode, setMode] = useState<AnalysisMode>("report");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    setErr(null);
    start(async () => {
      try {
        await startAnalysis({
          url: url || undefined,
          text: mode === "meo" ? undefined : text || undefined,
          mode,
        });
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        if (!m.includes("NEXT_REDIRECT")) setErr(m);
      }
    });
  }

  return (
    <div style={{ maxWidth: 620, margin: "64px auto 0", textAlign: "center" }}>
      <h2 style={{ fontSize: 22 }}>広告の伸びしろ、今すぐ見つけましょう</h2>

      {err && <div className="alert" style={{ marginTop: 20, textAlign: "left" }}>{err}</div>}

      <div className="modes">
        <button className={mode === "report" ? "on" : ""} onClick={() => setMode("report")}>
          <b>サイトレポート</b>
          <small>戦略・原稿・バナーまで一式</small>
        </button>
        <button className={mode === "meo" ? "on" : ""} onClick={() => setMode("meo")}>
          <b>MEOだけ見る</b>
          <small>マップ順位を実データで即確認</small>
        </button>
      </div>

      <div className="field" style={{ marginTop: 16 }}>
        <IconGlobe />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com"
          onKeyDown={(e) => { if (e.key === "Enter" && !pending) submit(); }}
        />
        <button className="go" onClick={submit} disabled={pending} aria-label="分析を始める">
          <IconArrowRight />
        </button>
      </div>

      {mode === "report" && (
        <>
          <textarea
            className="box"
            style={{ marginTop: 12, textAlign: "left" }}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="（任意）商品説明・補足。URLが無い場合はここだけでも分析できます"
            rows={2}
          />

        </>
      )}

      <p style={{ marginTop: 16, fontSize: 12.5, color: "var(--faint)" }}>
        {pending
          ? "分析を積んでいます…"
          : mode === "meo"
            ? "Googleマップの掲載状況・評価・レビュー数を近隣の同業と比べます（約20秒）"
            : "サイトを分析し、訴求軸・コピー・バナー・LPまで作ります（約3〜5分）"}
      </p>
    </div>
  );
}
