"use client";

import { useState } from "react";
import { toPng } from "html-to-image";
import JSZip from "jszip";
import { runLp } from "@/app/actions";
import { SIZES } from "@/lib/sizes";
import type { BannerCopy, Diagnosis, GuardVerdict } from "@/lib/types";
import type { SeoEstimate, SiteScan } from "@/lib/site-scan";
import type { CompetitorScan } from "@/lib/competitors";
import type { TacticPlan } from "@/lib/tactics";
import { adWidth, type AdOps } from "@/lib/ad-ops";
import type { MeoScan } from "@/lib/meo";
import type { Ga4Data, GscData } from "@/lib/google";
import type { MediaPlanItem, Summary } from "@/lib/types";
import { INDUSTRY_LABEL } from "@/lib/types";
import { Banner } from "./Banner";

type Tab = "overview" | "strategy" | "creative";
type Todo = { level: "high" | "mid"; text: string; tab: Tab; anchor: string };

export function Report({
  d,
  copies,
  url,
  isGuest,
  site,
  seo,
  plan,
  summary,
  competitors,
  tactics,
  adOps,
  meo,
  gsc,
  ga4,
}: {
  d: Diagnosis;
  copies: BannerCopy[];
  url: string | null;
  isGuest: boolean;
  site: SiteScan | null;
  seo: SeoEstimate | null;
  plan: MediaPlanItem[] | null;
  summary: Summary | null;
  competitors: CompetitorScan | null;
  tactics: TacticPlan | null;
  adOps: AdOps | null;
  meo: MeoScan | null;
  gsc: GscData | null;
  ga4: Ga4Data | null;
}) {
  const [picked, setPicked] = useState<number[]>(copies.map((_, i) => i).slice(0, 3));
  const [sizes, setSizes] = useState<string[]>(["meta-1x1", "meta-4x5", "google-lb"]);
  const [lp, setLp] = useState<{ html: string; guard: GuardVerdict } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showAllCopies, setShowAllCopies] = useState(false);
  const [hideRed, setHideRed] = useState(false);
  const [zoom, setZoom] = useState<{ ci: number; sizeId: string } | null>(null);
  const [tab, setTab] = useState<Tab>("overview");

  /** 直すべきところ。散らばっている指摘を1か所に集めて、該当タブへ飛べるようにする */
  const todos: Todo[] = [];
  if (site) {
    for (const h of site.headers.filter((x) => !x.pass)) {
      todos.push({ level: "mid", text: `${h.label} が未設定`, tab: "overview", anchor: "sec-security" });
    }
    if (!site.https) todos.push({ level: "high", text: "HTTPS に対応していない", tab: "overview", anchor: "sec-security" });
    if (!site.structuredData) todos.push({ level: "mid", text: "構造化データが無い（検索結果での見え方が弱くなる）", tab: "overview", anchor: "sec-seo" });
    if (!site.sitemapXml) todos.push({ level: "mid", text: "sitemap.xml が無い", tab: "overview", anchor: "sec-seo" });
    if (site.adTags.length === 0) {
      // GTM が入っていると広告タグは実行時に差し込まれるため、HTMLだけでは「無い」と断定できない。
      // 断定できないものを「要対応」で出すと、事実と違う指摘になる。
      const viaGtm = site.tech.includes("Google Tag Manager");
      todos.push(
        viaGtm
          ? { level: "mid", text: "広告タグをHTMLから確認できない（GTM経由の可能性あり。GTMの中身を要確認）", tab: "overview", anchor: "sec-overview" }
          : { level: "high", text: "広告タグが1つも入っていない（配信しても成果を計測できない）", tab: "overview", anchor: "sec-overview" }
      );
    }
  }
  if (seo && seo.score < 45) {
    todos.push({ level: "mid", text: `SEO強度が ${seo.score}点（低権威）`, tab: "overview", anchor: "sec-seo" });
  }
  if (adOps) {
    // 必須なのに入っていないタグは、配信しても成果が測れないので最優先
    for (const t of adOps.tags.filter((x) => x.need === "必須" && x.status === "未導入")) {
      todos.push({ level: "high", text: `${t.name} が未導入（この媒体に出しても成果を計測できません）`, tab: "strategy", anchor: "sec-adops" });
    }
    for (const t of adOps.tags.filter((x) => x.need === "必須" && x.status === "要確認")) {
      todos.push({ level: "mid", text: `${t.name} の有無をGTMで確認する`, tab: "strategy", anchor: "sec-adops" });
    }
    if (adOps.overLength.length > 0) {
      todos.push({ level: "mid", text: `広告原稿 ${adOps.overLength.length}件が文字数超過（そのままでは入稿できません）`, tab: "strategy", anchor: "sec-adops" });
    }
  }
  if (meo?.self) {
    if (meo.reviewRank && meo.totalShops > 1 && meo.reviewRank > meo.totalShops / 2) {
      todos.push({ level: "mid", text: `Googleのレビュー数が近隣${meo.totalShops}店中${meo.reviewRank}位（比較検討で不利になります）`, tab: "strategy", anchor: "sec-meo" });
    }
    for (const b of meo.breakdown.filter((x) => x.got === 0 && x.max === 10)) {
      todos.push({ level: "mid", text: `Googleビジネスプロフィールの${b.label}がない`, tab: "strategy", anchor: "sec-meo" });
    }
  }
  const redN = copies.filter((c) => c.guard?.level === "red").length;
  if (redN > 0) {
    todos.push({ level: "high", text: `コピー ${redN}案が法令で要修正（そのままでは出せません）`, tab: "creative", anchor: "sec-copies" });
  }

  function jump(t: Todo) {
    setTab(t.tab);
    setTimeout(() => document.getElementById(t.anchor)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  }

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

      <div className="tabs">
        <button className={tab === "overview" ? "on" : ""} onClick={() => setTab("overview")}>サイト概要</button>
        <button className={tab === "strategy" ? "on" : ""} onClick={() => setTab("strategy")}>広告戦略</button>
        <button className={tab === "creative" ? "on" : ""} onClick={() => setTab("creative")}>クリエイティブ</button>
      </div>

      {tab === "overview" && (
        <div className="todos measure">
          <div className="h">
            直すべきところ
            {todos.length > 0 && <span className="n">{todos.length}件</span>}
          </div>
          {todos.length === 0 ? (
            <p className="ok">いまのところ、直すべき点は見つかりませんでした。</p>
          ) : (
            todos.map((t, i) => (
              <button key={i} className="i" onClick={() => jump(t)}>
                <span className={`mk ${t.level}`}>{t.level === "high" ? "要対応" : "確認"}</span>
                {t.text}
                <span className="go">見る →</span>
              </button>
            ))
          )}
        </div>
      )}

      {tab === "overview" && (
      <>
      {((gsc && gsc.queries.length > 0) || (ga4 && ga4.sessions > 0)) && (
        <>
          <div className="sec-head" style={{ marginTop: 0 }}>
            <span className="ic">⇄</span>
            <div>
              <h2 id="sec-linked">連携データ</h2>
              <div className="sub">Search Console / GA4 の実データです（推定ではありません）</div>
            </div>
            <span className="rule" />
          </div>

          <div className="linked measure">
            {gsc && gsc.queries.length > 0 && (
              <div className="k">
                <div className="h">Search Console<span className="live">実データ</span></div>
                <div className="b">
                  <div className="big">
                    <div><b>{gsc.totals.clicks.toLocaleString()}</b><small>クリック（28日）</small></div>
                    <div><b>{gsc.totals.impressions.toLocaleString()}</b><small>表示回数</small></div>
                    <div><b>{gsc.totals.position}</b><small>平均掲載順位</small></div>
                  </div>
                  <table>
                    <thead><tr><th>検索語</th><th style={{ textAlign: "right" }}>クリック</th><th style={{ textAlign: "right" }}>順位</th></tr></thead>
                    <tbody>
                      {gsc.queries.slice(0, 6).map((q) => (
                        <tr key={q.query}>
                          <td>{q.query}</td>
                          <td className="n">{q.clicks}</td>
                          <td className="n">{q.position}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {ga4 && ga4.sessions > 0 && (
              <div className="k">
                <div className="h">Google Analytics 4<span className="live">実データ</span></div>
                <div className="b">
                  <div className="big">
                    <div><b>{ga4.sessions.toLocaleString()}</b><small>セッション（28日）</small></div>
                    <div><b>{ga4.users.toLocaleString()}</b><small>ユーザー</small></div>
                  </div>
                  <table>
                    <thead><tr><th>流入チャネル</th><th style={{ textAlign: "right" }}>セッション</th></tr></thead>
                    <tbody>
                      {ga4.channels.slice(0, 6).map((c) => (
                        <tr key={c.name}><td>{c.name}</td><td className="n">{c.sessions.toLocaleString()}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {summary && summary.firstSteps?.length > 0 && (
        <>
          <div className="sec-head">
            <span className="ic">①</span>
            <div>
              <h2 id="sec-first">まずやること3つ</h2>
              <div className="sub">優先度の高い順に、今週から始められるものです</div>
            </div>
            <span className="rule" />
          </div>
          <div className="steps3 measure">
            {summary.firstSteps.map((f, i) => (
              <div className="step3" key={i}>
                <span className="n">{i + 1}</span>
                <div className="b">
                  <p className="act">{f.action}</p>
                  <dl>
                    <dt>期限</dt><dd>{f.due}</dd>
                    <dt>完了条件</dt><dd className="done">{f.done}</dd>
                  </dl>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {summary && summary.personas?.length > 0 && (
        <>
          <div className="sec-head">
            <span className="ic">☺</span>
            <div>
              <h2 id="sec-persona">お客様像</h2>
              <div className="sub">この人たちに向けてコピーを書いています</div>
            </div>
            <span className="rule" />
          </div>
          <div className="grid2 measure">
            {summary.personas.map((p, i) => (
              <div className="persona" key={i}>
                <b>{p.name}</b>
                <dl>
                  <dt>どんな人</dt><dd>{p.who}</dd>
                  <dt>困りごと</dt><dd>{p.pain}</dd>
                  <dt>動く瞬間</dt><dd>{p.trigger}</dd>
                </dl>
              </div>
            ))}
          </div>
        </>
      )}

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

          <div className="label" style={{ marginTop: 18 }}>検出された広告タグ</div>
          <div className="chips">
            {site.adTags.length > 0 ? (
              site.adTags.map((t) => (
                <span key={t} className="chip-s" style={{ background: "#FBEDE9", borderColor: "#EFD3CA", color: "var(--ng)" }}>{t}</span>
              ))
            ) : (
              <span className="chip-s">
                {site.tech.includes("Google Tag Manager")
                  ? "HTMLからは検出できず（GTM経由の可能性あり）"
                  : "検出できず"}
              </span>
            )}
          </div>

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

      {site && site.social.length > 0 && (
        <>
          <div className="sec-head">
            <span className="ic">◍</span>
            <div>
              <h2 id="sec-social">公式SNSアカウント</h2>
              <div className="sub">サイトから実際にリンクされているものだけを載せています</div>
            </div>
            <span className="rule" />
          </div>
          <div className="rows measure">
            {site.social.map((x, i) => (
              <div className="r" key={i}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b>{x.platform}</b>
                  <small>{x.handle}</small>
                </div>
                <a className="tag" href={x.url} target="_blank" rel="noreferrer noopener">開く</a>
              </div>
            ))}
          </div>
        </>
      )}

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

      </>
      )}

      {tab === "strategy" && (
      <>
      {competitors && (
        <>
          <div className="sec-head" style={{ marginTop: 0 }}>
            <span className="ic">⊕</span>
            <div>
              <h2 id="sec-comp">競合サイト比較</h2>
              <div className="sub">実際に検索して、上位に出ていたサイトです</div>
            </div>
            <span className="rule" />
          </div>

          {competitors.items.length === 0 ? (
            <div className="card measure">
              <p style={{ fontSize: 13.5, color: "var(--muted)" }}>
                検索結果を取得できませんでした。再分析すると取り直します。
              </p>
            </div>
          ) : (
            <>
              <div className="rows comp measure">
                <div className="rh">
                  上位に出ていたサイト
                  <span className="hint">検索語：{competitors.keywords.join(" / ")}</span>
                </div>
                {competitors.items.map((c, i) => (
                  <div className="r" key={i}>
                    <span className="rk">{c.rank}</span>
                    <div className="b">
                      <b>{c.name}</b>
                      <span className="u">{c.url}</span>
                      <span className="n">{c.note}</span>
                    </div>
                    <span className="kw">{c.keyword}</span>
                  </div>
                ))}
              </div>
              <div className="note measure">
                <i className="i">i</i>
                <span>
                  {new Date(competitors.searchedAt).toLocaleString("ja-JP")}時点の検索結果です。
                  順位は検索する場所・端末・時期で変わります。
                  <b style={{ fontWeight: 600 }}>訪問数や類似度は取得していないため出していません。</b>
                </span>
              </div>
            </>
          )}
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

      {meo && (
        <>
          <div className="sec-head">
            <span className="ic">◉</span>
            <div>
              <h2 id="sec-meo">MEO（Googleマップ対策）</h2>
              <div className="sub">Googleマップの実データで、近隣の同業と比べています</div>
            </div>
            <span className="rule" />
          </div>

          {!meo.self ? (
            <div className="note">
              <i className="i">i</i>
              <span>{meo.reason}</span>
            </div>
          ) : (
            <>
              <div className="meo measure">
                <div className="gauge">
                  <b>{meo.score}</b>
                  <small>/ 100</small>
                  <span className={meo.score >= 75 ? "ok" : meo.score >= 50 ? "warn" : "ng"}>
                    {meo.score >= 75 ? "良好" : meo.score >= 50 ? "改善の余地あり" : "要対策"}
                  </span>
                </div>
                <div className="kpis">
                  <div className="kpi">
                    <b>{meo.self.rating?.toFixed(1) ?? "—"}</b>
                    <small>評価{meo.avgRating !== null ? `（近隣平均 ${meo.avgRating}）` : ""}</small>
                  </div>
                  <div className="kpi">
                    <b>{meo.self.reviews}</b>
                    <small>レビュー数{meo.avgReviews !== null ? `（近隣平均 ${meo.avgReviews}）` : ""}</small>
                  </div>
                  <div className="kpi">
                    <b>{meo.ratingRank ? `${meo.ratingRank}位` : "—"}</b>
                    <small>評価の順位 / {meo.totalShops}店</small>
                  </div>
                  <div className="kpi">
                    <b>{meo.reviewRank ? `${meo.reviewRank}位` : "—"}</b>
                    <small>レビュー数の順位 / {meo.totalShops}店</small>
                  </div>
                </div>
              </div>

              <details className="flags measure">
                <summary>点数の内訳（何を測ったか）</summary>
                <div className="rows" style={{ margin: 0 }}>
                  {meo.breakdown.map((b, i) => (
                    <div className="r" key={i}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <b>{b.label}</b>
                        <small>{b.note}</small>
                      </div>
                      <span className={`tag${b.got === 0 ? " warn" : ""}`}>{b.got} / {b.max}</span>
                    </div>
                  ))}
                </div>
              </details>

              {meo.competitors.length > 0 && (
                <details className="flags measure">
                  <summary>近隣の同業（{meo.competitors.length}店）</summary>
                  <div className="rows" style={{ margin: 0 }}>
                    {meo.competitors.map((c, i) => (
                      <div className="r" key={i}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <b>{c.name}</b>
                          <small>{c.address}</small>
                        </div>
                        <span className="tag">★ {c.rating?.toFixed(1) ?? "—"}</span>
                        <span className="tag">{c.reviews}件</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}

              <div className="note">
                <i className="i">i</i>
                <span>
                  写真の枚数や投稿頻度は Google の公開データでは取得できないため、点数に入れていません。
                  上の点数は<b style={{ fontWeight: 600 }}>実際に取得できた項目だけ</b>で計算しています。
                </span>
              </div>
            </>
          )}
        </>
      )}

      {adOps && adOps.campaigns.length > 0 && (
        <>
          <div className="sec-head">
            <span className="ic">▣</span>
            <div>
              <h2 id="sec-adops">広告運用設計</h2>
              <div className="sub">管理画面にそのまま入稿できる粒度で出しています</div>
            </div>
            <span className="rule" />
          </div>

          {adOps.tags.length > 0 && (
            <>
              <div className="rows measure">
                <div className="rh">計測タグの導入状況<small>サイトを実際に読んで判定しています</small></div>
                {adOps.tags.map((t, i) => (
                  <div className="r" key={i}>
                    <span className="st" style={{ color: t.status === "導入済み" ? "var(--ok)" : t.status === "要確認" ? "var(--warn)" : "var(--ng)" }}>
                      {t.status === "導入済み" ? "✓" : t.status === "要確認" ? "?" : "✕"}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <b>{t.name}</b>
                      <small>{t.note}</small>
                    </div>
                    <span className={`tag${t.need === "必須" && t.status === "未導入" ? " warn" : ""}`}>{t.need}</span>
                  </div>
                ))}
              </div>
              <div className="note">
                <i className="i">i</i>
                <span>
                  「要確認」は<b style={{ fontWeight: 600 }}>未導入という意味ではありません</b>。
                  Google タグマネージャーはタグを表示時に差し込むため、HTMLを読むだけでは有無を判定できません。GTMの管理画面でご確認ください。
                </span>
              </div>
            </>
          )}

          {adOps.overLength.length > 0 && (
            <div className="note warn" style={{ marginTop: 14 }}>
              <i className="i">!</i>
              <span>
                <b style={{ fontWeight: 600 }}>{adOps.overLength.length}件</b>の原稿が文字数の上限を超えています。該当箇所は赤で表示しています。
              </span>
            </div>
          )}

          <div className="ops measure">
            {adOps.campaigns.map((c, ci) => (
              <div className="cmp" key={ci}>
                <div className="top">
                  <b>{c.name}</b>
                  <span className="tag">{c.channel}</span>
                </div>
                {c.bidStrategy && <p className="bid">入札戦略：{c.bidStrategy}</p>}

                {c.settings?.length > 0 && (
                  <details className="flags">
                    <summary>ターゲティング設定（{c.settings.length}項目）</summary>
                    <div className="rows" style={{ margin: 0 }}>
                      {c.settings.map((st, i) => (
                        <div className="r" key={i}>
                          <div style={{ flex: 1, minWidth: 0 }}><b style={{ fontWeight: 400 }}>{st.label}</b></div>
                          <span className="tag">{st.value}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                {c.groups?.map((g, gi) => (
                  <div className="adg" key={gi}>
                    <div className="h">
                      <span className="ic">◆</span>
                      <b>{g.name}</b>
                    </div>
                    {g.targeting && <p>{g.targeting}</p>}

                    {g.keywords?.length > 0 && (
                      <details className="flags">
                        <summary>キーワード（{g.keywords.length}件）</summary>
                        <div className="chips">{g.keywords.map((k, i) => <span className="chip" key={i}>{k}</span>)}</div>
                      </details>
                    )}
                    {g.negatives?.length > 0 && (
                      <details className="flags">
                        <summary>除外キーワード（{g.negatives.length}件）</summary>
                        <div className="chips">{g.negatives.map((k, i) => <span className="chip ng" key={i}>{k}</span>)}</div>
                      </details>
                    )}
                    {g.headlines?.length > 0 && (
                      <details className="flags">
                        <summary>見出し案（{g.headlines.length}件・全角15文字まで）</summary>
                        <div className="lines">
                          {g.headlines.map((t, i) => {
                            const w = adWidth(t);
                            return (
                              <div className={`ln${w > 30 ? " over" : ""}`} key={i}>
                                <span>{t}</span>
                                <small>{w}/30</small>
                              </div>
                            );
                          })}
                        </div>
                      </details>
                    )}
                    {g.descriptions?.length > 0 && (
                      <details className="flags">
                        <summary>説明文案（{g.descriptions.length}件・全角45文字まで）</summary>
                        <div className="lines">
                          {g.descriptions.map((t, i) => {
                            const w = adWidth(t);
                            return (
                              <div className={`ln${w > 90 ? " over" : ""}`} key={i}>
                                <span>{t}</span>
                                <small>{w}/90</small>
                              </div>
                            );
                          })}
                        </div>
                      </details>
                    )}
                  </div>
                ))}

                {c.notes?.length > 0 && (
                  <ul className="notes">
                    {c.notes.map((n, i) => <li key={i}>{n}</li>)}
                  </ul>
                )}
              </div>
            ))}
          </div>

          {adOps.guard && adOps.guard.hits?.length > 0 && (
            <div className="note warn" style={{ marginTop: 16 }}>
              <i className="i">!</i>
              <span>
                上の原稿のうち <b style={{ fontWeight: 600 }}>{adOps.guard.hits.length}件</b>に法令上の指摘があります：
                {adOps.guard.hits.slice(0, 4).map((h) => `「${h.text}」`).join("・")}
                {adOps.guard.hits.length > 4 ? " ほか" : ""}。入稿前に言い換えてください。
              </span>
            </div>
          )}
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

      {tactics && tactics.items?.length > 0 && (
        <>
          <div className="sec-head">
            <span className="ic">◇</span>
            <div>
              <h2 id="sec-tactics">広告以外の施策</h2>
              <div className="sub">出稿と並行してやると効くもの</div>
            </div>
            <span className="rule" />
          </div>
          <div className="measure" style={{ display: "grid", gap: 12 }}>
            {tactics.items.map((t, i) => (
              <div className="tactic" key={i}>
                <div className="top">
                  <b>{t.area}</b>
                  {t.kpi && <span className="kpi">見る数字：{t.kpi}</span>}
                </div>
                <p>{t.summary}</p>
                <ul>
                  {t.actions?.map((a, k) => <li key={k}>{a}</li>)}
                </ul>
              </div>
            ))}
          </div>

          {tactics.schedule?.length > 0 && (
            <>
              <div className="sec-head">
                <span className="ic">▤</span>
                <div>
                  <h2 id="sec-sched">実行スケジュール</h2>
                  <div className="sub">どの順で手を付けるか</div>
                </div>
                <span className="rule" />
              </div>
              <div className="sched">
                {tactics.schedule.map((p, i) => (
                  <div className="p" key={i}>
                    <div className="h">
                      <b>{p.phase}</b>
                      <small>{p.period}</small>
                    </div>
                    <ul>{p.items?.map((x, k) => <li key={k}>{x}</li>)}</ul>
                  </div>
                ))}
              </div>
            </>
          )}

          {tactics.risks?.length > 0 && (
            <>
              <div className="sec-head">
                <span className="ic">⚠</span>
                <div>
                  <h2 id="sec-risk">リスクと注意点</h2>
                  <div className="sub">先に潰しておくもの</div>
                </div>
                <span className="rule" />
              </div>
              <div className="rows measure">
                {tactics.risks.map((r, i) => (
                  <div className="r" key={i}>
                    <span className="st" style={{ color: "var(--warn)" }}>!</span>
                    <b style={{ fontWeight: 400 }}>{r}</b>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      </>
      )}

      {tab === "creative" && (
      <>
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
      </>
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
