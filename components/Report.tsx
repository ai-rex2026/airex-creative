"use client";

import { useState } from "react";
import { toPng } from "html-to-image";
import JSZip from "jszip";
import { runLp } from "@/app/actions";
import { SIZES } from "@/lib/sizes";
import type { BannerCopy, Diagnosis, GuardVerdict } from "@/lib/types";
import type { SeoEstimate, SiteScan } from "@/lib/site-scan";
import type { MediaPlanItem } from "@/lib/types";
import { INDUSTRY_LABEL } from "@/lib/types";
import { Banner } from "./Banner";

export function Report({
  d,
  copies,
  url,
  isGuest,
  site,
  seo,
  plan,
}: {
  d: Diagnosis;
  copies: BannerCopy[];
  url: string | null;
  isGuest: boolean;
  site: SiteScan | null;
  seo: SeoEstimate | null;
  plan: MediaPlanItem[] | null;
}) {
  const [picked, setPicked] = useState<number[]>(copies.map((_, i) => i).slice(0, 3));
  const [sizes, setSizes] = useState<string[]>(["meta-1x1", "meta-4x5", "google-lb"]);
  const [lp, setLp] = useState<{ html: string; guard: GuardVerdict } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showAllCopies, setShowAllCopies] = useState(false);
  const [hideRed, setHideRed] = useState(false);
  const [zoom, setZoom] = useState<{ ci: number; sizeId: string } | null>(null);

  const TOP_N = 3;
  const sorted = [...copies.entries()].sort((a, b) => (b[1].score ?? 0) - (a[1].score ?? 0));
  const redCount = copies.filter((c) => c.guard?.level === "red").length;
  const visible = hideRed ? sorted.filter(([, c]) => c.guard?.level !== "red") : sorted;
  const shown = showAllCopies ? visible : visible.slice(0, TOP_N);

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

      <nav className="toc">
        <a href="#sec-overview">サイト概要</a>
        {site && <a href="#sec-security">セキュリティ</a>}
        {seo && <a href="#sec-seo">SEO強度</a>}
        <a href="#sec-strength">強み・買わない理由</a>
        {plan && plan.length > 0 && <a href="#sec-plan">広告手法</a>}
        <a href="#sec-angles">訴求軸</a>
        <a href="#sec-copies">コピー・法令</a>
        {!isGuest && <a href="#sec-banners">バナー</a>}
        {!isGuest && <a href="#sec-lp">LP</a>}
      </nav>

      <div className="rep-top">
        <a className="icon-btn" href="/analysis">←</a>
        <div className="right">
          <button
            className="icon-btn"
            onClick={() => {
              // 畳んだ指摘が閉じたまま印刷されると中身が落ちるので、先に全部開く
              document.querySelectorAll("details.flags").forEach((d) => ((d as HTMLDetailsElement).open = true));
              window.print();
            }}
          >
            ⤓ PDF出力
          </button>
        </div>
      </div>

      <div className="rep-hero">
        {url && <div className="u">{url}</div>}
        <h2>{url ? url.replace(/^https?:\/\//, "").replace(/\/$/, "") : "入力テキストから分析"}</h2>
      </div>

      <div className="sec-head">
        <span className="ic">◎</span>
        <div>
          <h2 id="sec-overview">サイト概要</h2>
          <div className="sub">何を、誰に売っているか</div>
        </div>
        <span className="rule" />
      </div>

      <div className="card measure">
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

      {site && (
        <>
          <div className="chips">
            <span className="chip-s">{site.https ? "HTTPS 対応済み" : "HTTPS 未対応"}</span>
            <span className="chip-s">robots.txt {site.robotsTxt ? "有り" : "無し"}</span>
            <span className="chip-s">sitemap.xml {site.sitemapXml ? "有り" : "無し"}</span>
            <span className="chip-s">構造化データ {site.structuredData ? "有り" : "無し"}</span>
            <span className="chip-s">内部リンク {site.internalLinks} / 外部リンク {site.externalLinks}</span>
          </div>

          {site.adTags.length > 0 && (
            <>
              <div className="label" style={{ marginTop: 18 }}>検出された広告タグ</div>
              <div className="chips">
                {site.adTags.map((t) => (
                  <span key={t} className="chip-s" style={{ background: "#FBEDE9", borderColor: "#EFD3CA", color: "var(--ng)" }}>{t}</span>
                ))}
              </div>
            </>
          )}

          {site.tech.length > 0 && (
            <>
              <div className="label" style={{ marginTop: 14 }}>使用技術</div>
              <div className="chips">
                {site.tech.map((t) => <span key={t} className="chip-s">{t}</span>)}
              </div>
            </>
          )}
        </>
      )}

      <div className="stat-row" style={{ marginTop: 14 }}>
        <div><b>{d.strengths.length}</b><small>強み</small></div>
        <div><b>{d.objections.length}</b><small>買わない理由</small></div>
        <div><b>{d.angles.length}</b><small>訴求軸</small></div>
        <div><b>{copies.filter((c) => c.guard?.level === "green").length}/{copies.length}</b><small>法令チェック通過</small></div>
      </div>

      {site && (
        <>
          <div className="sec-head">
            <span className="ic">⛨</span>
            <div>
              <h2 id="sec-security">セキュリティチェック</h2>
              <div className="sub">セキュリティヘッダー検査結果</div>
            </div>
            <span className="rule" />
          </div>

          <div className="score">
            <div style={{ textAlign: "center" }}>
              <div className="n">{site.passed}</div>
              <div className="of">/ {site.total} 通過</div>
              <span className={`tag ${site.passed >= 8 ? "ok" : site.passed >= 5 ? "warn" : "ng"}`} style={{ marginTop: 8 }}>
                {site.passed >= 8 ? "良好" : site.passed >= 5 ? "要確認" : "要対応"}
              </span>
            </div>
            <div className="body">
              <div className="bar"><span style={{ width: `${(site.passed / site.total) * 100}%` }} /></div>
              <p>HTTPS・セキュリティヘッダー・robots.txt・sitemap.xml・構造化データの設定状況を実際に取得して調べました。</p>
            </div>
          </div>

          <div className="rows">
            <div className="rh">セキュリティヘッダー</div>
            {site.headers.map((h) => (
              <div className="r" key={h.key}>
                <span className="st" style={{ color: h.pass ? "var(--ok)" : "var(--ng)" }}>{h.pass ? "✓" : "✕"}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <b>{h.label}</b>
                  <small>{h.desc}</small>
                  {h.value && (
                    <code style={{ display: "block", fontSize: 11.5, color: "var(--muted)", marginTop: 4, wordBreak: "break-all" }}>
                      {h.value.slice(0, 120)}
                    </code>
                  )}
                </div>
                <span className={`pill ${h.pass ? "ok" : "ng"}`}>{h.pass ? "通過" : "要対応"}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {seo && site && (
        <>
          <div className="sec-head">
            <span className="ic">⛓</span>
            <div style={{ display: "flex", alignItems: "center" }}>
              <div>
                <h2 id="sec-seo">ドメインパワー（SEO強度）</h2>
                <div className="sub">推定スコア</div>
              </div>
              <span className="ai">AI推定</span>
            </div>
            <span className="rule" />
          </div>

          <div className="score">
            <div style={{ textAlign: "center" }}>
              <div className="n">{seo.score}</div>
              <div className="of">/ 100</div>
              <span className="tag score" style={{ marginTop: 8 }}>{seo.label}</span>
            </div>
            <div className="body">
              <div className="bar"><span style={{ width: `${seo.score}%` }} /></div>
              <p>{seo.comment}</p>
            </div>
          </div>

          <div className="stat-row" style={{ marginTop: 14 }}>
            <div><b>{site.internalLinks}</b><small>内部リンク数</small></div>
            <div><b>{site.externalLinks}</b><small>外部リンク数</small></div>
            <div><b>—</b><small>被リンク数（未取得）</small></div>
            <div><b>—</b><small>参照ドメイン数（未取得）</small></div>
          </div>

          <div className="note">
            <i className="i">i</i>
            <span>
              スコアは、その場で取得できた指標（HTTPS・ヘッダー・サイトマップ・構造化データ・内部リンク）
              だけから出した<b style={{ fontWeight: 600 }}>推定値</b>です。被リンク数と参照ドメイン数は外部データが必要なため取得していません。
            </span>
          </div>
        </>
      )}

      <div className="sec-head">
        <span className="ic">◆</span>
        <div>
          <h2 id="sec-strength">強みと、買わない理由</h2>
          <div className="sub">ここを潰すコピーが一番効く</div>
        </div>
        <span className="rule" />
      </div>
      <div className="rows measure">
        <div className="rh">強み</div>
        {d.strengths.map((t, i) => (
          <div className="r" key={i}><span className="st" style={{ color: "var(--ok)" }}>✓</span><b style={{ fontWeight: 400 }}>{t}</b></div>
        ))}
      </div>
      <div className="rows measure">
        <div className="rh">買わない理由</div>
        {d.objections.map((t, i) => (
          <div className="r" key={i}><span className="st" style={{ color: "var(--ng)" }}>✕</span><b style={{ fontWeight: 400 }}>{t}</b></div>
        ))}
      </div>

      {plan && plan.length > 0 && (
        <>
          <div className="sec-head">
            <span className="ic">◈</span>
            <div>
              <h2 id="sec-plan">広告手法一覧</h2>
              <div className="sub">サイト分析をもとに、使うべき媒体を優先順位付きで出しています</div>
            </div>
            <span className="rule" />
          </div>

          <div className="plan measure">
            {plan.map((m, i) => (
              <div className="p" key={m.channel + i}>
                <div className="top">
                  <span className="ic">◎</span>
                  <b>{m.channel}</b>
                  <span className="share">{m.share}%</span>
                  <span className={`pr${m.priority === "最優先" ? " top1" : ""}`}>{m.priority}</span>
                </div>
                <div className="body">
                  <div className="bar"><span style={{ width: `${m.share}%` }} /></div>
                  <p>{m.reason}</p>
                  {(m.cpa || m.cvr || m.ctr) && (
                    <div className="kpis" style={{ marginTop: 14 }}>
                      <div className="kpi"><b>{m.cpa ?? "—"}</b><small>CPA 目安</small></div>
                      <div className="kpi"><b>{m.cvr ?? "—"}</b><small>CVR 目安</small></div>
                      <div className="kpi"><b>{m.ctr ?? "—"}</b><small>CTR 目安</small></div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="note">
            <i className="i">i</i>
            <span>
              CPA・CVR・CTR は業界平均をもとにした<b style={{ fontWeight: 600 }}>目安</b>です。実績を保証するものではありません。
              予算配分も、実際の運用結果を見ながら調整する前提の初期値です。
            </span>
          </div>
        </>
      )}

      <div className="sec-head">
        <span className="ic">↗</span>
        <div>
          <h2 id="sec-angles">訴求軸</h2>
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
          <h2 id="sec-copies">コピーと法令チェック</h2>
          <div className="sub">生成と同時に景表法・薬機法を確認しています</div>
        </div>
        <span className="rule" />
      </div>
      <section>
        <div className="filters measure">
          <button className={`sw${hideRed ? " on" : ""}`} onClick={() => setHideRed((v) => !v)}>
            {hideRed ? "✓ " : ""}要修正を隠す
          </button>
          <span>
            {visible.length} / {copies.length} 案を表示中
            {redCount > 0 && `（要修正 ${redCount}件）`}
          </span>
        </div>

        <div className="measure" style={{ display: "grid", gap: 12 }}>
          {shown.map(([i, c]) => (
              <label key={i} className={`card copy-card${picked.includes(i) ? " sel" : ""}`} style={{ display: "block", cursor: "pointer" }}>
                <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                  <input
                    type="checkbox"
                    checked={picked.includes(i)}
                    onChange={(e) => setPicked((p) => (e.target.checked ? [...p, i] : p.filter((x) => x !== i)))}
                    style={{ marginTop: 8 }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 8 }}>
                      <GuardTag g={c.guard} />
                      {typeof c.score === "number" && <span className="tag score">勝ち筋 {c.score}</span>}
                    </div>

                    <div className="hl">{c.headline.join("")}</div>
                    <p className="body">{c.body}</p>

                    <div className="meta">
                      {c.ribbonTop && <span className="m"><em>条件</em>{c.ribbonTop}</span>}
                      {c.ribbonBottom && <span className="m"><em>強調</em>{c.ribbonBottom}</span>}
                      <span className="m"><em>CTA</em>{c.cta}</span>
                    </div>

                    {c.scoreReason && <p className="why">{c.scoreReason}</p>}

                    {c.guard && c.guard.hits.length > 0 && (
                      <details className="flags">
                        <summary onClick={(e) => e.stopPropagation()}>
                          法令の指摘 {c.guard.hits.length}件
                          {c.guard.hits.some((h) => h.severity === "high") && (
                            <span className="hit-sev high">要修正 {c.guard.hits.filter((h) => h.severity === "high").length}</span>
                          )}
                        </summary>
                        {c.guard.hits.map((h, k) => (
                          <div key={k} className={`flag ${h.severity ?? "medium"}`}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span className={`hit-sev ${h.severity ?? "medium"}`}>
                                {h.severity === "high" ? "要修正" : h.severity === "low" ? "参考" : "要確認"}
                              </span>
                              <span className="q">「{h.text}」</span>
                            </div>
                            <dl>
                              <dt>根拠</dt>
                              <dd>{h.law}</dd>
                              <dt>なぜ</dt>
                              <dd>{h.reason}</dd>
                              <dt>言い換え</dt>
                              <dd className="fix">{h.suggestion}</dd>
                            </dl>
                          </div>
                        ))}
                      </details>
                    )}
                  </div>
                </div>
              </label>
          ))}
          {!showAllCopies && visible.length > TOP_N && (
            <button className="more" onClick={() => setShowAllCopies(true)}>
              残り {visible.length - TOP_N} 案を表示する
            </button>
          )}
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
              <h2 id="sec-banners">バナー書き出し</h2>
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
                        <div
                          className="thumb"
                          style={{ width: s.w * scale, height: s.h * scale }}
                          onClick={() => setZoom({ ci, sizeId: s.id })}
                          title="クリックで拡大"
                        >
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
              <h2 id="sec-lp">リンク先LP</h2>
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
      {zoom && (() => {
        const zs = SIZES.find((x) => x.id === zoom.sizeId)!;
        const zc = chosen[zoom.ci];
        const zscale = Math.min(1, Math.min(760 / zs.w, (typeof window !== "undefined" ? window.innerHeight * 0.72 : 700) / zs.h));
        return (
          <div className="zoom" onClick={() => setZoom(null)}>
            <div className="inner" onClick={(e) => e.stopPropagation()}>
              <div className="cap">
                {zs.media} {zs.w}×{zs.h}
                <button className="x" onClick={() => setZoom(null)}>閉じる</button>
              </div>
              <div style={{ width: zs.w * zscale, height: zs.h * zscale, overflow: "hidden" }}>
                <div style={{ transform: `scale(${zscale})`, transformOrigin: "top left" }}>
                  <Banner id={`zoom-${zoom.ci}-${zs.id}`} copy={zc} brand={d.brand} size={zs} />
                </div>
              </div>
            </div>
          </div>
        );
      })()}

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
