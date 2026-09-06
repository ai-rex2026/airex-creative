"use client";

import { useState } from "react";
import { toPng } from "html-to-image";
import JSZip from "jszip";
import { runLp } from "@/app/actions";
import { SIZES } from "@/lib/sizes";
import type { BannerCopy, Diagnosis, GuardVerdict } from "@/lib/types";
import { INDUSTRY_LABEL } from "@/lib/types";
import { Banner } from "./Banner";

export function Report({
  d,
  copies,
  url,
  isGuest,
}: {
  d: Diagnosis;
  copies: BannerCopy[];
  url: string | null;
  isGuest: boolean;
}) {
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

      <div className="rep-top">
        <a className="icon-btn" href="/analysis">←</a>
        <div className="right">
          <button className="icon-btn" onClick={() => window.print()}>⤓ PDF出力</button>
        </div>
      </div>

      <div className="rep-hero">
        {url && <div className="u">{url}</div>}
        <h2>{url ? url.replace(/^https?:\/\//, "").replace(/\/$/, "") : "入力テキストから分析"}</h2>
      </div>

      <div className="sec-head">
        <span className="ic">◎</span>
        <div>
          <h2>サイト概要</h2>
          <div className="sub">何を、誰に売っているか</div>
        </div>
        <span className="rule" />
      </div>

      <div className="card">
        <div className="label">商材</div>
        <p style={{ fontSize: 14, marginTop: 4 }}>{d.product}</p>
        <div className="label" style={{ marginTop: 16 }}>ターゲット</div>
        <p style={{ fontSize: 14, marginTop: 4 }}>{d.audience}</p>
        <div className="chips">
          <span className="chip-s">業種 {INDUSTRY_LABEL[d.industry]}</span>
          <span className="chip-s">
            <span style={{ width: 10, height: 10, borderRadius: 3, background: d.brand.accent, display: "inline-block" }} />
            ブランド色 {d.brand.accent}
          </span>
          <span className="chip-s">訴求軸 {d.angles.length}本</span>
          <span className="chip-s">コピー {copies.length}案</span>
        </div>
      </div>

      <div className="stat-row" style={{ marginTop: 14 }}>
        <div><b>{d.strengths.length}</b><small>強み</small></div>
        <div><b>{d.objections.length}</b><small>買わない理由</small></div>
        <div><b>{d.angles.length}</b><small>訴求軸</small></div>
        <div><b>{copies.filter((c) => c.guard?.level === "green").length}/{copies.length}</b><small>法令チェック通過</small></div>
      </div>

      <div className="sec-head">
        <span className="ic">◆</span>
        <div>
          <h2>強みと、買わない理由</h2>
          <div className="sub">ここを潰すコピーが一番効く</div>
        </div>
        <span className="rule" />
      </div>
      <div className="rows">
        <div className="rh">強み</div>
        {d.strengths.map((t, i) => (
          <div className="r" key={i}><span className="st" style={{ color: "var(--ok)" }}>✓</span><b style={{ fontWeight: 400 }}>{t}</b></div>
        ))}
      </div>
      <div className="rows">
        <div className="rh">買わない理由</div>
        {d.objections.map((t, i) => (
          <div className="r" key={i}><span className="st" style={{ color: "var(--ng)" }}>✕</span><b style={{ fontWeight: 400 }}>{t}</b></div>
        ))}
      </div>

      <div className="sec-head">
        <span className="ic">↗</span>
        <div>
          <h2>訴求軸</h2>
          <div className="sub">この切り口でコピーを作りました</div>
        </div>
        <span className="rule" />
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        {d.angles.map((a, i) => (
          <div key={a.id} className="card" style={{ display: "flex", gap: 14, alignItems: "flex-start", padding: 18 }}>
            <span className="tag score" style={{ flex: "0 0 auto" }}>{i + 1}</span>
            <div>
              <b style={{ fontSize: 14.5 }}>{a.name}</b>
              <span style={{ display: "block", fontSize: 12.5, color: "var(--muted)", marginTop: 4 }}>{a.why}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="sec-head">
        <span className="ic">✎</span>
        <div>
          <h2>コピーと法令チェック</h2>
          <div className="sub">生成と同時に景表法・薬機法を確認しています</div>
        </div>
        <span className="rule" />
      </div>
      <section>
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

      {!isGuest && chosen.length > 0 && (
        <section className="block">
          <div className="sec-head" style={{ marginTop: 0 }}>
            <span className="ic">▤</span>
            <div>
              <h2>バナー書き出し</h2>
              <div className="sub">Meta・Google・Yahoo の各サイズを同時に出します</div>
            </div>
            <span className="rule" />
          </div>
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

      {!isGuest && chosen.length > 0 && (
        <section className="block">
          <div className="sec-head" style={{ marginTop: 0 }}>
            <span className="ic">▣</span>
            <div>
              <h2>リンク先LP</h2>
              <div className="sub">広告と同じ訴求軸で着地を作ります</div>
            </div>
            <span className="rule" />
          </div>
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
      {isGuest && (
        <div className="wall">
          <div className="lock">🔒</div>
          <h2>バナーとLPは会員登録で</h2>
          <p>
            分析は完了しています。会員登録（無料）すると、媒体サイズのバナー一式とリンク先LPの作成・
            書き出しがご利用いただけます。
          </p>
          <p className="fine">※ 登録しても、いま実行した分析結果はそのまま引き継がれます。</p>
          <a className="btn" href="/login?mode=signup">無料で会員登録して続きを見る</a>
          <p className="alt">
            すでにアカウントをお持ちですか？ <a href="/login">ログイン</a>
          </p>
        </div>
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
