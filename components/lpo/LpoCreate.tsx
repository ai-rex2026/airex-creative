"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/Loading";
import { buildLpoAction, createLpoFromAnalysisAction, createLpoFromUrlAction, measureSpeedAction } from "@/app/lpo-actions";

/** LP の登録：分析レポートから取り込む（AI・計測なし）か、URL から作る（読み取り→LP改善→表示速度） */
export function LpoCreate({ analyses }: { analyses: { id: string; label: string }[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<"analysis" | "url">(analyses.length ? "analysis" : "url");
  const [analysisId, setAnalysisId] = useState(analyses[0]?.id ?? "");
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function fromAnalysis() {
    if (!analysisId) return;
    setErr(null);
    setBusy("取り込んでいます");
    try {
      const { id } = await createLpoFromAnalysisAction(analysisId);
      router.push(`/lpo/${id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }

  async function fromUrl() {
    setErr(null);
    try {
      setBusy("登録しています");
      const { id } = await createLpoFromUrlAction(url, name);
      setBusy("LP を読んで、改善点を洗い出しています（1〜2分）");
      const r = await buildLpoAction(id);
      setBusy("表示速度を測っています（1〜3分）");
      await measureSpeedAction(id).catch(() => undefined);
      if (!r.done) setErr(`LP改善を作れませんでした（${r.error}）。開いた画面の「作り直す」でやり直せます`);
      router.push(`/lpo/${id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className={`btn sm${mode === "analysis" ? "" : " ghost"}`} onClick={() => setMode("analysis")} disabled={!!busy}>
          分析レポートから取り込む
        </button>
        <button className={`btn sm${mode === "url" ? "" : " ghost"}`} onClick={() => setMode("url")} disabled={!!busy}>
          URL を入れる
        </button>
      </div>
      {mode === "analysis" ? (
        analyses.length === 0 ? (
          <p style={{ marginTop: 12, fontSize: 13, color: "var(--muted)" }}>取り込める分析レポートがありません。「URL を入れる」から登録してください。</p>
        ) : (
          <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
            <select className="input" value={analysisId} onChange={(e) => setAnalysisId(e.target.value)} disabled={!!busy}>
              {analyses.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
            <small style={{ color: "var(--muted)" }}>そのレポートの LP改善と表示速度を引き継ぎます（AI・計測の費用はかかりません）。</small>
            <div>
              <button className="btn" onClick={fromAnalysis} disabled={!!busy || !analysisId}>
                {busy ? <Spinner label={busy} /> : "取り込む"}
              </button>
            </div>
          </div>
        )
      ) : (
        <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
          <input className="input" placeholder="LP の URL（https://...）" value={url} onChange={(e) => setUrl(e.target.value)} disabled={!!busy} />
          <input className="input" placeholder="名前（任意。例：〇〇 初回限定LP）" value={name} onChange={(e) => setName(e.target.value)} disabled={!!busy} />
          <small style={{ color: "var(--muted)" }}>LP を読んで改善点を洗い出し（AI 2回）、表示速度を測ります（PageSpeed Insights・無料）。</small>
          <div>
            <button className="btn" onClick={fromUrl} disabled={!!busy || !url.trim()}>
              {busy ? <Spinner label={busy} /> : "登録して分析する"}
            </button>
          </div>
        </div>
      )}
      {err && (
        <div className="alert" style={{ marginTop: 10 }}>
          {err}
        </div>
      )}
    </div>
  );
}
