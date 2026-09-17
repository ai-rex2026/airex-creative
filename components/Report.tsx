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
  const chosenSizes = SIZES.filter((s) => sizes.in