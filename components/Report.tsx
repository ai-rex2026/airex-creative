"use client";

import { useState } from "react";
import { toPng } from "html-to-image";
import JSZip from "jszip";
import { runLp } from "@/app/actions";
import { SIZES } from "@/lib/sizes";
import type { BannerCopy, Diagnosis, GuardVerdict } from "@/lib/types";
import { INDUSTRY_LABEL } from "@/lib/types";
import { Banner } from "./Banner";

export function Report({ d, copies }: { d: Diagnosis; copies: BannerCopy[] }) {
  const [picked, setPicked] = useState<number[]>(copies.map((_, i) => i).slice(0, 3));
  const [sizes, setSizes] = useState<string[]>(["meta-1x1", "meta-4x5", "google-lb"]);
  const [lp, setLp] = useState<{ html: string; guard: GuardVerdict } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const chosen = picked.map((i) => copies[i]).filter(Boolean);
  const chosenSizes = SIZES.filter((s) => sizes.includes(s.id));

  async function guarded(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function download(nodeId: string, name: string) {
    const node = document.getElementById(nodeId);
    if (!node) return;
    const dataUrl = await toPng(node, { pixelRatio: 1, cacheBust: true });
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = name;
    a.click();
  }

  async function downloadZip() {
    const zip = new JSZip();
    for (const [ci] of chosen.entries()) {
      for (const s of chosenSizes) {
        const node = document.getElementById(`bn-${ci}-${s.id}`);
        if (!node) continue;
        const dataUrl = await toPng(node, { pixelRatio: 1, cacheBust: true });
        zip.file(`${s.media}/${s.w}x${s.h}_${ci + 1}.png`, dataUrl.split(",")[1], { base64: true });
      }
    }
    if (lp) zip.file("lp/index.html", lp.html);
    const blob = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "airex-creative.zip";
    a.click();
  }

  return (
    <div>
      {err && <div className="alert">{err}</div>}

      <section className="block">
        <div className="step-head"><span className="n">1</span><h2>診断</h2></div>
        <div className="card">
          <div className="grid2">
            <Field label="商材">{d.product}</Field>
            <Field label="ターゲット">{d.audience}</Field>
            <Field label="業種（表現規制）">{INDUSTRY_LABEL[d.industry]}</Field>
            <Field label="ブランド色">
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 16, height: 16, borderRadius: 4, background: d.brand.accent, border: "1px solid var(--line)" }} />
                {d.brand.accent}
              </span>
            </Field>
            <Field label="強み">{d.strengths.join(" / ")}</Field>
            <Field label="買わない理由">{d.objections.join(" / ")}</Field>
          </div>
          <div style={{ marginTop: 22 }}>
            <p className="eyebrow">訴求軸</p>
            <div className="grid2" style={{ marginTop: 12 }}>
              {d.angles.map((a) => (
                <div key={a.id} className="card" style={{ background: "var(--sunk)", padding: 16 }}>
                  <b style={{ fontSize: 14 }}>{a.name}</b>
                  <span style={{ display: "block", fontSize: 12.5, color: "var(--muted)", marginTop: 4 }}>{a.why}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="block">
        <div className="step-head"><span className="n">2</span><h2>コピーと法令チェック</h2></div>
        <div style={{ display: "grid", gap: 12 }}>
          {[...copies.entries()]
            .sort((a, b) => (b[1].score ?? 0) - (a[1].score ?? 0))
            .map(([i, c]) => (
              <label key={i} className={`card${picked.includes(i) ? " sel" : ""}`} style={{ display: "block", cursor: "pointer" }}>
                <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                  <input
                    type="checkbox"
                    checked={picked.includes(i)}
                    onChange={(e) => setPicked((p) => (e.target.checked ? [...p, i] : p.filter((x) => x !== i)))}
                    style={{ marginTop: 7 }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                      <b style={{ fontSize: 16 }}>{c.headline.join("")}</b>
                      <GuardTag g={c.guard} />
                      {typeof c.score === "number" && <span className="tag score">勝ち筋 {c.score}</span>}
                    </div>
                    <p style={{ fontSize: 13.5, color: "var(--muted)", marginTop: 6 }}>{c.body}</p>
                    <p style={{ fontSize: 12.5, color: "var(--faint)", marginTop: 4 }}>
                      {c.ribbonTop} / {c.ribbonBottom} / CTA: {c.cta}
                    </p>
                    {c.scoreReason && <p style={{ fontSize: 12.5, color: "var(--faint)", marginTop: 4 }}>評価: {c.scoreReason}</p>}
                    {c.guard && c.guard.hits.length > 0 && (
                      <div className="hits">
                        {c.guard.hits.map((h, k) => (
                          <div key={k} className="hit"><b>「{h.text}」</b> {h.law}：{h.reason} → {h.suggestion}</div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </label>
            ))}
        </div>
        <div className="note">
          <i className="i">i</i>
          <span>勝ち筋スコアは案どうしの相対的な順位づけで、クリック率の予測値ではありません。数字より、その下の理由を読んで選んでください。</span>
        </div>
      </section>

      {chosen.length > 0 && (
        <section className="block">
          <div className="step-head"><span className="n">3</span><h2>バナー書き出し</h2></div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {SIZES.map((s) => (
              <button
                key={s.id}
                className={`tag${sizes.includes(s.id) ? " on" : ""}`}
                style={{ cursor: "pointer" }}
                onClick={() => setSizes((v) => (v.includes(s.id) ? v.filter((x) => x !== s.id) : [...v, s.id]))}
              >
                {s.media} {s.w}×{s.h}
              </button>
            ))}
          </div>
          <p style={{ fontSize: 12.5, color: "var(--faint)", marginTop: 12 }}>
            選択 {chosen.length} 案 × {chosenSizes.length} サイズ ＝ {chosen.length * chosenSizes.length} 枚
          </p>
          <button className="btn" style={{ marginTop: 14 }} onClick={() => guarded("zip", downloadZip)} disabled={!!busy}>
            {busy === "zip" ? "書き出し中…" : "全部まとめてZIPで保存"}<span className="arw">↓</span>
          </button>

          <div style={{ marginTop: 26, display: "grid", gap: 30 }}>
            {chosen.map((c, ci) => (
              <div key={ci}>
                <p className="eyebrow">{c.headline.join("")}</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 20, marginTop: 12 }}>
                  {chosenSizes.map((s) => {
                    const scale = Math.min(230 / s.w, 290 / s.h);
                    return (
                      <div key={s.id}>
                        <div className="thumb" style={{ width: s.w * scale, height: s.h * scale }}>
                          <div style={{ transform: `scale(${scale})`, transformOrigin: "top left" }}>
                            <Banner id={`bn-${ci}-${s.id}`} copy={c} brand={d.brand} size={s} />
                          </div>
                        </div>
                        <button className="link" style={{ marginTop: 6 }} onClick={() => download(`bn-${ci}-${s.id}`, `${s.media}_${s.w}x${s.h}_${ci + 1}.png`)}>
                          {s.w}×{s.h} を保存
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {chosen.length > 0 && (
        <section className="block">
          <div className="step-head"><span className="n">4</span><h2>リンク先LP</h2></div>
          <button className="btn" onClick={() => guarded("lp", async () => setLp(await runLp(d, chosen[0])))} disabled={!!busy}>
            {busy === "lp" ? "生成中…" : `「${chosen[0].headline.join("")}」に合わせたLPを作る`}<span className="arw">→</span>
          </button>
          {lp && (
            <div style={{ marginTop: 18 }}>
              <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 12 }}>
                <GuardTag g={lp.guard} />
                <button className="link" onClick={() => {
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(new Blob([lp.html], { type: "text/html" }));
                  a.download = "lp.html";
                  a.click();
                }}>index.html を保存</button>
              </div>
              <iframe srcDoc={lp.html} className="thumb" style={{ width: "100%", height: 560 }} />
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="val">{children}</div>
    </div>
  );
}

function GuardTag({ g }: { g?: GuardVerdict }) {
  if (!g) return null;
  const map = { green: ["問題なし", "ok"], yellow: ["要確認", "warn"], red: ["修正必要", "ng"] } as const;
  const [label, cls] = map[g.level];
  return <span className={`tag ${cls}`}>法令 {label}</span>;
}
