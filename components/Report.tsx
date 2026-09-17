"use client";

import { useEffect, useState } from "react";
import { toPng } from "html-to-image";
import JSZip from "jszip";
import { replanForBudget, runLp, setBudget, setMargin } from "@/app/actions";
import { SIZES, type SizePreset } from "@/lib/sizes";
import type { BannerCopy, Diagnosis, GuardVerdict } from "@/lib/types";
import type { SeoEstimate, SiteScan } from "@/lib/site-scan";
import type { CompetitorScan } from "@/lib/competitors";
import type { TacticPlan } from "@/lib/tactics";
import { adWidth, type AdOps } from "@/lib/ad-ops";
import { lengthIn, limitLabel, specFor, type CountMode } from "@/lib/ad-specs";
import type { MeoScan } from "@/lib/meo";
import { MeoStoreList, scorePct } from "./MeoStores";
import { Toc } from "./Toc";
import { MainPrice } from "./MainPrice";
import { BANNER_CASE_WARNING, looksLikeCasePhoto } from "@/lib/case-photo";
import { cropImageToDataUrl } from "@/lib/crop-image";
import type { KeywordPlan, LinePlan, LpoPlan } from "@/lib/deep";
import type { OutreachPlan, SuggestScan } from "@/lib/outreach";
import { MARGIN, breakEvenCpa, type PriceScan } from "@/lib/pricing";
import type { SpeedScan } from "@/lib/pagespeed";
import type { SocialScan } from "@/lib/social";
import type { ImageScan } from "@/lib/image-check";
import type { Ga4Data, GscData } from "@/lib/google";
import type { MediaPlanItem, Summary } from "@/lib/types";
import { BUDGETS, INDUSTRY_LABEL, budgetOf, shareToYen, type BudgetBand } from "@/lib/types";
import { Banner, pickFacts } from "./Banner";
import { ReportChat } from "./ReportChat";
import { Measures } from "./Measures";
import { Inputs } from "./Inputs";
import { hygiene } from "@/lib/measures";
import type { KpiTree } from "@/lib/kpi";
import type { Measure } from "@/lib/measures";

type Tab = "inputs" | "measures" | "overview";

/**
 * 「切り抜く」表示のとき、横・縦どちらの位置スライダーが実際に効くかを判定する。
 * Banner.tsx の枠サイズ計算（photoTop/photoSide・photoShare）をここでも再現し、
 * object-fit: cover ではみ出す軸（＝動かして意味がある軸）だけを true にする。
 * どちらもはみ出さない場合や、四捨五入で誤差が出る場合を考え、1px未満は「効かない」扱いにする
 */
function coverAxisEffect(size: SizePreset, natural: { w: number; h: number }): { x: boolean; y: boolean } {
  const compact = Math.min(size.w, size.h) < 400;
  const landscape = size.w / size.h > 1.6;
  const photoTop = !landscape;
  const photoShare = compact ? 0.34 : 0.42;
  const boxW = photoTop ? size.w : size.w * 0.4;
  const boxH = photoTop ? size.h * photoShare : size.h;
  const scale = Math.max(boxW / natural.w, boxH / natural.h);
  const excessX = natural.w * scale - boxW;
  const excessY = natural.h * scale - boxH;
  return { x: excessX > 1, y: excessY > 1 };
}

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
  lpo,
  keywords,
  linePlan,
  suggests,
  outreach,
  pricing: initialPricing,
  speed,
  social,
  imageScan,
  margin: initialMargin,
  kpi,
  measures,
  kpiSelected,
  measuresDone,
  extraInputs,
  measureLog,
  budget: initialBudget,
  id,
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
  lpo: LpoPlan | null;
  keywords: KeywordPlan | null;
  linePlan: LinePlan | null;
  suggests: SuggestScan | null;
  outreach: OutreachPlan | null;
  pricing: PriceScan | null;
  speed: SpeedScan | null;
  social: SocialScan | null;
  imageScan: ImageScan | null;
  margin: number | null;
  kpi: KpiTree | null;
  measures: Measure[] | null;
  kpiSelected: { id: string; name: string; custom?: boolean }[] | null;
  measuresDone: string[] | null;
  extraInputs: { platform: string; url: string }[] | null;
  measureLog: { title: string; at: string }[] | null;
  budget: BudgetBand | null;
  id: string;
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
  const [tab, setTab] = useState<Tab>(kpi ? "measures" : "overview");
  const [budget, setBudgetState] = useState<BudgetBand | null>(initialBudget);
  const [replanning, setReplanning] = useState(false);
  const [margin, setMarginState] = useState<number>(initialMargin ?? MARGIN[d.industry] ?? 0.4);
  // 主力商材は押し替えられる。自動で拾った価格が実際の主力とずれることがある
  const [pricing, setPricing] = useState(initialPricing);
  // バナーに載せる写真。サイトから拾ったものだけを使う（生成画像は使わない）
  const [photo, setPhoto] = useState<string | null>(null);
  // 文字入りの画像は切り抜くと見切れるので、切り方と位置を選べるようにする
  const [photoFit, setPhotoFit] = useState<"cover" | "contain">("cover");
  const [photoFocus, setPhotoFocus] = useState({ x: 50, y: 50 });
  const [showTexted, setShowTexted] = useState(false);
  // 文字入り画像を選んだとき、文字を含まない領域だけを切り出した結果（data URL）
  const [croppedSrc, setCroppedSrc] = useState<string | null>(null);
  const [cropBusy, setCropBusy] = useState(false);
  const [cropError, setCropError] = useState<string | null>(null);
  const photoSrc = croppedSrc ?? (photo ? `/api/analysis/${id}/img?u=${encodeURIComponent(photo)}` : null);
  // 位置スライダーが実際に効くかは、写真の縦横比と枠の縦横比の組み合わせで決まる
  // （object-fit: cover の性質上、はみ出さない軸は動かしても変化しない）。
  // 判定には元画像の実サイズが要るので、選ばれた瞬間に読み込んでおく
  const [photoNatural, setPhotoNatural] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    if (!photoSrc) {
      setPhotoNatural(null);
      return;
    }
    let cancelled = false;
    const img = new window.Image();
    img.onload = () => {
      if (!cancelled) setPhotoNatural({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.onerror = () => {
      if (!cancelled) setPhotoNatural(null);
    };
    img.src = photoSrc;
    return () => {
      cancelled = true;
    };
  }, [photoSrc]);

  /**
   * 写真候補を選ぶ。文字が写り込んでいても safeCrop（文字を含まない領域）が
   * 取れている画像なら、選んだ瞬間にその領域だけを切り出して使う。
   * こうすると、表示位置をどう動かしても文字が入り込まないことを保証できる
   * （position をずらして避けるやり方は、文字が広く入った画像では成立しないため）
   */
  async function pickPhoto(u: string) {
    setPhoto(u);
    setCropError(null);
    const info = imageScan?.items.find((x) => x.url === u);
    if (info?.hasText && info.safeCrop) {
      setCropBusy(true);
      try {
        const src = `/api/analysis/${id}/img?u=${encodeURIComponent(u)}`;
        setCroppedSrc(await cropImageToDataUrl(src, info.safeCrop));
      } catch {
        setCroppedSrc(null);
        setCropError("この写真の自動トリミングに失敗しました。お手数ですが他の写真をお選びください。");
      } finally {
        setCropBusy(false);
      }
    } else {
      setCroppedSrc(null);
    }
  }

  // 粗利率は断定できないので、押した瞬間に計算し直して裏で保存する
  function pickMargin(m: number) {
    setMarginState(m);
    void setMargin(id, m).catch(() => {});
  }

  // 予算は配分%を実額に直すだけなので、選んだ瞬間に画面へ反映して裏で保存する
  function pickBudget(b: BudgetBand | null) {
    setBudgetState(b);
    void setBudget(id, b).catch(() => {});
  }

  // 予算に対して媒体が多すぎると、どの媒体もデータが溜まらず判断できなくなる
  const band = budgetOf(budget);
  const thin = band
    ? (plan ?? []).filter((m) => Math.round((band.min * m.share) / 100) < 10)
    : [];

  /**
   * 4領域のスコア。すべて実測済みの値から組む。
   * 判定できない領域は出さない（0点として出すと、測っていないのに低評価に見える）
   */
  const cards: { key: string; label: string; got: number; max: number; note: string }[] = [];
  if (site) cards.push({ key: "site", label: "サイト健全性", got: site.passed, max: site.total, note: "HTTPS・ヘッダー・構造化データ" });
  if (meo?.self)
    cards.push({
      key: "meo",
      label: "MEO",
      got: meo.score,
      max: 100,
      note:
        meo.stores.length > 1
          ? `${meo.stores.length}店舗を検出（下の一覧に店舗ごとの点数）`
          : meo.totalShops > 1
            ? `近隣${meo.totalShops}店中 レビュー${meo.reviewRank}位`
            : "近隣に比較できる同業が見つかりませんでした",
    });
  if (adOps?.done) {
    const need = adOps.tags.filter((t) => t.need === "必須");
    const ok = need.filter((t) => t.status === "導入済み").length;
    cards.push({ key: "ads", label: "広告の準備", got: ok, max: need.length, note: `必須タグ ${ok}/${need.length} 導入済み` });
  }
  if (seo) cards.push({ key: "seo", label: "SEO強度", got: seo.score, max: 100, note: seo.label });
  const pct = (c: { got: number; max: number }) => (c.max > 0 ? Math.round((c.got / c.max) * 100) : 0);
  const total = cards.length ? Math.round(cards.reduce((n, c) => n + pct(c), 0) / cards.length) : null;

  /**
   * バナーに載せる「何屋か」。ブランド名だけでは何の広告か伝わらない。
   * 商材の説明文から、記号より前の短い塊だけを取る（AIに書かせない）
   */
  /*** バナー下部に並べる事実。強�みから数字を機械的に抜く */
  const bannerFacts = pickFacts(d.strengths);

  const service = (d.product.split(/[。、（(]/)[0] ?? "").trim().slice(0, 14) || INDUSTRY_LABEL[d.industry];

  /** その原稿に付いた法令の指摘。無ければ null */
  const flagOf = (t: string) => adOps?.flagged?.find((f) => f.text === t) ?? null;

  /**
   * 写真の文字チェックが丸ごと失敗したか（AI呼び出しエラー・全画像の取得失敗など）。
   * 候補画像が1枚もあるのに判定結果が0件なら、個別の画像が未判定なのではなく
   * チェック自体が動かなかったとみなす。この場合に「未判定は安全側で除外」を適用すると
   * 写真が一枚も出せなくなるため、下の候補フィルターで判定を丸ごとスキップする
   */
  const checkUnavailable = (site?.images?.length ?? 0) > 0 && (imageScan?.items.length ?? 0) === 0;

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

      {cards.length > 0 && (
        <div className="scorecard">
          {total !== null && (
            <div className="tot">
              <span className="lb">総合</span>
              <b>{total}<i>/100</i></b>
              <span className="nt">実測できた{cards.length}領域の平均</span>
            </div>
          )}
          <div className="cs">
            {cards.map((c) => {
              const p = pct(c);
              const tone = p >= 75 ? "ok" : p >= 50 ? "warn" : "ng";
              return (
                <div className={`c ${tone}`} key={c.key}>
                  <span className="lb">{c.label}</span>
                  <b>{c.got}<i>/{c.max}</i></b>
                  <div className="tr"><i style={{ width: `${p}%` }} /></div>
                  <span className="nt">{c.note}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="tabs">
        <button className={tab === "inputs" ? "on" : ""} onClick={() => setTab("inputs")}>入力</button>
        {kpi && <button className={tab === "measures" ? "on" : ""} onClick={() => setTab("measures")}>施策</button>}
        <button className={tab === "overview" ? "on" : ""} onClick={() => setTab("overview")}>分析データ</button>
      </div>

      {tab === "inputs" && (
        <Inputs
          id={id}
          url={url}
          site={site}
          budget={budget}
          margin={margin}
          onBudget={pickBudget}
          onMargin={pickMargin}
          extra={extraInputs}
          hasGoogle={!!(gsc || ga4)}
          social={social}
        />
      )}

      {tab === "measures" && kpi && (
        <Measures
          id={id}
          kpi={kpi}
          measures={measures ?? []}
          selected={kpiSelected ?? []}
          done={measuresDone ?? []}
          log={measureLog ?? []}
          hygiene={hygiene(site)}
        />
      )}

      {tab === "overview" && <Toc watch={tab} />}

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
              <div className="sub">優先度の高い順に、今週から始めら备るものです</div>
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
            <span className="ic">�M</span>
            <div>
              <h2 id="sec-social">公式SNSアカウン�