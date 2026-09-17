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
 * ã€Œåˆ‡ã‚ŠæŠœãã€è¡¨ç¤ºã®ã¨ãã€æ¨ªãƒ»ç¸¦ã©ã¡ã‚‰ã®ä½ç½®ã‚¹ãƒ©ã‚¤ãƒ€ãƒ¼ãŒå®Ÿéš›ã«åŠ¹ãã‹ã‚’åˆ¤å®šã™ã‚‹ã€‚
 * Banner.tsx ã®æ ã‚µã‚¤ã‚ºè¨ˆç®—ï¼ˆphotoTop/photoSideãƒ»photoShareï¼‰ã‚’ã“ã“ã§ã‚‚å†ç¾ã—ã€
 * object-fit: cover ã§ã¯ã¿å‡ºã™è»¸ï¼ˆï¼å‹•ã‹ã—ã¦æ„å‘³ãŒã‚ã‚‹è»¸ï¼‰ã ã‘ã‚’ true ã«ã™ã‚‹ã€‚
 * ã©ã¡ã‚‰ã‚‚ã¯ã¿å‡ºã•ãªã„å ´åˆã‚„ã€å››æ¨äº”å…¥ã§èª¤å·®ãŒå‡ºã‚‹å ´åˆã‚’è€ƒãˆã€1pxæœªæº€ã¯ã€ŒåŠ¹ã‹ãªã„ã€æ‰±ã„ã«ã™ã‚‹
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
  // ä¸»åŠ›å•†æã¯æŠ¼ã—æ›¿ãˆã‚‰ã‚Œã‚‹ã€‚è‡ªå‹•ã§æ‹¾ã£ãŸä¾¡æ ¼ãŒå®Ÿéš›ã®ä¸»åŠ›ã¨ãšã‚Œã‚‹ã“ã¨ãŒã‚ã‚‹
  const [pricing, setPricing] = useState(initialPricing);
  // ãƒãƒŠãƒ¼ã«è¼‰ã›ã‚‹å†™çœŸã€‚ã‚µã‚¤ãƒˆã‹ã‚‰æ‹¾ã£ãŸã‚‚ã®ã ã‘ã‚’ä½¿ã†ï¼ˆç”Ÿæˆç”»åƒã¯ä½¿ã‚ãªã„ï¼‰
  const [photo, setPhoto] = useState<string | null>(null);
  // æ–‡å­—å…¥ã‚Šã®ç”»åƒã¯åˆ‡ã‚ŠæŠœãã¨è¦‹åˆ‡ã‚Œã‚‹ã®ã§ã€åˆ‡ã‚Šæ–¹ã¨ä½ç½®ã‚’é¸ã¹ã‚‹ã‚ˆã†ã«ã™ã‚‹
  const [photoFit, setPhotoFit] = useState<"cover" | "contain">("cover");
  const [photoFocus, setPhotoFocus] = useState({ x: 50, y: 50 });
  const [showTexted, setShowTexted] = useState(false);
  // æ–‡å­—å…¥ã‚Šç”»åƒã‚’é¸ã‚“ã ã¨ãã€æ–‡å­—ã‚’å«ã¾ãªã„é ˜åŸŸã ã‘ã‚’åˆ‡ã‚Šå‡ºã—ãŸçµæœï¼ˆdata URLï¼‰
  const [croppedSrc, setCroppedSrc] = useState<string | null>(null);
  const [cropBusy, setCropBusy] = useState(false);
  const [cropError, setCropError] = useState<string | null>(null);
  const photoSrc = croppedSrc ?? (photo ? `/api/analysis/${id}/img?u=${encodeURIComponent(photo)}` : null);
  // ä½ç½®ã‚¹ãƒ©ã‚¤ãƒ€ãƒ¼ãŒå®Ÿéš›ã«åŠ¹ãã‹ã¯ã€å†™çœŸã®ç¸¦æ¨ªæ¯”ã¨æ ã®ç¸¦æ¨ªæ¯”ã®çµ„ã¿åˆã‚ã›ã§æ±ºã¾ã‚‹
  // ï¼ˆobject-fit: cover ã®æ€§è³ªä¸Šã€ã¯ã¿å‡ºã•ãªã„è»¸ã¯å‹•ã‹ã—ã¦ã‚‚å¤‰åŒ–ã—ãªã„ï¼‰ã€‚
  // åˆ¤å®šã«ã¯å…ƒç”»åƒã®å®Ÿã‚µã‚¤ã‚ºãŒè¦ã‚‹ã®ã§ã€é¸ã°ã‚ŒãŸç¬é–“ã«èª­ã¿è¾¼ã‚“ã§ãŠã
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
   * å†™çœŸå€™è£œã‚’é¸ã¶ã€‚æ–‡å­—ãŒå†™ã‚Šè¾¼ã‚“ã§ã„ã¦ã‚‚ safeCropï¼ˆæ–‡å­—ã‚’å«ã¾ãªã„é ˜åŸŸï¼‰ãŒ
   * å–ã‚Œã¦ã„ã‚‹ç”»åƒãªã‚‰ã€é¸ã‚“ã ç¬é–“ã«ãã®é ˜åŸŸã ã‘ã‚’åˆ‡ã‚Šå‡ºã—ã¦ä½¿ã†ã€‚
   * ã“ã†ã™ã‚‹ã¨ã€è¡¨ç¤ºä½ç½®ã‚’ã©ã†å‹•ã‹ã—ã¦ã‚‚æ–‡å­—ãŒå…¥ã‚Šè¾¼ã¾ãªã„ã“ã¨ã‚’ä¿è¨¼ã§ãã‚‹
   * ï¼ˆposition ã‚’ãšã‚‰ã—ã¦é¿ã‘ã‚‹ã‚„ã‚Šæ–¹ã¯ã€æ–‡å­—ãŒåºƒãå…¥ã£ãŸç”»åƒã§ã¯æˆç«‹ã—ãªã„ãŸã‚ï¼‰
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
        setCropError("ã“ã®å†™çœŸã®è‡ªå‹•ãƒˆãƒªãƒŸãƒ³ã‚°ã«å¤±æ•—ã—ã¾ã—ãŸã€‚ãŠæ‰‹æ•°ã§ã™ãŒä»–ã®å†™çœŸã‚’ãŠé¸ã³ãã ã•ã„ã€‚");
      } finally {
        setCropBusy(false);
      }
    } else {
      setCroppedSrc(null);
    }
  }

  // ç²—åˆ©ç‡ã¯æ–­å®šã§ããªã„ã®ã§ã€æŠ¼ã—ãŸç¬é–“ã«è¨ˆç®—ã—ç›´ã—ã¦è£ã§ä¿å­˜ã™ã‚‹
  function pickMargin(m: number) {
    setMarginState(m);
    void setMargin(id, m).catch(() => {});
  }

  // äºˆç®—ã¯é…åˆ†%ã‚’å®Ÿé¡ã«ç›´ã™ã ã‘ãªã®ã§ã€é¸ã‚“ã ç¬é–“ã«ç”»é¢ã¸åæ˜ ã—ã¦è£ã§ä¿å­˜ã™ã‚‹
  function pickBudget(b: BudgetBand | null) {
    setBudgetState(b);
    void setBudget(id, b).catch(() => {});
  }

  // äºˆç®—ã«å¯¾ã—ã¦åª’ä½“ãŒå¤šã™ãã‚‹ã¨ã€ã©ã®åª’ä½“ã‚‚ãƒ‡ãƒ¼ã‚¿ãŒæºœã¾ã‚‰ãšåˆ¤æ–­ã§ããªããªã‚‹
  const band = budgetOf(budget);
  const thin = band
    ? (plan ?? []).filter((m) => Math.round((band.min * m.share) / 100) < 10)
    : [];

  /**
   * 4é ˜åŸŸã®ã‚¹ã‚³ã‚¢ã€‚ã™ã¹ã¦å®Ÿæ¸¬æ¸ˆã¿ã®å€¤ã‹ã‚‰çµ„ã‚€ã€‚
   * åˆ¤å®šã§ããªã„é ˜åŸŸã¯å‡ºã•ãªã„ï¼ˆ0ç‚¹ã¨ã—ã¦å‡ºã™ã¨ã€æ¸¬ã£ã¦ã„ãªã„ã®ã«ä½è©•ä¾¡ã«è¦‹ãˆã‚‹ï¼‰
   */
  const cards: { key: string; label: string; got: number; max: number; note: string }[] = [];
  if (site) cards.push({ key: "site", label: "ã‚µã‚¤ãƒˆå¥å…¨æ€§", got: site.passed, max: site.total, note: "HTTPSãƒ»ãƒ˜ãƒƒãƒ€ãƒ¼ãƒ»æ§‹é€ åŒ–ãƒ‡ãƒ¼ã‚¿" });
  if (meo?.self)
    cards.push({
      key: "meo",
      label: "MEO",
      got: meo.score,
      max: 100,
      note:
        meo.stores.length > 1
          ? `${meo.stores.length}åº—èˆ—ã‚’æ¤œå‡ºï¼ˆä¸‹ã®ä¸€è¦§ã«åº—èˆ—ã”ã¨ã®ç‚¹æ•°ï¼‰`
          : meo.totalShops > 1
            ? `è¿‘éš£${meo.totalShops}åº—ä¸­ ãƒ¬ãƒ“ãƒ¥ãƒ¼${meo.reviewRank}ä½`
            : "è¿‘éš£ã«æ¯”è¼ƒã§ãã‚‹åŒæ¥­ãŒè¦‹ã¤ã‹ã‚Šã¾ã›ã‚“ã§ã—ãŸ",
    });
  if (adOps?.done) {
    const need = adOps.tags.filter((t) => t.need === "å¿…é ˆ");
    const ok = need.filter((t) => t.status === "å°å…¥æ¸ˆã¿").length;
    cards.push({ key: "ads", label: "åºƒå‘Šã®æº–å‚™", got: ok, max: need.length, note: `å¿…é ˆã‚¿ã‚° ${ok}/${need.length} å°å…¥æ¸ˆã¿` });
  }
  if (seo) cards.push({ key: "seo", label: "SEOå¼·åº¦", got: seo.score, max: 100, note: seo.label });
  const pct = (c: { got: number; max: number }) => (c.max > 0 ? Math.round((c.got / c.max) * 100) : 0);
  const total = cards.length ? Math.round(cards.reduce((n, c) => n + pct(c), 0) / cards.length) : null;

  /**
   * ãƒãƒŠãƒ¼ã«è¼‰ã›ã‚‹ã€Œä½•å±‹ã‹ã€ã€‚ãƒ–ãƒ©ãƒ³ãƒ‰åã ã‘ã§ã¯ä½•ã®åºƒå‘Šã‹ä¼ã‚ã‚‰ãªã„ã€‚
   * å•†æã®èª¬æ˜æ–‡ã‹ã‚‰ã€è¨˜å·ã‚ˆã‚Šå‰ã®çŸ­ã„å¡Šã ã‘ã‚’å–ã‚‹ï¼ˆAIã«æ›¸ã‹ã›ãªã„ï¼‰
   */
  /** ãƒãƒŠãƒ¼ä¸‹éƒ¨ã«ä¸¦ã¹ã‚‹äº‹å®Ÿã€‚å¼·ã¿ã‹ã‚‰æ•°å­—ã‚’æ©Ÿæ¢°çš„ã«æŠœã */
  const bannerFacts = pickFacts(d.strengths);

  const service = (d.product.split(/[ã€‚ã€ï¼ˆ(]/)[0] ?? "").trim().slice(0, 14) || INDUSTRY_LABEL[d.industry];

  /** ãã®åŸç¨¿ã«ä»˜ã„ãŸæ³•ä»¤ã®æŒ‡æ‘˜ã€‚ç„¡ã‘ã‚Œã° null */
  const flagOf = (t: string) => adOps?.flagged?.find((f) => f.text === t) ?? null;

  /**
   * å†™çœŸã®æ–‡å­—ãƒã‚§ãƒƒã‚¯ãŒä¸¸ã”ã¨å¤±æ•—ã—ãŸã‹ï¼ˆAIå‘¼ã³å‡ºã—ã‚¨ãƒ©ãƒ¼ãƒ»å…¨ç”»åƒã®å–å¾—å¤±æ•—ãªã©ï¼‰ã€‚
   * å€™è£œç”»åƒãŒ1æšã‚‚ã‚ã‚‹ã®ã«åˆ¤å®šçµæœãŒ0ä»¶ãªã‚‰ã€å€‹åˆ¥ã®ç”»åƒãŒæœªåˆ¤å®šãªã®ã§ã¯ãªã
   * ãƒã‚§ãƒƒã‚¯è‡ªä½“ãŒå‹•ã‹ãªã‹ã£ãŸã¨ã¿ãªã™ã€‚ã“ã®å ´åˆã«ã€Œæœªåˆ¤å®šã¯å®‰å…¨å´ã§é™¤å¤–ã€ã‚’é©ç”¨ã™ã‚‹ã¨
   * å†™çœŸãŒä¸€æšã‚‚å‡ºã›ãªããªã‚‹ãŸã‚ã€ä¸‹ã®å€™è£œãƒ•ã‚£ãƒ«ã‚¿ãƒ¼ã§åˆ¤å®šã‚’ä¸¸ã”ã¨ã‚¹ã‚­ãƒƒãƒ—ã™ã‚‹
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
        <a className="icon-btn" href="/analysis">â†</a>
        <div className="right">
          <button
            className="icon-btn"
            onClick={() => {
              // ç•³ã‚“ã æŒ‡æ‘˜ãŒé–‰ã˜ãŸã¾ã¾å°åˆ·ã•ã‚Œã‚‹ã¨ä¸èº«ãè½ã¡ã‚‹ã®ã§ã€å…ˆã«å…¨éƒ¨é–‹ã
              document.querySelectorAll("details.flags").forEach((d) => ((d as HTMLDetailsElement).open = true));
              window.print();
            }}
          >
            â¤“ PDFå‡ºåŠ›
          </button>
        </div>
      </div>

      <div className="rep-hero">
        {url && <div className="u">{url}</div>}
        <h2>{url ? url.replace(/^https?:\/\//, "").replace(/\/$/, "") : "å…¥åŠ»ãƒ†ã‚­ã‚¹ãƒˆã‹ã‚‰åˆ†æ"}</h2>
      </div>

      {cards.length > 0 && (
        <div className="scorecard">
          {total !== null && (
            <div className="tot">
              <span className="lb">ç·åˆ</span>
              <b>{total}<i>/100</i></b>
              <span className="nt">å®Ÿæ®/ã™ã‚ŒãŸ{cards.length}é ˜åŸŸã®å¹³å‡</span>
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
        <button className={tab === "inputs" ? "on" : ""} onClick={() => setTab("inputs")}>å…¥åŠ¼</button>
        {kpi && <button className={tab === "measures" ? "on" : ""} onClick={() => setTab("measures")}>æ–½ç­¶</button>}
        <button className={tab === "overview" ? "on" : ""} onClick={() => setTab("overview")}>åˆ†æãƒ‡ãƒ¼ã‚¿</button>
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
            <span className="ic">â‡„</span>
            <div>
              <h2 id="sec-linked">è¿“æƒ´ãƒ‡ãƒ¼ã‚¿</h2>
              <div className="sub">Search Console / GA4 ã®å®Ÿãƒ‡ãƒ¼ã‚¿ã§ã™ï¼ˆæ¨å®šã§ã¯ã‚ã‚Šã¾ã›ã‚“ï¼‰</div>
            </div>
            <span className="rule" />
          </div>

          <div className="linked measure">
            {gsc && gsc.queries.length > 0 && (
              <div className="k">
                <div className="h">Search Console<span className="live">å®Ÿãƒ‡ãƒ¼ã‚¿</span></div>
                <div className="b">
                  <div className="big">
                    <div><b>{gsc.totals.clicks.toLocaleString()}</b><small>ã‚¯ãƒªãƒƒã‚¯ï¼ˆ28æ—¥ï¼‰</small></div>
                    <div><b>{gsc.totals.impressions.toLocaleString()}</b><small>è¡¨ç¤ºå›æ•°</small></div>
                    <div><b>{gsc.totals.position}</b><small>å¹³å‡æ²è¼‰é †ä½</small></div>
                  </div>
                  <table>
                    <thead><tr><th>æ¤œç´¢èª</th><th style={{ textAlign: "right" }}>ã‚¯ãƒªãƒƒã‚¯</th><th style={{ textAlign: "right" }}>é †ä½</th></tr></thead>
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
                <div className="h">Google Analytics 4<span className="live">å®Ÿãƒ‡ãƒ¼ã‚¿</span></div>
                <div className="b">
                  <div className="big">
                    <div><b>{ga4.sessions.toLocaleString()}</b><small>ã‚»ãƒƒã‚·ãƒ§ãƒ³ï¼ˆ28æ—¥ï¼‰</small></div>
                    <div><b>{ga4.users.toLocaleString()}</b><small>ãƒ¦ãƒ¼ã‚¶ãƒ¼</small></div>
                  </div>
                  <table>
                    <thead><tr><th>æµå…¥ãƒãƒ£ãƒãƒ«</th><th style={{ textAlign: "right" }}>ã‚»ãƒƒã‚·ãƒ§ãƒ³</th></tr></thead>
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
            <span className="ic">á </span>
            <div>
              <h2 id="sec-first">å¾Ÿã‚ã‚„ã‚‹ã“ã¨3ã¤</h2>
              <div className="sub">å„ªå…ˆåº¦ã®é«˜ã„é †ã«ã€ä»Šé€±ã‹ã‚‰å§‹ã‚ã‚‰å¤‡ã‚‹ã‚‚ã®ã§ã™</div>
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
                    <dt>æœŸé™</dt><dd>{f.due}</dd>
                    <dt>å®Œäº†æ¡ä»¶</dt><dd className="done">{f.done}</dd>
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
            <span className="ic">á˜</span>
            <div>
              <h2 id="sec-persona">ãŠå®¢æ§˜åƒ</h2>
              <div className="sub">ã“ã®äººãŸã¡ã«å‘ã‘ã¦ã‚³ãƒ”ãƒ¼ã‚’æ›¸ã„ã¦ã„ã¾ã™</div>
            </div>
            <span className="rule" />
          </div>
          <div className="grid2 measure">
            {summary.personas.map((p, i) => (
              <div className="persona" key={i}>
                <b>{p.name}</b>
                <dl>
                  <dt>ã©ã‚“ãªäºº</dt><dd>{p.who}</dd>
                  <dt>å›°ã‚Šã”ã¨</dt><dd>{p.pain}</dd>
                  <dt>å‹•ãç¬é–“</dt><dd>{p.trigger}</dd>
                </dl>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="sec-head">
        <span className="ic">â—</span>
        <div>
          <h2 id="sec-overview">ã‚µã‚¤ãƒˆæ¦‚è¦</h2>
          <div className="sub">ä½•ã‚’ã€èª°ã«å£²ã£ã¦ã„ã‚‹ã‹</div>
        </div>
        <span className="rule" />
      </div>

      <div className="card measure">
        <div className="label">å•†æ</div>
        <p style={{ fontSize: 14, marginTop: 4 }}>{d.product}</p>
        <div className="label" style={{ marginTop: 16 }}>ã‚¿ãƒ¼ã‚²ãƒƒãƒˆ</div>
        <p style={{ fontSize: 14, marginTop: 4 }}>{d.audience}</p>
        <div className="chips">
          <span className="chip-s">æ¥­ç¨® {INDUSTRY_LABEL[d.industry]}</span>
          <span className="chip-s">
            <span style={{ width: 10, height: 10, borderRadius: 3, background: d.brand.accent, display: "inline-block" }} />
            ãƒ–ãƒ©ãƒ³ãƒ‰è‰² {d.brand.accent}
          </span>
          <span className="chip-s">è¨´æ±‚è»¸ {d.angles.length}æœ¬</span>
          <span className="chip-s">ã‚³ãƒ”ãƒ¼ {copies.length}æ¡ˆ</span>
        </div>
      </div>

      {site && (
        <>
          <div className="chips">
            <span className="chip-s">{site.https ? "HTTPS å¯¾å¿œæ¸ˆã¿" : "HTTPS æœªå¯¾å¿œ"}</span>
            <span className="chip-s">robots.txt {site.robotsTxt ? "æœ‰ã‚Š" : "ç„¡ã—"}</span>
            <span className="chip-s">sitemap.xml {site.sitemapXml ? "æœ‰ã‚Š" : "ç„¡ã—"}</span>
            <span className="chip-s">æ§‹é€ åŒ–ãƒ‡ãƒ¼ã‚¿ {site.structuredData ? "æœ‰ã‚Š" : "ç„¡ã—"}</span>
            <span className="chip-s">å†…éƒ¨ãƒªãƒ³ã‚¯ {site.internalLinks} / å¤–éƒ¨ãƒªãƒ³ã‚¯ {site.externalLinks}</span>
          </div>

          <div className="label" style={{ marginTop: 18 }}>æ¤œå‡ºã•ã‚ŒãŸåºƒå‘Šã‚¿ã‚°</div>
          <div className="chips">
            {site.adTags.length > 0 ? (
              site.adTags.map((t) => (
                <span key={t} className="chip-s" style={{ background: "#FBEDE9", borderColor: "#EFD3CA", color: "var(--ng)" }}>{t}</span>
              ))
            ) : (
              <span className="chip-s">
                {site.tech.includes("Google Tag Manager")
                  ? "HTMLã‹ã‚‰ã¯æ¤œå‡ºã§ããšï¼ˆGTMçµŒç”±ã®å¯èƒ½æ€§ã‚ã‚Šï¼‰"
                  : "æ¤œå‡ºã§ããš"}
              </span>
            )}
          </div>

          {site.tech.length > 0 && (
            <>
              <div className="label" style={{ marginTop: 14 }}>ä½¿ç”¨æŠ€è¡“</div>
              <div className="chips">
                {site.tech.map((t) => <span key={t} className="chip-s">{t}</span>)}
              </div>
            </>
          )}
        </>
      )}

      <div className="stat-row" style={{ marginTop: 14 }}>
        <div><b>{d.strengths.length}</b><small>å¼·ã¿</small></div>
        <div><b>{d.objections.length}</b><small>è²·ã‚ãªã„ç†ç”±</small></div>
        <div><b>{d.angles.length}</b><small>è¨´æ±‚è»¸</small></div>
        <div><b>{copies.filter((c) => c.guard?.level === "green").length}/{copies.length}</b><small>æ³•ä»¤ãƒã‚§ãƒƒã‚¯é€šé</small></div>
      </div>

      {site && site.social.length > 0 && (
        <>
          <div className="sec-head">
            <span className="ic">â—M</span>
            <div>
              <h2 id="sec-social">å…¬å¼SNSã‚¢ã‚«ã‚¦ãƒ³ããƒˆã‚’å®Ÿéš›ã«è¦‹ã¦å®Ÿéš›ã«è¡Œã£ã¦æ¸¬ã£ã¦ã„ã¾ã™</div>
            </div>
            <span className="rule" />
          </div>
          <div className="rows measure">
            {site.social.map((x, i) => {
              const m = social?.accounts.find((a) => a.url === x.url);
              return (
                <div className="r" key={i}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <b>{x.platform}</b>
                    <small>{m?.title ?? x.handle}</small>
                    {m?.reason && <small className="warn">{m.reason}</small>}
                  </div>
                  {m?.followers != null && (
                    <span className="tag ok">
                      {/youtube/i.test(x.platform) ? "ç™»éŒ²è€…" : "ãƒ•ã‚©ãƒ­ãƒ¯ãƒ¼"} {m.followers.toLocaleString()}
                    </span>
                  )}
                  {m?.posts != null && (
                    <span className="tag">{/youtube/i.test(x.platform) ? "å‹•ç”»" : "æŠ•ç¨¿"} {m.posts.toLocaleString()}</span>
                  )}
                  {m?.views != null && <span className="tag">å†ç”Ÿ {m.views.toLocaleString()}</span>}
                  {m?.via && <span className="tag">{m.via}</span>}
                  <a className="tag" href={x.url} target="_blank" rel="noreferrer noopener">é–‹ã</a>
                </div>
              );
            })}
          </div>
          <div className="note">
            <i className="i">i</i>
            <span>
              YouTube ã¯å…¬å¼APIã‹ã‚‰å–å¾—ã—ã¦ã„ã¾ã™ï¼ˆç›¸æ‰‹ã®ã‚¢ã‚«ã‚¦ãƒ³ãƒˆã¨ã®é€£æºã¯ä¸è¦ã§ã™ï¼‰ã€‚
              ãã‚Œä»¥å¤–ã¯å…¬é–‹ãƒ‰ãƒ¼ã‚¶ã§ã¯è¡„ã‚·ã‚™ã‚ŒãŸã‚‚ã®ã ã‘ã‚’å‡ºã—ã¦ã„ã¾ã›ã‚“
              åª’ä½“ãŒãƒ­ã‚°ã‚¤ãƒ³ã‚’æ±‚ã‚ã‚‹å ´åˆã¯å–å¾—ã§ãã¾ã›ã‚“ã€‚
              <b style={{ fontWeight: 600 }}>å–ã‚Œãªã‹ã£ãŸæ•°å­—ã¯æ¨æ¸¬ã§åŸ…ã‚ã¦ã„ã¾ã›ã‚“</b>
              å–å¾—ã§ããŸæ•°å€¤ã¯æ–½ç­¶ã®ç”Ÿæˆã«ã‚‚æ¸¡ã—ã¦ã„ã¦ã€ã™ã§ã«é‹ç”¨ã—ã¦ã„ã‚‹ãƒ›ã‚’
              ã€Œæ–°ã—ãé–‹è¨­ã™ã‚‹ã€æ–½ç­¶ã¨ã—ã¦ã¯å‡ºã—ã¾ã›ã‚“ã€‚
            </span>
          </div>
        </>
      )}

      {site && (
        <>
          <div className="sec-head">
            <span className="ic">ã›¨</span>
            <div>
              <h2 id="sec-security">ã‚»ã‚­ãƒ¥ãƒªãƒ†ã‚£ãƒ˜ãƒƒãƒ€ãƒ¼</h2>
              <div className="sub">ã‚»ã‚­ãƒ¥ãƒªãƒ†ã‚£ãƒ˜ãƒƒãƒ€ãƒ¼æ¤œæŸ»çµæœ</div>
            </div>
            <span className="rule" />
          </div>

          <div className="score">
            <div style={{ textAlign: "center" }}>
              <div className="n">{site.passed}</div>
              <div className="of">/ {site.total} é€šé</div>
              <span className={`tag ${site.passed >= 8 ? "ok" : site.passed >= 5 ? "warn" : "ng"}`} style={{ marginTop: 8 }}>
                {site.passed >= 8 ? "è‰¯å¥½" : site.passed >= 5 ? "è¦ç¢ºèª" : "è¦å¯¾å¿œ"}
              </span>
            </div>
            <div className="body">
              <div className="bar"><span style={{ width: `${(site.passed / site.total) * 100}%` }} /></div>
              <p>HTTPSãƒ»ã‚»ã‚­ãƒ¥ãƒªãƒ†ã‚£ãƒ˜ãƒƒãƒ€ãƒ»ãƒ»robots.txtãƒ»sitemap.xmlãƒ»ç§¨é€ åŒ–ãƒ‡ãƒ¼ã‚¿ã®è¨­å®šçŠ¶æ³ã‚’å®Ÿéš›ã«å–å¾—ã—ã¦èª¯ã¹ã¾ã—ãŸã€‚</p>
            </div>
          </div>

          <div className="rows">
            <div className="rh">ã‚»ã‚­ãƒ¥ãƒªãƒ†ã‚£ãƒ˜ãƒƒãƒ€ãƒ¼</div>
            {site.headers.map((h) => (
              <div className="r" key={h.key}>
                <span className="st" style={{ color: h.pass ? "var(--ok)" : "var(--ng)" }}>{h.pass ? "âœ“" : "âœ•"}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <b>{h.label}</b>
                  <small>{h.desc}</small>
                  {h.value && (
                    <code style={{ display: "block", fontSize: 11.5, color: "var(--muted)", marginTop: 4, wordBreak: "break-all" }}>
                      {h.value.slice(0, 120)}
                    </code>
              )}
                </div>
                <span className={`pill ${h.pass ? "ok" : "ng"}`}>{h.pass ? "é€šé" : "è¦å¯¾å¿œ"}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {seo && site && (
        <>
          <div className="sec-head">
            <span className="ic">â›“</span>
            <div style={{ display: "flex", alignItems: "center" }}>
              <div>
                <h2 id="sec-seo">ãƒãƒ¡ã‚¤ãƒ³ãƒ‘ãƒ¼ã‚¯ï¼ˆSEOå¼·åº¦ï¼‰</h2>
                <div className="sub">æ¨å®šã‚¹ã‚³ã‚¢</div>
              </div>
              <span className="ai">AIæ¨å®š</span>
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
            <div><b>{site.internalLinks}</b><small>å†…éƒ¨ãƒªãƒ³ã‚¯æ•°</small></div>
            <div><b>{site.externalLinks}</b><small>å¤–éƒ¨ãƒªãƒ³ã‚¯æ•°</small></div>
            <div><b>â€”</b><small>è¢«ãƒªãƒ³ã‚¯æ•°ï¼ˆæœªå–å¾—ï¼‰</small></div>
            <div><b>â€”</b><small>å‚ç…§ãƒ‰ãƒ¡ã‚¤ãƒ³æ•°ï¼ˆæœªå–å¾—ï¼‰</small></div>
          </div>

          <div className="note">
            <i className="i">i</i>
            <span>
              ã‚µã‚³ã‚¢ã¯ã€ãã®å ´ã§å–å¾—ã—ãŸæŒ‡æ¨™ï¼ˆHTTPSãƒ»ã†cxàæ87Ààè8àï8àîøà­xà©8àâ8àç¸ààøàåøàîù©âú`(9c%¸àáøàï8à¯øàîùa¡z`ê8àê¸àìøà«ÊBˆ8àh8àdxàbøà¢yaî¸àeøàgÏˆİ[O^ŞÈ›ÛÙZYÚˆŒ_O¹£ª9k¦¹`)Ø¸àiøàfxà º(ªøàê¸àìøà«ù¥l8àj9cà¹áiøàâxàèxà©8àìù¥l8àkùi%º`ê8àáøàï8à¯øàc9oáz) xàj¸àgøà ycå¹o¥øàeøài¸àa8ào¸àføà¤øà ‚ˆÜÜ[‚ˆÙ]‚ˆÏ‚ˆ
_B‚ˆÏ‚ˆ
_B‚ˆİXˆOOH›İ™\šY]Èˆ	‰ˆ
ˆ‚ˆØÛÛ\]]ÜœÈ	‰ˆ
ˆ‚ˆ]ˆÛ\ÜÓ˜[YOHœÙXËZXYˆİ[O^ŞÈX\™Ú[•Üˆ_O‚ˆÜ[ˆÛ\ÜÓ˜[YOHšXÈ¸¢¥OÜÜ[‚ˆ]‚ˆˆYHœÙXËXÛÛ\¹êí¹d"8à­xà©8àâ9«å:/ ÏÚ‚ˆ]ˆÛ\ÜÓ˜[YOHœİXˆ¹k§úf¦øàjù©'9í(¸àeøài¸à y."¹/cxàjùaî¸ài¸àa8àgøà­xà©8àâ8àiøàfOÙ]‚ˆÙ]‚ˆÜ[ˆÛ\ÜÓ˜[YOHœ[HˆÏ‚ˆÙ]‚‚ˆØÛÛ\]]ÜœËš][\Ë›[™İOOHÈ
ˆ]ˆÛ\ÜÓ˜[YOH˜Ø\™YX\İ\™H‚ˆİ[O^ŞÈ›ÛÚ^™NˆLËKÛÛÜˆ˜\ŠK[]]Y
Hˆ_O‚ˆ9©'9í(¹íd9§§8à¤¹cå¹o¥øàiøàcxào¸àføà¤øàiøàeøàgøà ¹a£yb!¹§¤8àfxà¢øàj9cå¸à¢¹æí8àeøào¸àfxà ‚ˆÜ‚ˆÙ]‚ˆ
Hˆ
ˆ‚ˆ]ˆÛ\ÜÓ˜[YOHœ›İÜÈÛÛ\YX\İ\™H‚ˆ]ˆÛ\ÜÓ˜[YOHœš‚ˆ9."¹/cxàjùaî¸ài¸àa8àgøà­xà©8àâˆÜ[ˆÛ\ÜÓ˜[YOHš[¹©'9í(º*§»ï&ØÛÛ\]]ÜœËšÙ^]ÛÜ™Ëš›Ú[ŠˆÈŠ_OÜÜ[‚ˆÙ]‚ˆØÛÛ\]]ÜœËš][\Ë›X\

ËJHOˆ
ˆ]ˆÛ\ÜÓ˜[YOHœˆˆÙ^O^Ú_O‚ˆÜ[ˆÛ\ÜÓ˜[YOHœšÈØËœ˜[šßOÜÜ[‚ˆ]ˆÛ\ÜÓ˜[YOH˜ˆ‚ˆØË›˜[Y_OØ‚ˆÜ[ˆÛ\ÜÓ˜[YOHHØË\›OÜÜ[‚ˆÜ[ˆÛ\ÜÓ˜[YOH›ˆØË››İ_OÜÜ[‚ˆÙ]‚ˆÜ[ˆÛ\ÜÓ˜[YOHšİÈØËšÙ^]ÛÜ™OÜÜ[‚ˆÙ]‚ˆ
J_BˆÙ]‚ˆ]ˆÛ\ÜÓ˜[YOH››İHYX\İ\™H‚ˆHÛ\ÜÓ˜[YOHšHšOÚO‚ˆÜ[‚ˆÛ™]È]JÛÛ\]]ÜœËœÙX\˜ÚY]
KÓØØ[Tİš[™Êš˜KR”Š_y¦`¹à®xàk¹©'9í(¹íd9§§8àiøàfxà ‚ˆ:h!¹/cxàkù©'9í(¸àfxà¢ùh-9¢`8àîùêëù§*øàîù¦`¹§'øàiùi"xà£øà¢¸ào¸àfxà ‚ˆˆİ[O^ŞÈ›ÛÙZYÚˆŒ_Oº**¹ecù¥l8à¡:hg¹//9n©¸àkùcå¹o¥øàeøài¸àj¸àa8àhxàdøàj8à Ø‚ˆÜÜ[‚ˆÙ]‚ˆÏ‚ˆ
_BˆÏ‚ˆ
_B‚ˆ]ˆÛ\ÜÓ˜[YOHœÙXËZXY‚ˆÜ[ˆÛ\ÜÓ˜[YOHšXÈ¸¥áÜÜ[‚ˆ]‚ˆˆYHœÙXË\İ™[™İ¹o-øàoøàj8à z,­øà£øàj¸àa9ä!¹å,OÚ‚ˆ]ˆÛ\ÜÓ˜[YOHœİXˆ¸àdøàdøà¤¹¯l8àfxà¬øàå8àï8àc9. 9åj¹b®xàcÏÙ]‚ˆÙ]‚ˆÜ[ˆÛ\ÜÓ˜[YOHœ[HˆÏ‚ˆÙ]‚ˆ]ˆÛ\ÜÓ˜[YOHœ›İÜÈYX\İ\™H‚ˆ]ˆÛ\ÜÓ˜[YOHœš¹o-øàoÏÙ]‚ˆÙœİ™[™İË›X\

JHOˆ
ˆ]ˆÛ\ÜÓ˜[YOHœˆˆÙ^O^Ú_OÜ[ˆÛ\ÜÓ˜[YOHœİˆİ[O^ŞÈÛÛÜˆ˜\ŠK[ÚÊHˆ_O¸§$ÏÜÜ[ˆİ[O^ŞÈ›ÛÙZYÚˆ_OİOØÙ]‚ˆ
J_BˆÙ]‚ˆ]ˆÛ\ÜÓ˜[YOHœ›İÜÈYX\İ\™H‚ˆ]ˆÛ\ÜÓ˜[YOHœšº,­øà£øàj¸àa9ä!¹å,OÙ]‚ˆÙ›Øš™Xİ[ÛœË›X\

JHOˆ
ˆ]ˆÛ\ÜÓ˜[YOHœˆˆÙ^O^Ú_OÜ[ˆÛ\ÜÓ˜[YOHœİˆİ[O^ŞÈÛÛÜˆ˜\ŠK[™ÊHˆ_O¸§%OÜÜ[ˆİ[O^ŞÈ›ÛÙZYÚˆ_OİOØÙ]‚ˆ
J_BˆÙ]‚‚ˆÜ[ˆ	‰ˆ[‹›[™İˆ	‰ˆ
ˆ‚ˆ]ˆÛ\ÜÓ˜[YOHœÙXËZXY‚ˆÜ[ˆÛ\ÜÓ˜[YOHšXÈ¸¥âÜÜ[‚ˆ]‚ˆˆYHœÙXË\[ˆ¹n ùdb¹¢bù¬åy. :)©ÏÚ‚ˆ]ˆÛ\ÜÓ˜[YOHœİXˆ¸à­xà©8àâ9b!¹§¤8à¤¸à ¸àj8àjøà y/oøàa¸ànxàcyj¤¹/døà¤¹a*¹ab:h!¹/cy.æ8àcxàiùaî¸àeøài¸àa8ào¸àfOÙ]‚ˆÙ]‚ˆÜ[ˆÛ\ÜÓ˜[YOHœ[HˆÏ‚ˆÙ]‚‚ˆ]ˆÛ\ÜÓ˜[YOH˜YÙ]YX\İ\™Hˆİ[O^ŞÈX\™Ú[•ÜˆMˆ_O‚ˆ]ˆÛ\ÜÓ˜[YOH˜š¹§":e¤ùn ùdb¹.¢9ë¥ÏÜ[¹.îù¡#ÏÜÜ[Ù]‚ˆ]ˆÛ\ÜÓ˜[YOH˜˜ˆ‚ˆĞ•QÑUË›X\

ŠHOˆ
ˆ]ÛˆÙ^O^Ø‹šYHÛ\ÜÓ˜[YO^ØYÙ]OOH‹šYÈ›ÛˆˆˆˆŸHÛÛXÚÏ^Ê
HOˆXÚĞYÙ]
YÙ]OOH‹šYÈ[ˆ‹šY
_O‚ˆØ‹›X™[BˆØ]Û‚ˆ
J_BˆÙ]‚ˆ‚ˆØYÙ]ˆÈºacyb!‰xà¤¹k§úhcxàjùæí8àeøài¸àa8ào¸àfxà ¸à ¸àa¹. 9n©¹¢¯8àfxàj:)èúfi8àiøàcxào¸àfxà ˆ‚ˆˆº`n8àm¸àj8à zacyb!‰xàc9j¤¹/døàe8àj8àk¹k§úhcxàjùi"xà£øà¢¸ào¸àfxà ¸à`¸àj8àbøà¢y/eyn©¸àiøà ¹i"xàb8à¢xà£8ào¸àfxà ˆŸBˆÜ‚ˆÙ]‚‚ˆİ[‹›[™İˆ	‰ˆ˜[™	‰ˆ
ˆ]ˆÛ\ÜÓ˜[YOH››İHØ\›ˆˆİ[O^ŞÈX\™Ú[•ÜˆLˆ_O‚ˆHÛ\ÜÓ˜[YOHšHˆOÚO‚ˆÜ[‚ˆ8àdøàk¹.¢9ë¥øàh8àjˆİ[O^ŞÈ›ÛÙZYÚˆŒ_Oİ[‹›X\

JHOˆK˜Ú[›™[
Kš›Ú[Š¸àîÈŠ_OØˆ8àcˆ9§"L9.!ùa¡¸à¤¹."ùfç¸à¢¸ào¸àfxà ¹.¢9ë¥øà¤º%¡8àcùn øàd¸à¢øàj8à xàjxàk¹j¤¹/døà`¸àáøàï8à¯øàc9®§8ào¸à¢xàfº"køàeù ª¸àeøà¤¹b)9¥«xàiøàcxào¸àføà¤øà ‚ˆ]Û‚ˆÛ\ÜÓ˜[YOH›[šØˆ‚ˆ\ØX›Y^Ü™\[›š[™ßBˆÛÛXÚÏ^Ê
HOˆÂˆÙ]™\[›š[™ÊYJNÂˆ›ÚY™\[‘›ÜYÙ]
Y˜[™šY
K˜Ø]Ú


HOˆÙ]™\[›š[™Ê˜[ÙJJNÂˆ_Bˆ‚ˆÜ™\[›š[™ÈÈ¹/g8à¢¹æí8àeøài¸àa8ào¸àfx )ˆˆˆ¸àdøàk¹.¢9ë¥øàiùj¤¹/dù©âù¢$8à¤¹/g8à¢¹æí8àfHŸBˆØ]Û‚ˆÛX[»ï"9n ùdbº`bùå*:*+z*"8à ¹/g8à¢¹æí8àfxàgøà xà y¥l9b!¸àbøàbøà¢¸ào¸àf{ï"OÜÛX[‚ˆÜÜ[‚ˆÙ]‚ˆ
_B‚ˆ]ˆÛ\ÜÓ˜[YOHœ[ˆYX\İ\™H‚ˆÜ[‹›X\

KJHOˆ
ˆ]ˆÛ\ÜÓ˜[YOHœˆÙ^O^ÛK˜Ú[›™[
È_O‚ˆ]ˆÛ\ÜÓ˜[YOHÜ‚ˆÜ[ˆÛ\ÜÓ˜[YOHšXÈ¸¥ãÜÜ[‚ˆÛK˜Ú[›™[OØ‚ˆÜ[ˆÛ\ÜÓ˜[YOHœÚ\™HÛKœÚ\™_IOÜÜ[‚ˆÜÚ\™UÖY[ŠYÙ]KœÚ\™JH	‰ˆÜ[ˆÛ\ÜÓ˜[YOHY[ˆÜÚ\™UÖY[ŠYÙ]KœÚ\™J_OÜÜ[ŸBˆÜ[ˆÛ\ÜÓ˜[YO^Ø‰ÛKœš[Üš]HOOH¹§ 9a*¹abˆÈˆÜHˆˆˆŸXOÛKœš[Üš]_OÜÜ[‚ˆÙ]‚ˆ]ˆÛ\ÜÓ˜[YOH˜›ÙH‚ˆ]ˆÛ\ÜÓ˜[YOH˜˜\ˆÜ[ˆİ[O^ŞÈÚYˆ	ÛKœÚ\™_IX_HÏÙ]‚ˆ