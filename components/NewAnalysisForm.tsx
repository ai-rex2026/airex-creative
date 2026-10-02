"use client";

import { useState, useTransition } from "react";
import { startAnalysis } from "@/app/actions";
import { MANUAL_SOCIAL_PLATFORMS } from "@/lib/social";
import type { AnalysisMode } from "@/lib/types";
import { IconArrowRight, IconGlobe } from "./Chrome";

type SocialRow = { platform: string; value: string };

export function NewAnalysisForm({ initialUrl }: { initialUrl: string }) {
  const [url, setUrl] = useState(initialUrl);
  const [text, setText] = useState("");
  const [mode, setMode] = useState<AnalysisMode>("report");
  const [social, setSocial] = useState<SocialRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function addSocialRow() {
    setSocial((cur) => [...cur, { platform: MANUAL_SOCIAL_PLATFORMS[0], value: "" }]);
  }
  function updateSocialRow(i: number, patch: Partial<SocialRow>) {
    setSocial((cur) => cur.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function removeSocialRow(i: number) {
    setSocial((cur) => cur.filter((_, idx) => idx !== i));
  }

  function submit() {
    setErr(null);
    start(async () => {
      try {
        const res = await startAnalysis({
          url: url || undefined,
          text: mode === "meo" ? undefined : text || undefined,
          mode,
          socialAccounts: mode === "meo" ? undefined : social.filter((r) => r.value.trim()),
        });
        if (res?.error) setErr(res.error);
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

          <div style={{ marginTop: 12, textAlign: "left" }}>
            {social.map((row, i) => (
              <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <select
                  value={row.platform}
                  onChange={(e) => updateSocialRow(i, { platform: e.target.value })}
                  style={{ flex: "0 0 auto" }}
                >
                  {MANUAL_SOCIAL_PLATFORMS.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
                <input
                  value={row.value}
                  onChange={(e) => updateSocialRow(i, { value: e.target.value })}
                  placeholder="@ハンドル または プロフィールURL"
                  style={{ flex: 1 }}
                />
                <button type="button" className="btn sm" onClick={() => removeSocialRow(i)} aria-label="削除">
                  ×
                </button>
              </div>
            ))}
            <button type="button" className="btn sm" onClick={addSocialRow}>
              + SNSアカウントを指定（任意）
            </button>
            <p style={{ marginTop: 6, fontSize: 12, color: "var(--faint)" }}>
              LPにリンクが無い場合や、自動検出が間違っている場合の補完・上書きに使います。
              YouTubeは公式APIで、X・TikTok・Instagramは実際にアカウントを確認したうえで実測します
              （キーワード検索ではありません）。
            </p>
          </div>
        </>
      )}

      <p style={{ marginTop: 16, fontSize: 12.5, color: "var(--faint)" }}>
        {pending
          ? "分析を積んでいます…"
          : mode === "meo"
            ? "Googleマップの掲載状況・評価・レビュー数を近隣の同業と比べます（約20秒）"
            : "サイトを分析し、訴求軸・コピー・バナー・LPまで作ります（目安20〜40分。サイトにより前後します）"}
      </p>
    </div>
  );
}
