"use client";

import { useState, useTransition } from "react";
import { startAnalysis } from "@/app/actions";
import { IconArrowRight, IconGlobe } from "./Chrome";

export function NewAnalysisForm({ initialUrl }: { initialUrl: string }) {
  const [url, setUrl] = useState(initialUrl);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    setErr(null);
    start(async () => {
      try {
        await startAnalysis({ url: url || undefined, text: text || undefined });
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        if (!m.includes("NEXT_REDIRECT")) setErr(m);
      }
    });
  }

  return (
    <div style={{ maxWidth: 620, margin: "80px auto 0", textAlign: "center" }}>
      <h2 style={{ fontSize: 22 }}>広告の伸びしろ、今すぐ見つけましょう</h2>

      {err && <div className="alert" style={{ marginTop: 20, textAlign: "left" }}>{err}</div>}

      <div className="field" style={{ marginTop: 24 }}>
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

      <textarea
        className="box"
        style={{ marginTop: 12, textAlign: "left" }}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="（任意）商品説明・補足。URLが無い場合はここだけでも分析できます"
        rows={2}
      />

      <p style={{ marginTop: 14, fontSize: 12.5, color: "var(--faint)" }}>
        {pending
          ? "分析を積んでいます…"
          : "サイトを分析し、訴求軸・コピー・バナー・LPまで作ります（約1〜2分）"}
      </p>
    </div>
  );
}
