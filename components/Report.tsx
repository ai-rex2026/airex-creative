"use client";

import { useEffect, useState } from "react";
import type { ChangeEvent } from "react";
import { toPng } from "html-to-image";
import JSZip from "jszip";
import { runLp, setBudget, setMargin, uploadBannerImage } from "@/app/actions";
import { SIZES, type SizePreset } from "@/lib/sizes";
import type { BannerCopy, Diagnosis, GuardVerdict } from "@/lib/types";
import type { SeoEstimate, SiteScan } from "@/lib/site-scan";
import type { CompetitorScan } from "@/lib/competitors";
import type { TacticPlan } from "@/lib/tactics";
import type { SnsPlan } from "@/lib/sns-plan";
import { AdStructureTable, MissingSectionsBanner, RebuildAdPlanNote, SnsCampaignCard, SnsChannelBlock } from "./ReportExtras";
import { adWidth, type AdOps } from "@/lib/ad-ops";
import { lengthIn, limitLabel, specFor, type CountMode } from "@/lib/ad-specs";
import type { MeoScan } from "@/lib/meo";
import { meoStoreActions } from "@/lib/meo-actions";
import { MeoStoreList, MeoStoreDetail } from "./MeoStores";
import { MeoEntryCard } from "./meo/MeoEntryCard";
import { Toc } from "./Toc";
import { BANNER_CASE_WARNING, looksLikeCasePhoto } from "@/lib/case-photo";
import type { KeywordPlan, LinePlan, LpoPlan } from "@/lib/deep";
import type { SeoArticleSet } from "@/lib/seoArticles";
import { INDUSTRY_VERTICAL_LABEL, type IndustryVertical } from "@/lib/industryMatrix";
import type { OutreachPlan, SuggestScan } from "@/lib/outreach";
import { MARGIN, type PriceScan } from "@/lib/pricing";
import type { SpeedScan } from "@/lib/pagespeed";
import type { SocialScan } from "@/lib/social";
import { PLATFORM_RE, type SocialInsightPlan } from "@/lib/social-insights";
import type { ImageScan } from "@/lib/image-check";
import { pickTextZone, type TextZone } from "@/lib/overlay-position";
import type { Ga4Data, GscData } from "@/lib/google";
import type { CustomImage } from "@/lib/analysis";
import type { MediaPlanItem, Summary } from "@/lib/types";
import { BUDGETS, INDUSTRY_LABEL, budgetOf, shareToYen, type BudgetBand } from "@/lib/types";
import { Banner, pickFacts } from "./Banner";
import { ReportChat } from "./ReportChat";
import { Measures } from "./Measures";
import { Inputs } from "./Inputs";
import { hygiene } from "@/lib/measures";
import type { KpiTree } from "@/lib/kpi";
import type { Measure } from "@/lib/measures";
import { withSiteHealth, type CategoryEvaluation } from "@/lib/summary-tab";
import { PlatformIcon, normalizePlatform } from "./PlatformIcons";

type Tab = "inputs" | "summary" | "overview";

/** 「実データを使って分析している」ことを示すバッジ（セクション見出し用） */
function RealBadge({ label = "実データで分析" }: { label?: string }) {
  return (
    <span className="tag ok" style={{ marginLeft: 10, fontSize: 11, fontWeight: 500, verticalAlign: "middle" }}>
      🟢{label}
    </span>
  );
}

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

/**
 * ゲスト（未登録）向けの部分マスキング。見出し・件数などの「teaser」は呼び出し側で
 * マスクの外に普通に描画し、本文（children）だけをこのコンポーネントで覆う。
 * 既存の全面ロック（バナー/LP）で使っているCTA（文言・遷移先）をそのまま再利用する。
 */
function GuestMask({ guest, label, children }: { guest: boolean; label: string; children: React.ReactNode }) {
  if (!guest) return <>{children}</>;
  return (
    <div style={{ position: "relative", marginTop: 10 }}>
      <div
        aria-hidden="true"
        style={{
          filter: "blur(6px)",
          opacity: 0.5,
          pointerEvents: "none",
          userSelect: "none",
          maxHeight: 220,
          overflow: "hidden",
        }}
      >
        {children}
      </div>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          textAlign: "center",
          padding: 12,
        }}
      >
        <span className="lock">🔒</span>
        <p style={{ fontSize: 13, margin: 0, maxWidth: 320 }}>{label}</p>
        <a className="btn" href="/login?mode=signup">無料で会員登録して続きを見る</a>
      </div>
    </div>
  );
}

// 2026-10-04: LP生成（ベータ）はクオリティが安定しないため、依頼主の指示で一旦非表示にしている。
// 再公開するときは true に戻す。
// （注）この値をJSX側で直接 `false &&` と書くとTypeScriptの型チェックが崩れ、
// 無関係な `{lp && (...)}` のnullガードまで誤って「lpがnullかもしれない」エラーになるため、
// booleanの変数を経由させている
const LP_GENERATION_ENABLED: boolean = false;

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
  seoArticles = null,
  industryVertical = null,
  linePlan,
  suggests,
  outreach,
  pricing: initialPricing,
  speed,
  social,
  socialInsights,
  imageScan,
  customImages: initialCustomImages,
  margin: initialMargin,
  kpi,
  measures,
  categoryEvaluations,
  measuresDone,
  extraInputs,
  measureLog,
  budget: initialBudget,
  id,
  gsc,
  ga4,
  snsPlan = null,
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
  seoArticles?: SeoArticleSet | null;
  industryVertical?: IndustryVertical | null;
  linePlan: LinePlan | null;
  suggests: SuggestScan | null;
  outreach: OutreachPlan | null;
  pricing: PriceScan | null;
  speed: SpeedScan | null;
  social: SocialScan | null;
  socialInsights: SocialInsightPlan | null;
  imageScan: ImageScan | null;
  customImages: CustomImage[] | null;
  margin: number | null;
  kpi: KpiTree | null;
  measures: Measure[] | null;
  categoryEvaluations: CategoryEvaluation[] | null;
  measuresDone: string[] | null;
  extraInputs: { platform: string; url: string }[] | null;
  measureLog: { title: string; at: string }[] | null;
  budget: BudgetBand | null;
  id: string;
  gsc: GscData | null;
  ga4: Ga4Data | null;
  snsPlan?: SnsPlan | null;
}) {
  const [picked, setPicked] = useState<number[]>(copies.map((_, i) => i).slice(0, 3));
  const [sizes, setSizes] = useState<string[]>(["meta-1x1", "meta-4x5", "google-lb"]);
  const [lp, setLp] = useState<{ html: string; guard: GuardVerdict } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showAllCopies, setShowAllCopies] = useState(false);
  const [hideRed, setHideRed] = useState(false);
  const [zoom, setZoom] = useState<{ ci: number; sizeId: string } | null>(null);
  const [tab, setTab] = useState<Tab>(kpi ? "summary" : "overview");
  const [budget, setBudgetState] = useState<BudgetBand | null>(initialBudget);
  const [margin, setMarginState] = useState<number>(initialMargin ?? MARGIN[d.industry] ?? 0.4);
  // 主力商材は押し替えられる。自動で拾った価格が実際の主力とずれることがある
  const [pricing, setPricing] = useState(initialPricing);
  // バナーに載せる写真。サイトから拾ったものだけを使う（生成画像は使わない）
  const [photo, setPhoto] = useState<string | null>(null);
  // 文字入りの画像は切り抜くと見切れるので、切り方と位置を選べるようにする
  const [photoFit, setPhotoFit] = useState<"cover" | "contain">("cover");
  const [meoStoreIdx, setMeoStoreIdx] = useState(0);
  const [photoFocus, setPhotoFocus] = useState({ x: 50, y: 50 });
  // 画像とテキストを分けて並べる（split）か、画像の上にテキストを重ねる（overlay）か
  const [photoLayout, setPhotoLayout] = useState<"split" | "overlay">("split");
  // overlay のとき、テキストをどの帯に置くか。写真を選んだ瞬間に顔の位置から自動で決める
  const [photoTextZone, setPhotoTextZone] = useState<TextZone>("bottom");
  const [showTexted, setShowTexted] = useState(false);
  // 文字入り画像を選んだとき、文字を含まない領域だけを切り出した結果（data URL）
  const [croppedSrc, setCroppedSrc] = useState<string | null>(null);
  const [cropBusy, setCropBusy] = useState(false);
  const [cropError, setCropError] = useState<string | null>(null);
  // 広告主側でWebサイトに載っていない素材を使いたい場合のアップロード枠。
  // アップロード直後にも一覧へ反映したいのでローカル state も持つ
  // （サーバー側は revalidatePath するが、このコンポーネント自体はクライアント側で
  // 再マウントされないため、ローカルに足しておかないと選び直すまで出てこない）
  const [customImages, setCustomImages] = useState<CustomImage[]>(initialCustomImages ?? []);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // アップロード素材は "custom:<path>" という合成IDで他候補と区別する
  const CUSTOM_PREFIX = "custom:";
  const photoSrc = croppedSrc
    ? croppedSrc
    : photo?.startsWith(CUSTOM_PREFIX)
      ? `/api/analysis/${id}/img?c=${encodeURIComponent(photo.slice(CUSTOM_PREFIX.length))}`
      : photo
        ? `/api/analysis/${id}/img?u=${encodeURIComponent(photo)}`
        : null;
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
   * 写真候補を選ぶ。写真の切り出し（トリミング）はしない。文字が重なっていない写真を
   * 候補の先頭に並べ、そのまま使う（切り出すと被写体が欠けたり、文字が途中で切れたりするため）
   */
  async function pickPhoto(u: string) {
    setPhoto(u);
    setCropError(null);
    setCroppedSrc(null);
    const info = imageScan?.items.find((x) => x.url === u);
    // テキストを重ねる帯は、この写真の顔の位置から選び直す（無ければ定石どおり下部）
    setPhotoTextZone(pickTextZone(info?.hasFace ? info.facePosition : null));
  }

  /**
   * 広告主側でWebサイトに載っていない独自素材を使いたい場合の、画像アップロード。
   * アップロードした画像は自動の文字チェックにかけていない（利用者自身が選んだ
   * 素材のため）。アップロードが終わったら、その画像を即座に選択状態にする
   */
  async function handleUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // 同じファイルを続けて選んでも onChange が発火するようにする
    if (!file) return;
    setUploadError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const { path } = await uploadBannerImage(id, fd);
      setCustomImages((prev) => [...prev, { path, uploadedAt: new Date().toISOString() }]);
      void pickPhoto(`${CUSTOM_PREFIX}${path}`);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "アップロードに失敗しました");
    } finally {
      setUploading(false);
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

  // 2026-10-04: 予算の変更・作り直しは入力タブ（Inputs）に一本化する。
  // 「広告手法一覧」側に予算ピッカーと作り直しボタンを両方置いていたため、
  // ①変更できる場所が2つになって分かりにくい、②作り直しボタンは
  // replanForBudget（裏でAI生成。数分かかる）を呼ぶのに、完了を検知する手段が
  // 画面になく「作り直しています…」の表記が終わらない、という問題があった。
  // ここでは想定予算の表示だけに留め、変更・作り直しは入力タブへ誘導する
  function goToInputsBudget() {
    setTab("inputs");
    setTimeout(() => {
      document.getElementById("sec-budget")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

  // サマリータブの「カテゴリ別評価」カードは、分析データタブの対応セクションへの
  // ショートカット。セクションはタブ切り替えでマウントが外れるため、#アンカーの
  // <a href> では飛べない（DOMに存在しない）。goToInputsBudget と同じ要領で、
  // タブを切り替えてから対象要素が描画されるのを待ってスクロールする
  function goToOverviewSection(anchor: string) {
    setTab("overview");
    setTimeout(() => {
      document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

  // 予算に対して媒体が多すぎると、どの媒体もデータが溜まらず判断できなくなる
  const band = budgetOf(budget);
  const thin = band
    ? (plan ?? []).filter((m) => Math.round((band.min * m.share) / 100) < 10)
    : [];

  /**
   * バナーに載せる「何屋か」。ブランド名だけでは何の広告か伝わらない。
   * 商材の説明文から、記号より前の短い塊だけを取る（AIに書かせない）
   */
  /** バナー下部に並べる事実。強みから数字を機械的に抜く */
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

  // SNS関連のデータ。「どの施策カードに紐づくか」のマッチングはせず、
  // 取得できたものは全部まとめて「SNS戦略」クラスターで出す
  const siItems = socialInsights?.items ?? [];
  const snsChannels = snsPlan?.channels ?? [];

  // 「情報取得」1媒体分の行。以前はsite.socialの全件をここで直接map()していたが、
  // 媒体ごとに情報取得→分析→運用プランを束ねる構成（sec-social）に変えたため、
  // 1媒体分だけを描く関数として切り出した
  // 取得結果は URL 一致を優先し、URL が揺れていても同じ媒体の結果を拾う（バッジが消えないように）
  const hasRealData = (a?: { followers?: number | null; posts?: number | null; views?: number | null } | null) =>
    !!a && (a.followers != null || a.posts != null || a.views != null);
  const findAcct = (platform: string, url?: string) => {
    const list = social?.accounts ?? [];
    const byUrl = url ? list.find((a) => a.url === url) : undefined;
    if (byUrl && (hasRealData(byUrl) || !list.some((a) => a.platform === byUrl.platform && hasRealData(a)))) return byUrl;
    const key = normalizePlatform(platform);
    const byPf = key === "unknown" ? [] : list.filter((a) => normalizePlatform(a.platform) === key);
    return byPf.find((a) => hasRealData(a)) ?? byUrl ?? byPf[0];
  };
  const renderSocialInfoRow = (x: { platform: string; url: string; handle: string }) => {
    const m = findAcct(x.platform, x.url);
    return (
      <div className="r" key={x.url}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <PlatformIcon platform={x.platform} size={15} />
          {" "}
          <b>{x.platform}</b>
          {hasRealData(m) ? (
            <span className="tag ok" style={{ marginLeft: 6 }}>🟢実データ取得済み</span>
          ) : (
            <span className="tag" style={{ marginLeft: 6 }}>⚪データ未取得</span>
          )}
          <small>{m?.title ?? x.handle}</small>
          {m?.reason && <small className="warn">{m.reason}</small>}
          {m?.recentPosts && m.recentPosts.length > 0 && (
            <div style={{ marginTop: 6, display: "grid", gap: 4 }}>
              {m.recentPosts.slice(0, 3).map((p, j) => {
                const stats = [
                  p.likes != null ? `いいね${p.likes.toLocaleString()}` : null,
                  p.comments != null ? `コメント${p.comments.toLocaleString()}` : null,
                  p.shares != null ? `シェア${p.shares.toLocaleString()}` : null,
                  p.views != null ? `再生${p.views.toLocaleString()}` : null,
                ]
                  .filter(Boolean)
                  .join(" ・ ");
                return (
                  <small key={j} style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    {p.postedAt && <span>{p.postedAt.slice(0, 10)}</span>}
                    <span>{p.text ? (p.text.length > 50 ? `${p.text.slice(0, 50)}…` : p.text) : "（本文なし）"}</span>
                    {stats && (
                      <span className="tag ok" style={{ fontSize: 10.5, padding: "1px 8px" }}>
                        実データ：{stats}
                      </span>
                    )}
                  </small>
                );
              })}
            </div>
          )}
        </div>
        {m?.followers != null && (
          <span className="tag ok">
            {/youtube/i.test(x.platform) ? "登録者" : "フォロワー"} {m.followers.toLocaleString()}
          </span>
        )}
        {m?.posts != null && (
          <span className="tag">{/youtube/i.test(x.platform) ? "動画" : "投稿"} {m.posts.toLocaleString()}</span>
        )}
        {m?.views != null && <span className="tag">{/facebook/i.test(x.platform) ? "リーチ" : "再生"} {m.views.toLocaleString()}</span>}
        {m?.via && m.via !== "Apify" && m.via !== "Grok(xAI)" && <span className="tag">{m.via}</span>}
        <a className="tag" href={x.url} target="_blank" rel="noreferrer noopener">開く</a>
      </div>
    );
  };

  const renderSI = (si: (typeof siItems)[number]) => (
    <div key={si.platform} style={{ marginTop: 10 }}>
      <p className="eyebrow"><PlatformIcon platform={si.platform} size={14} /> {si.platform}の分析</p>
      {si.findings.length > 0 && (
        <ul>{si.findings.map((f, k) => <li key={k}>{f}</li>)}</ul>
      )}
      {si.measures.map((m, k) => (
        <div key={k} style={{ marginTop: 10 }}>
          <div className="top">
            <b>{m.title}</b>
          </div>
          {m.kpi && <p className="kpi" style={{ display: "block", margin: "6px 0 0" }}>見る数字：{m.kpi}</p>}
          <p>{m.why}</p>
          <ul>{m.steps?.map((s, j) => <li key={j}>{s}</li>)}</ul>
          <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span className="chip">担当：{m.owner}</span>
            <span className="chip">{m.effort}</span>
          </div>
          {m.flags && m.flags.length > 0 && (
            <div className="alert" style={{ marginTop: 10 }}>
              {m.flags.map((f, j) => (
                <div key={j}>{f.law}「{f.text}」：{f.reason}（言い換え：{f.suggestion}）</div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );

  const renderLine = () =>
    linePlan && (
      <div style={{ marginTop: 10 }}>
        {linePlan.skip ? (
          <p style={{ fontSize: 13.5, color: "var(--muted)" }}>{linePlan.skip}</p>
        ) : (
          <>
            {isGuest && (
              <p className="sub">
                リッチメニュー{linePlan.richMenu?.length ?? 0}個・ステップ{linePlan.steps?.length ?? 0}通を設計済み
              </p>
            )}
            <GuestMask guest={isGuest} label="LINE運用の詳細（リッチメニュー・ステップ配信・出し分け）は会員登録で確認できます">
              <>
                {linePlan.richMenu?.length > 0 && (
                  <div className="rich measure" style={{ marginTop: 10 }}>
                    {linePlan.richMenu.map((m, i) => (
                      <div className="cell" key={i}>
                        <b>{m.label}</b>
                        <small>{m.goes}</small>
                      </div>
                    ))}
                  </div>
                )}
                {linePlan.steps?.length > 0 && (
                  <div className="steps measure" style={{ marginTop: 10 }}>
                    {linePlan.steps.map((st, i) => (
                      <div className="s" key={i}>
                        <div className="h">
                          <span className="n">{i + 1}</span>
                          <div>
                            <b>{st.title}</b>
                            <small>{st.when}</small>
                          </div>
                        </div>
                        <p>{st.body}</p>
                      </div>
                    ))}
                  </div>
                )}
                {linePlan.segments?.length > 0 && (
                  <div className="tactic measure" style={{ marginTop: 12 }}>
                    <div className="top"><b>出し分けの例</b></div>
                    <ul>{linePlan.segments.map((x, k) => <li key={k}>{x}</li>)}</ul>
                  </div>
                )}
              </>
            </GuestMask>
          </>
        )}
      </div>
    );

  return (
    <div>
      {err && <div className="alert">{err}</div>}

      <div className="rep-top">
        <a className="icon-btn" href="/analysis">←</a>
        <div className="right">
          <button
            className="icon-btn"
            onClick={() => {
              // 畳んだ指摘・折り畳み（SEO記事設計の見出し構成など）が閉じたまま印刷されると
              // 中身が落ちるので、先に全部開く
              document.querySelectorAll("details").forEach((d) => ((d as HTMLDetailsElement).open = true));
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
        {industryVertical && (
          <span className="tag" style={{ marginTop: 8, display: "inline-block" }}>
            {INDUSTRY_VERTICAL_LABEL[industryVertical]}
          </span>
        )}
      </div>

      <div className="tabs">
        <button className={tab === "inputs" ? "on" : ""} onClick={() => setTab("inputs")}>入力</button>
        {kpi && <button className={tab === "summary" ? "on" : ""} onClick={() => setTab("summary")}>サマリー</button>}
        <button className={tab === "overview" ? "on" : ""} onClick={() => setTab("overview")}>分析データ</button>
      </div>

      {!isGuest && <MissingSectionsBanner id={id} />}

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
          pricing={pricing}
          onPricing={setPricing}
        />
      )}

      {tab === "summary" && kpi && (
        <Measures
          id={id}
          measures={measures ?? []}
          categoryEvaluations={withSiteHealth(categoryEvaluations ?? null, site ?? null)}
          done={measuresDone ?? []}
          log={measureLog ?? []}
          hygiene={hygiene(site)}
          onNavigate={goToOverviewSection}
          trackingMissing={!!site && !site.gtmId && (site.adTags?.length ?? 0) === 0}
        />
      )}

      {tab === "overview" && <Toc watch={tab} />}

      {tab === "overview" && (
      <>
      {((gsc && gsc.queries.length > 0) || (ga4 && ga4.sessions > 0)) && (
        <>
          <div className="sec-head" style={{ marginTop: 0 }}>
            <div>
              <h2 id="sec-linked">連携データ<RealBadge label="実データ" /></h2>
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
      {summary && summary.personas?.length > 0 && (
        <>
          <div className="sec-head">
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

          <div className="sec-head">
            <div>
              <h2 id="sec-health">サイト健全性<RealBadge label="サイトを読んで確認" /></h2>
              <div className="sub">HTTPS・セキュリティヘッダー・robots.txt・sitemap.xml・構造化データの10項目（{site.passed}/{site.total}項目を満たしています）</div>
            </div>
            <span className="rule" />
          </div>
          <div className="card measure">
            <div className="chips">
              {[
                { label: "HTTPS", pass: site.https },
                ...site.headers.map((h) => ({ label: h.label, pass: h.pass })),
                { label: "robots.txt", pass: site.robotsTxt },
                { label: "sitemap.xml", pass: site.sitemapXml },
                { label: "構造化データ", pass: site.structuredData },
              ].map((c) => (
                <span key={c.label} className="chip-s">{c.pass ? "✓" : "✕"} {c.label}</span>
              ))}
            </div>
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

      <div className="sec-head">
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
      <div className="sec-head">
        <div>
          <h2 id="sec-angles">訴求軸</h2>
          <div className="sub">この切り口でコピーを作りました。生成と同時に景表法・薬機法も確認しています</div>
        </div>
        <span className="rule" />
      </div>
      <div className="filters measure">
        <button className={`sw${hideRed ? " on" : ""}`} onClick={() => setHideRed((v) => !v)}>
          {hideRed ? "✓ " : ""}要修正を隠す
        </button>
        <span>
          {visible.length} / {copies.length} 案を表示中
          {redCount > 0 && `（要修正 ${redCount}件）`}
        </span>
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        {d.angles.map((a, ai) => {
          const angleCopies = shown.filter(([, c]) => c.angleId === a.id);
          return (
            <div key={a.id} style={{ display: "grid", gap: 10 }}>
              <div className="card" style={{ display: "flex", gap: 14, alignItems: "flex-start", padding: 18 }}>
                <span className="tag score" style={{ flex: "0 0 auto" }}>{ai + 1}</span>
                <div>
                  <b style={{ fontSize: 14.5 }}>{a.name}</b>
                  <span style={{ display: "block", fontSize: 12.5, color: "var(--muted)", marginTop: 4 }}>{a.why}</span>
                </div>
              </div>
              {angleCopies.length > 0 && (
                <div className="measure" style={{ display: "grid", gap: 12, paddingLeft: 20 }}>
                  {angleCopies.map(([i, c]) => (
                    <div key={i} className="card copy-card">
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
                          <summary>
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
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {(() => {
          const matchedIds = new Set(d.angles.map((a) => a.id));
          const orphans = shown.filter(([, c]) => !matchedIds.has(c.angleId));
          if (orphans.length === 0) return null;
          return (
            <div style={{ display: "grid", gap: 10 }}>
              <div className="card" style={{ padding: 18 }}>
                <b style={{ fontSize: 14.5 }}>その他</b>
                <span style={{ display: "block", fontSize: 12.5, color: "var(--muted)", marginTop: 4 }}>
                  どの訴求軸にも一致しなかったコピーです
                </span>
              </div>
              <div className="measure" style={{ display: "grid", gap: 12, paddingLeft: 20 }}>
                {orphans.map(([i, c]) => (
                  <div key={i} className="card copy-card">
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
                        <summary>
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
                ))}
              </div>
            </div>
          );
        })()}
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
      {tactics && tactics.risks?.length > 0 && (
        <>
          <div className="sec-head">
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
      {competitors && (
        <>
          <div className="sec-head" style={{ marginTop: 0 }}>
            <div>
              <h2 id="sec-comp">競合サイト比較<RealBadge /></h2>
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
              {competitors.analysis && competitors.analysis.rows.some((r) => r.total > 0) && (() => {
                const an = competitors.analysis!;
                const readable = an.profiles.filter((p) => p.readable);
                const unreadable = an.profiles.filter((p) => !p.readable);
                return (
                  <>
                    <div className="rows measure" style={{ marginTop: 16 }}>
                      <div className="rh">
                        自社との比較
                        <span className="hint">
                          上位に出ていた競合ページ{readable.length}件と、自社トップページを、HTMLに書かれている範囲で読み比べています
                        </span>
                      </div>
                      {an.rows
                        .filter((r) => r.total > 0)
                        .map((r) => (
                          <div className="r" key={r.key}>
                            <span
                              className="st"
                              style={{ color: r.own === null ? "var(--muted)" : r.own ? "var(--ok)" : "var(--ng)" }}
                            >
                              {r.own === null ? "?" : r.own ? "✓" : "✕"}
                            </span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <b>{r.label}</b>
                              <small>
                                自社：{r.own === null ? "確認できず" : r.own ? "あり" : "確認できず（ページに見当たらない）"}
                                ／ 競合：{r.total}件中{r.competitors}件が掲載
                              </small>
                            </div>
                          </div>
                        ))}
                      {an.numbers
                        .filter((n) => n.own !== null && n.median !== null)
                        .map((n) => (
                          <div className="r" key={n.label}>
                            <span className="st" style={{ color: "var(--muted)" }}>≒</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <b>{n.label}</b>
                              <small>
                                自社：{n.own!.toLocaleString()} ／ 競合の中央値：{n.median!.toLocaleString()}
                              </small>
                            </div>
                          </div>
                        ))}
                    </div>
                    {an.insights.length > 0 && (
                      <div className="measure" style={{ display: "grid", gap: 12, marginTop: 12 }}>
                        <div className="tactic">
                          <div className="top"><b>比較から分かること</b></div>
                          <ul>{an.insights.map((t, k) => <li key={k}>{t}</li>)}</ul>
                        </div>
                      </div>
                    )}
                    <div className="note measure">
                      <i className="i">i</i>
                      <span>
                        競合は「検索で上位に出ていたページ」、自社は「トップページ」を読んでいるため、ページの種類が違う項目（文字数・見出し数）は優劣を示すものではありません。
                        {an.own && !an.own.readable && <>自社ページは読めませんでした（{an.own.reason}）。</>}
                        {unreadable.length > 0 && (
                          <>
                            読めなかった競合ページ：{unreadable.map((u) => `${u.name}（${u.reason}）`).join("、")}。
                          </>
                        )}
                        {an.insightError && <>示唆の文章は生成できなかったため、集計の差だけを示しています（{an.insightError}）。</>}
                      </span>
                    </div>
                  </>
                );
              })()}
              <div className="note measure">
                <i className="i">i</i>
                <span>
                  {new Date(competitors.searchedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}時点の検索結果です。
                  順位は検索する場所・端末・時期で変わります。
                  <b style={{ fontWeight: 600 }}>訪問数や類似度は取得していないため出していません。</b>
                </span>
              </div>
            </>
          )}
        </>
      )}
      {adOps && adOps.tags && adOps.tags.length > 0 && (
        <>
          <div className="sec-head">
            <div>
              <h2 id="sec-tags">計測タグの導入状況<RealBadge /></h2>
              <div className="sub">サイトを実際に読んで判定しています</div>
            </div>
            <span className="rule" />
          </div>
          <div className="rows measure">
            {adOps.tags.map((t, i) => (
              <div className="r" key={i}>
                <span
                  className="st"
                  style={{
                    color:
                      t.status === "導入済み" ? "var(--ok)" : t.status === "要確認" ? "var(--warn)" : t.need === "参考" ? "var(--muted)" : "var(--ng)",
                  }}
                >
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
      {plan && plan.length > 0 && (
        <>
          <div className="sec-head">
            <div>
              <h2 id="sec-plan">広告手法一覧</h2>
              <div className="sub">サイト分析をもとに、使うべき媒体を優先順位付きで出しています</div>
            </div>
            <span className="rule" />
          </div>

          <div className="budget measure" style={{ marginTop: 16 }}>
            <div className="bh">月間広告予算<span>想定値</span></div>
            <div className="bb">
              <span className={budget ? "on" : ""} style={{ display: "inline-block" }}>
                {budget ? BUDGETS.find((b) => b.id === budget)?.label ?? budget : "未設定（配分%のまま表示）"}
              </span>
            </div>
            <p>
              {budget
                ? "配分%をこの想定予算で実額に直しています。"
                : "予算を入れると、配分%が媒体ごとの実額に変わります。"}
              変更・作り直しは
              <button className="linkbtn" onClick={goToInputsBudget}>
                入力タブの「予算と粗利率」
              </button>
              から行えます。
            </p>
          </div>

          {thin.length > 0 && band && (
            <div className="note warn" style={{ marginTop: 12 }}>
              <i className="i">!</i>
              <span>
                この予算だと <b style={{ fontWeight: 600 }}>{thin.map((m) => m.channel).join("・")}</b> が
                月10万円を下回ります。予算を薄く広げると、どの媒体もデータが溜まらず良し悪しを判断できません。
                <button className="linkbtn" onClick={goToInputsBudget}>
                  入力タブで予算を見直す
                </button>
              </span>
            </div>
          )}

          <div className="plan measure">
            {plan.map((m, i) => (
              <div className="p" key={m.channel + i}>
                <div className="top">
                  <span className="ic">◎</span>
                  <PlatformIcon platform={m.channel} size={15} />
                  <b>{m.channel}</b>
                  <span className="share">{m.share}%</span>
                  {shareToYen(budget, m.share) && <span className="yen">{shareToYen(budget, m.share)}</span>}
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
      {adOps?.done && adOps.campaigns.length > 0 && (
        <>
          <div className="sec-head">
            <div>
              <h2 id="sec-adops">広告運用設計</h2>
              <div className="sub">管理画面にそのまま入稿できる粒度で出しています</div>
            </div>
            <span className="rule" />
          </div>

          {adOps.plan && adOps.plan.length > 0 ? (
            <AdStructureTable plan={adOps.plan} />
          ) : (
            !isGuest && <RebuildAdPlanNote id={id} />
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
                  <span className="tag"><PlatformIcon platform={c.channel} size={13} /> {c.channel}</span>
                </div>
                {c.purpose && <p className="purpose">{c.purpose}</p>}
                {c.budget && <p className="budget">{c.budget}</p>}
                {c.bidStrategy && <p className="bid">入札戦略：{c.bidStrategy}</p>}

                {(c.campaignNegatives?.length ?? 0) > 0 && (
                  <details className="flags">
                    <summary>キャンペーン除外キーワード（{c.campaignNegatives!.length}件・全広告グループに効く）</summary>
                    <div className="chips">{c.campaignNegatives!.map((k, i) => <span className="chip ng" key={i}>{k}</span>)}</div>
                  </details>
                )}

                {c.settings?.length > 0 && (
                  <details className="flags">
                    <summary>キャンペーン設定（{c.settings.length}項目）</summary>
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

                {c.groups?.map((g, gi) => {
                  const spec = specFor(c.channel ?? "");
                  const headlineCount = g.headlines?.length ?? 0;
                  const descriptionCount = g.descriptions?.length ?? 0;
                  const longHeadlineCount = spec.long ? (g.longHeadlines?.length ?? 0) : 0;
                  return (
                  <div className="adg" key={gi}>
                    <div className="h">
                      <span className="ic">◆</span>
                      <b>{g.name}</b>
                    </div>
                    {g.purpose && <p className="purpose">{g.purpose}</p>}

                    <GuestMask guest={isGuest} label="配信設定・キーワードの詳細は会員登録で確認できます">
                      <>
                        {g.targeting && <p>{g.targeting}</p>}

                        {(g.audience?.length ?? 0) > 0 && (
                          <details className="flags">
                            <summary>{spec.id === "pmax" ? "オーディエンスシグナル・配信設定" : "配信対象の設定"}（{g.audience!.length}項目）</summary>
                            <div className="rows" style={{ margin: 0 }}>
                              {g.audience!.map((st, i) => (
                                <div className="r" key={i}>
                                  <div style={{ flex: 1, minWidth: 0 }}><b style={{ fontWeight: 400 }}>{st.label}</b></div>
                                  <span className="tag">{st.value}</span>
                                </div>
                              ))}
                            </div>
                          </details>
                        )}
                        {(g.searchThemes?.length ?? 0) > 0 && (
                          <details className="flags">
                            <summary>検索テーマ（{g.searchThemes!.length}件）</summary>
                            <div className="chips">{g.searchThemes!.map((k, i) => <span className="chip" key={i}>{k}</span>)}</div>
                          </details>
                        )}

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
                      </>
                    </GuestMask>

                    {isGuest && (headlineCount > 0 || descriptionCount > 0 || longHeadlineCount > 0) && (
                      <p className="sub" style={{ marginTop: 10 }}>
                        見出し案{headlineCount}件 / 説明文案{descriptionCount}件
                        {spec.long ? ` / ロング見出し案${longHeadlineCount}件` : ""} 作成済み
                      </p>
                    )}
                    <GuestMask guest={isGuest} label="見出し案・説明文案の本文は会員登録で確認できます">
                      <>
                        {g.headlines?.length > 0 && (
                          <details className="flags">
                            <summary>
                              {spec.headline.field}案（{g.headlines.length}件・{limitLabel(spec, "headline").split("・")[1]}）
                            </summary>
                            <div className="lines">
                              {g.headlines.map((t, i) => (
                                <AdLine key={i} text={t} limit={spec.headline.limit} mode={spec.count} flag={flagOf(t)} />
                              ))}
                            </div>
                          </details>
                        )}
                        {g.descriptions?.length > 0 && (
                          <details className="flags">
                            <summary>
                              {spec.description.field}案（{g.descriptions.length}件・{limitLabel(spec, "description").split("・")[1]}）
                            </summary>
                            <div className="lines">
                              {g.descriptions.map((t, i) => (
                                <AdLine key={i} text={t} limit={spec.description.limit} mode={spec.count} flag={flagOf(t)} />
                              ))}
                            </div>
                          </details>
                        )}
                        {spec.long && (g.longHeadlines?.length ?? 0) > 0 && (
                          <details className="flags">
                            <summary>
                              {spec.long.field}案（{g.longHeadlines!.length}件・{limitLabel(spec, "long").split("・")[1]}）
                            </summary>
                            <div className="lines">
                              {g.longHeadlines!.map((t, i) => (
                                <AdLine key={i} text={t} limit={spec.long!.limit} mode={spec.count} flag={flagOf(t)} />
                              ))}
                            </div>
                          </details>
                        )}
                      </>
                    </GuestMask>
                    <div className="specnote">
                      入稿規定：{spec.label}／{limitLabel(spec, "headline")}／{limitLabel(spec, "description")}
                      {spec.long && <>／{limitLabel(spec, "long")}</>}
                      <small>出典：{spec.source}</small>
                    </div>
                  </div>
                  );
                })}

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
                <b style={{ fontWeight: 600 }}>{adOps.flagged.length}本</b>の原稿に法令上の指摘があります
                （{adOps.guard.hits.slice(0, 3).map((h) => `「${h.text}」`).join("・")}
                {adOps.guard.hits.length > 3 ? " ほか" : ""}）。
                該当する原稿には理由と言い換え案を付けています。入稿前に直してください。
              </span>
            </div>
          )}
        </>
      )}
      {seo && site && (
        <>
          <div className="sec-head">
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
          {keywords && keywords.rows.length > 0 && (
            <>
              <div className="sec-head">
                <div>
                  <h2 id="sec-kw">対策キーワード{keywords?.hasRealData && <RealBadge label="Search Consoleの実データで分析" />}</h2>
                  <div className="sub">検索広告とSEOの両方で使う語です</div>
                </div>
                <span className="rule" />
              </div>
              <div className="kwwrap measure">
                <table className="kw">
                  <thead>
                    <tr>
                      <th>キーワード</th><th>種別</th>
                      {keywords.rows.some((r) => r.volume) && <th>月間検索数（推定）</th>}
                      <th>難易度</th><th>優先度</th>
                      <th>表示回数</th><th>掲載順位</th><th>やること</th>
                    </tr>
                  </thead>
                  <tbody>
                    {keywords.rows.map((r, i) => (
                      <tr key={i}>
                        <td><b>{r.keyword}</b></td>
                        <td><span className="tag">{r.kind}</span></td>
                        {keywords.rows.some((x) => x.volume) && <td className="num">{r.volume ?? "—"}</td>}
                        <td>{r.difficulty}</td>
                        <td>{r.priority}</td>
                        <td className="num">{r.impressions !== null ? r.impressions.toLocaleString() : "—"}</td>
                        <td className="num">{r.position !== null ? `${r.position}位` : "—"}</td>
                        <td className="act">{r.action}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="note">
                <i className="i">i</i>
                <span>
                  {keywords.hasRealData
                    ? "表示回数・掲載順位は Search Console の直近28日の実測です。連携前の語は「—」にしています。"
                    : "Search Console を連携すると、実際に検索されている語の表示回数と掲載順位が入ります。"}
                  {keywords.rows.some((r) => r.volume) &&
                    " 月間検索数（推定）は、企業規模・地域の人口・業種の市場規模からAIが見積もった5段階の目安です。実測ではありません。"}
                </span>
              </div>

              {(keywords.technical.length > 0 || keywords.content.length > 0) && (
                <div className="measure" style={{ display: "grid", gap: 12, marginTop: 16 }}>
                  {[
                    { t: "テクニカルSEO", v: keywords.technical },
                    { t: "コンテンツSEO", v: keywords.content },
                  ].filter((x) => x.v.length > 0).map((x, i) => (
                    <div className="tactic" key={i}>
                      <div className="top"><b>{x.t}</b></div>
                      <ul>{x.v.map((y, k) => <li key={k}>{y}</li>)}</ul>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {seoArticles && seoArticles.articles.length > 0 && (
            <>
              <div className="sec-head">
                <div>
                  <h2 id="sec-seoart">SEO記事設計</h2>
                  <div className="sub">構成案（H2/H3）。詳細を開くと見出しと要旨が見られます</div>
                </div>
                <span className="rule" />
              </div>
              <div className="measure" style={{ display: "grid", gap: 12 }}>
                {seoArticles.articles.map((a, i) => (
                  <details className="tactic seoart" key={i}>
                    <summary>
                      {a.title}　<span className="tag">{a.targetKeyword}</span>
                    </summary>
                    <GuestMask guest={isGuest} label="記事の構成（見出し・要旨・文字数）は会員登録で確認できます">
                    <div style={{ marginTop: 12 }}>
                      <p className="sub">{a.intent}</p>
                      <p style={{ color: "var(--muted)" }}>meta description：{a.metaDescription}</p>
                      <p style={{ color: "var(--muted)" }}>目安文字数：約{a.estimatedChars.toLocaleString()}字</p>
                      <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                        {a.headings.map((h, j) => (
                          <div key={j}>
                            <b>H2：{h.h2}</b>
                            <p style={{ margin: "4px 0" }}>{h.summary}</p>
                            {h.h3?.length > 0 && (
                              <ul style={{ marginTop: 4 }}>
                                {h.h3.map((x, k) => (
                                  <li key={k}>H3：{x}</li>
                                ))}
                              </ul>
                            )}
                          </div>
                        ))}
                      </div>
                      {a.flags && a.flags.length > 0 && (
                        <div className="alert" style={{ marginTop: 10 }}>
                          {a.flags.map((f, j) => (
                            <div key={j}>
                              {f.law}「{f.text}」：{f.reason}（言い換え：{f.suggestion}）
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    </GuestMask>
                  </details>
                ))}
              </div>
            </>
          )}
          {suggests && (
            <>
              <div className="sec-head">
                <div>
                  <h2 id="sec-suggest">検索サジェスト{(suggests?.rows?.length ?? 0) > 0 && <RealBadge label="実測データで分析" />}</h2>
                  <div className="sub">いま実際に出ているサジェストです（{suggests?.source === "Bing" ? "Googleから取得できなかったため、Bingの候補を表示しています" : "Googleから取得"}）</div>
                </div>
                <span className="rule" />
              </div>
              {suggests.rows.length > 0 ? (
                <>
                  <div className="sg measure">
                    {suggests.queried.map((q) => (
                      <div className="q" key={q}>
                        <div className="qh">「{q}」で検索したとき</div>
                        <div className="chips">
                          {suggests.rows.filter((r) => r.keyword === q).map((r, i) => (
                            <span
                              className={`chip${r.kind === "注意" ? " ng" : r.kind === "誘導先に注意" ? " warn" : r.kind === "同名の別物" ? " dim" : ""}`}
                              key={i}
                              title={r.kind}
                            >
                              {r.suggestion}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="note">
                    <i className="i">i</i>
                    <span>
                      赤は放置すると不利になる語、黄は第三者サイトへ流れる語（口コミ・比較など）です。
                      黄は必ずしも悪くありませんが、遷移先の内容を自社で制御できません。
                      グレーは同名の別施設・別サービスのサジェストで、指名検索で埋もれている状態を示します。
                    </span>
                  </div>
                  {outreach && outreach.suggestActions?.length > 0 && (
                    <div className="tactic measure" style={{ marginTop: 12 }}>
                      <div className="top"><b>この状態に対してやること</b></div>
                      <ul>{outreach.suggestActions.map((x, i) => <li key={i}>{x}</li>)}</ul>
                    </div>
                  )}
                </>
              ) : (
                // 2026-10-04: scanSuggests は失敗ではなく「検出なし」でも rows: [] を
                // 返しうる（error は付かない）。以前はこの場合セクション自体を丸ごと
                // 非表示にしていたため、利用者には「サジェストがあるはずなのに無い」
                // ように見えていた。チェック自体は実行済みであることを示す
                <div className="note">
                  <i className="i">i</i>
                  <span>
                    指名検索のサジェストは取得できませんでした。社名・サービス名の検索ボリュームが
                    まだ少ない、またはGoogle側の一時的な制限の可能性があります。
                    {suggests.error && <> 取得の失敗：{suggests.error}。</>}
                    {suggests.trace && suggests.trace.length > 0 && (
                      <small style={{ display: "block", marginTop: 6, color: "var(--muted)" }}>
                        試した検索語と結果：
                        {[...new Set(suggests.trace.map((t) => t.q))].map((q) => {
                          const rs = suggests.trace!.filter((t) => t.q === q);
                          return `「${q}」${rs.map((t) => `${t.source === "bing" ? "Bing" : "Google"}${t.error ? "失敗" : `${t.n}件`}`).join("・")}`;
                        }).join(" ／ ")}
                      </small>
                    )}
                  </span>
                </div>
              )}
            </>
          )}
      {meo && (
        <>
          <div className="sec-head">
            <div>
              <h2 id="sec-meo">MEO（Googleマップ対策）{meo.self && <RealBadge label="Googleマップの実データで分析" />}</h2>
              <div className="sub">Googleマップの実データで、近隣の同業と比べています</div>
            </div>
            <span className="rule" />
          </div>

          <MeoEntryCard analysisId={id} address={meo.self?.address} />

          {!meo.self ? (
            <div className="note">
              <i className="i">i</i>
              <span>{meo.reason}</span>
            </div>
          ) : (
            <>
              {meo.partial && (
                <div className="note warn" style={{ marginBottom: 10 }}>
                  <i className="i">!</i>
                  <span>{meo.partial}</span>
                </div>
              )}
              <MeoStoreList meo={meo} selectedIdx={meoStoreIdx} onSelect={setMeoStoreIdx} />
              <MeoStoreDetail store={meo.stores[meoStoreIdx] ?? meo.stores[0]} />
            </>
          )}

          {meo.self && (() => {
            // 選択中の店舗の実測だけから作る（店舗を切り替えると内容も変わる）
            const store = meo.stores[meoStoreIdx] ?? meo.stores[0];
            if (!store) return null;
            return (
              <div className="measure" style={{ display: "grid", gap: 12, marginTop: 16 }}>
                <div className="tactic">
                  <div className="top"><b>MEO（Googleマップ）</b><span className="tag" style={{ marginLeft: 8 }}>{store.self.name}の実測から</span></div>
                  <ul>{meoStoreActions(store).map((y, k) => <li key={k}>{y}</li>)}</ul>
                </div>
              </div>
            );
          })()}
        </>
      )}
          {(() => {
            const hasLpo = !!lpo && lpo.groups.length > 0;
            const hasSpeedMissing = !!speed && speed.score === null && speed.field.length === 0 && !!speed.reason;
            const hasSpeedData = !!speed && (speed.score !== null || speed.field.length > 0);
            if (!hasLpo && !hasSpeedMissing && !hasSpeedData) return null;
            return (
              <>
                <div className="sec-head">
                  <div>
                    <h2 id="sec-lpo">LP改善（受け皿の直し方）</h2>
                    <div className="sub">広告を出す前に直すと、同じ予算で獲得数が変わります</div>
                  </div>
                  <span className="rule" />
                </div>
                {hasLpo && (
                  <div className="measure" style={{ display: "grid", gap: 12 }}>
                    {lpo!.groups.map((g, i) => (
                      <div className="tactic" key={i}>
                        <div className="top"><b>{g.area}</b></div>
                        <ul>
                          {g.items?.map((x, k) => (
                            <li key={k}>
                              {typeof x === "string" ? x : x.text}
                              {typeof x !== "string" && (
                                <span className={`tag${x.severity === "重" ? " warn" : ""}`} style={{ marginLeft: 8 }}>
                                  {x.severity}
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}

                {hasSpeedMissing && (
                  <div className="note warn" style={{ marginTop: hasLpo ? 14 : 0 }}>
                    <i className="i">!</i>
                    <span>表示速度を測定できませんでした。{speed!.reason}</span>
                  </div>
                )}

                {hasSpeedData && (
                  <>
                    <div className="sec-head" style={{ marginTop: hasLpo || hasSpeedMissing ? 24 : 0 }}>
                      <div>
                        <h2 id="sec-speed">表示速度（実測）<RealBadge label="実測値" /></h2>
                        <div className="sub">PageSpeed Insights・モバイル。推測ではなく計測値です</div>
                      </div>
                      <span className="rule" />
                    </div>

                    <div className="speed measure">
                      {speed!.score !== null && (
                        <div className="gauge">
                          <b>{speed!.score}</b>
                          <small>/ 100</small>
                          <span className={speed!.score >= 90 ? "ok" : speed!.score >= 50 ? "warn" : "ng"}>
                            {speed!.score >= 90 ? "良好" : speed!.score >= 50 ? "改善が必要" : "不良"}
                          </span>
                        </div>
                      )}
                      <div className="kpis">
                        {(speed!.field.length > 0 ? speed!.field : speed!.lab).map((m) => (
                          <div className="kpi" key={m.id}>
                            <b>{m.value}</b>
                            <small>{m.label}</small>
                            {m.rating && <i className={m.rating === "良好" ? "ok" : m.rating === "不良" ? "ng" : "warn"}>{m.rating}</i>}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="note">
                      <i className="i">i</i>
                      <span>
                        {speed!.field.length > 0
                          ? "上の数字は実際にこのサイトを見た人の計測値（Chrome ユーザーエクスペリエンスレポート）です。"
                          : speed!.reason}
                        {speed!.testedUrl && <> 測定URL：{speed!.testedUrl.replace(/^https?:\/\//, "")}</>}
                      </span>
                    </div>

                    {speed!.opportunities.length > 0 && (
                      <div className="rows measure">
                        <div className="rh">短縮の見込みがある改善<small>PageSpeed Insights の試算</small></div>
                        {speed!.opportunities.map((o, i) => (
                          <div className="r" key={i}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <b>{o.title}</b>
                              <small>{o.detail}</small>
                            </div>
                            <span className="tag warn">{o.savingsDisplay}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </>
            );
          })()}
      {site && (site.social.length > 0 || siItems.length > 0 || snsChannels.length > 0) && (
        <>
          <div className="sec-head">
            <div>
              <h2 id="sec-social">公式SNSアカウント{(social?.accounts ?? []).some((x) => hasRealData(x)) && <RealBadge label="取得できた実データで分析" />}</h2>
              <div className="sub">情報取得→分析→運用プランの順に、媒体ごとにまとめています</div>
            </div>
            <span className="rule" />
          </div>

          {/*
           * 2026-10-05: 以前は「情報取得（全媒体）」→「SNS分析（全媒体）」→
           * 「SNS運用プラン（全媒体）」の3ブロックを縦に並べていたため、1つの媒体の
           * 話が3箇所に分断されていた。媒体ごとに3つを束ねて繰り返す構成に変更する。
           * SNS分析・SNS運用プランはYouTube/X/TikTok/Instagramの4媒体でしか作っていない
           * （lib/social-insights.ts・lib/sns-plan.ts）ため、まずその4媒体を
           * 対応するsite.social上のリンクと紐付けて束ね、残り（Facebook・LINE等）は
           * 情報取得だけの行として最後にまとめる
           */}
          {(() => {
            const CANON = ["YouTube", "X", "TikTok", "Instagram", "Facebook"] as const;
            const usedUrls = new Set<string>();
            const blocks = CANON.map((p) => {
              const info = site.social.find((x) => PLATFORM_RE[p].test(x.platform));
              const si = siItems.find((x) => x.platform === p);
              const ch = snsChannels.find((x) => x.platform === p);
              if (info) usedUrls.add(info.url);
              return info || si || ch ? { platform: p, info, si, ch } : null;
            }).filter((b): b is NonNullable<typeof b> => b !== null);
            const rest = site.social.filter((x) => !usedUrls.has(x.url) && normalizePlatform(x.platform) !== "line");

            return (
              <>
                {blocks.map((b) => (
                  <div key={b.platform} className="measure" style={{ marginTop: 18 }}>
                    <p className="eyebrow"><PlatformIcon platform={b.platform} size={14} /> {b.platform}</p>
                    {b.info && (
                      <div className="rows measure" style={{ marginTop: 8 }}>
                        {renderSocialInfoRow(b.info)}
                      </div>
                    )}
                    {b.si && (
                      <div style={{ marginTop: 10 }}>
                        <p className="eyebrow">SNS分析{hasRealData(findAcct(b.platform, b.info?.url)) && <span className="tag ok" style={{ marginLeft: 6 }}>🟢実データで分析</span>}</p>
                        {renderSI(b.si)}
                      </div>
                    )}
                    {b.ch && (
                      <div style={{ marginTop: 10 }}>
                        <p className="eyebrow">SNS運用プラン{hasRealData(findAcct(b.platform, b.info?.url)) && <span className="tag ok" style={{ marginLeft: 6 }}>🟢実データで分析</span>}</p>
                        <SnsChannelBlock c={b.ch} />
                      </div>
                    )}
                  </div>
                ))}

                {rest.length > 0 && (
                  <div className="rows measure" style={{ marginTop: blocks.length > 0 ? 18 : 8 }}>
                    {rest.map((x) => renderSocialInfoRow(x))}
                  </div>
                )}
              </>
            );
          })()}

          <div className="note" style={{ marginTop: 16 }}>
            <i className="i">i</i>
            <span>
              取得できたデータは施策立案に活用しており、すでに運用しているSNSを「新しく開設する」施策としては出しません。
            </span>
          </div>

        </>
      )}

      {(!!snsPlan?.campaign || !!snsPlan?.error || !!linePlan) && (
        <>
          {snsPlan?.campaign && (
            <div className="measure" style={{ marginTop: 16 }}>
              <p className="eyebrow">SNSキャンペーン案</p>
              <SnsCampaignCard c={snsPlan.campaign} />
            </div>
          )}

          {snsPlan?.error && snsChannels.length === 0 && (
            <div className="note" style={{ marginTop: 16 }}>
              <i className="i">i</i>
              <span>SNSの運用プランを作れませんでした（{snsPlan.error}）</span>
            </div>
          )}

          {linePlan && (
            <div className="measure" style={{ marginTop: 16 }}>
              <p className="eyebrow">LINEプラン</p>
              {renderLine()}
            </div>
          )}
        </>
      )}
          {outreach && (
            <>
              <div className="sec-head">
                <div>
                  <h2 id="sec-outreach">外部施策（自社サイトの外でやること）</h2>
                  <div className="sub">掲載・アフィリエイト・PR</div>
                </div>
                <span className="rule" />
              </div>

              {outreach.citations?.length > 0 && (
                <div className="rows measure">
                  <div className="rh">掲載を狙う先</div>
                  {outreach.citations.map((c, i) => (
                    <div className="r" key={i}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <b>{c.site}</b>
                        <small>{c.why}</small>
                        <small style={{ color: "var(--text)" }}>{c.how}</small>
                      </div>
                      <span className="tag">{c.kind}</span>
                    </div>
                  ))}
                </div>
              )}

              {outreach.affiliate && (
                <div className="tactic measure" style={{ marginTop: 12 }}>
                  <div className="top">
                    <b>アフィリエイト</b>
                    <span className={`tag${outreach.affiliate.fit ? "" : " warn"}`}>
                      {outreach.affiliate.fit ? "向いています" : "向きません"}
                    </span>
                  </div>
                  <p>{outreach.affiliate.reason}</p>
                  {outreach.affiliate.fit && (
                    <>
                      {outreach.affiliate.asps?.length > 0 && (
                        <div className="chips" style={{ paddingTop: 8 }}>
                          {outreach.affiliate.asps.map((a, i) => <span className="chip" key={i}>{a}</span>)}
                        </div>
                      )}
                      {outreach.affiliate.terms && <p style={{ marginTop: 10 }}>{outreach.affiliate.terms}</p>}
                    </>
                  )}
                  {outreach.affiliate.caution && (
                    <div className="note warn" style={{ marginTop: 10 }}>
                      <i className="i">!</i>
                      <span>{outreach.affiliate.caution}</span>
                    </div>
                  )}
                </div>
              )}

              {outreach.prThemes?.length > 0 && (
                <div className="tactic measure" style={{ marginTop: 12 }}>
                  <div className="top"><b>PRで出せる話</b></div>
                  <ul>{outreach.prThemes.map((x, i) => <li key={i}>{x}</li>)}</ul>
                </div>
              )}

              {(outreach.negatives?.length ?? 0) > 0 && (
                <div className="tactic measure" style={{ marginTop: 12 }}>
                  <div className="top"><b>ネガティブ対策</b></div>
                  <p>悪い評判や誤解が広がったときに備えて、先にやっておくことです。</p>
                  <ul>{outreach.negatives!.map((x, i) => <li key={i}>{x}</li>)}</ul>
                </div>
              )}
            </>
          )}
      {/* 2026-10-04: 「広告以外の施策」の一覧（SNS運用・LINE・LPO・SEO・MEO・PR/サジェスト対策の
          要約とアクション）は、同じ内容を扱う専用章（SNS運用プラン・LINE・LP改善・SEOキーワード/
          記事設計・検索サジェスト対策など）とほぼ重複していたため、一覧表示そのものは削除した。
          直後の「実行スケジュール」は同じtactics生成結果から作るが、どの順で手を付けるかという
          他の章にはない情報なので残す。「作れなかった章」のお知らせは施策一覧とは無関係の情報
          （他章の生成エラー通知）なので、tactics.items の有無に関係なく出す */}
      {tactics && (
        <>
          {/* 作れなかった章は黙って消さない。無いのか、作れなかったのかで読み方が変わる */}
          {(() => {
            const broken = [
              { name: "LP改善", err: lpo?.error },
              { name: "キーワード", err: keywords?.error },
              { name: "SEO記事設計", err: seoArticles?.error },
              { name: "LINE", err: linePlan?.error },
              { name: "検索サジェスト", err: suggests?.error },
              { name: "外部施策", err: outreach?.error },
            ].filter((x) => x.err);
            if (broken.length === 0) return null;
            return (
              <div className="alert" style={{ marginTop: 14 }}>
                次の章は作成できませんでした：{broken.map((x) => x.name).join("・")}。
                （理由：{broken[0].err}）分析をやり直すと作り直せます。
              </div>
            );
          })()}
        </>
      )}
          {tactics && tactics.items?.length > 0 && tactics.schedule?.length > 0 && (
            <>
              <div className="sec-head">
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
      {copies.length > 0 && (
        <section className="block no-print">
          <div className="sec-head" style={{ marginTop: 0 }}>
            <div>
              <h2 id="sec-banners">バナー書き出し</h2>
              <div className="sub">Meta・Google・Yahoo の各サイズを同時に出します</div>
            </div>
            <span className="rule" />
          </div>
          {isGuest && (
            <p className="sub">{SIZES.length}サイズ分のバナー案を作成可能です</p>
          )}
          <GuestMask guest={isGuest} label="バナー画像の書き出しは会員登録でご利用いただけます">
          <>
          <div className="label">使うコピーを選ぶ（{chosen.length} / {copies.length} 案を選択中）</div>
          <div className="measure" style={{ display: "grid", gap: 8, marginTop: 8, marginBottom: 18 }}>
            {sorted.map(([i, c]) => {
              const angleName = d.angles.find((a) => a.id === c.angleId)?.name ?? "その他";
              return (
                <label
                  key={i}
                  className={`card${picked.includes(i) ? " sel" : ""}`}
                  style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 14px", cursor: "pointer" }}
                >
                  <input
                    type="checkbox"
                    checked={picked.includes(i)}
                    onChange={(e) => setPicked((p) => (e.target.checked ? [...p, i] : p.filter((x) => x !== i)))}
                    style={{ marginTop: 3 }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 4 }}>
                      <span className="tag score">{angleName}</span>
                      <GuardTag g={c.guard} />
                    </div>
                    <div className="hl" style={{ fontSize: 13.5 }}>{c.headline.join("")}</div>
                  </div>
                </label>
              );
            })}
          </div>
          <div className="label">サイズを選ぶ</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
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
          {(
            // この節は「バナー書き出し」の中（copies.length > 0 が確定済み）なので、
            // サイトに写真が1枚も無くても、アップロード枠は常に出す
            <div className="photopick">
              <div className="ph">
                写真を載せる
                <small>
                  サイトに載っている写真から選ぶか、お手元の画像をアップロードして使えます（生成画像は使いません）
                </small>
              </div>
              {(d.industry === "medical" || d.industry === "beauty") && (
                <div className="note warn" style={{ marginTop: 10 }}>
                  <i className="i">!</i>
                  <span>{BANNER_CASE_WARNING}</span>
                </div>
              )}
              <div className="opts">
                <button
                  className={photo === null ? "on" : ""}
                  onClick={() => {
                    setPhoto(null);
                    setCroppedSrc(null);
                    setCropError(null);
                  }}
                >
                  <span className="none">文字のみ</span>
                </button>
                {customImages.map((ci) => {
                  const u = `${CUSTOM_PREFIX}${ci.path}`;
                  const src = `/api/analysis/${id}/img?c=${encodeURIComponent(ci.path)}`;
                  return (
                    <button
                      key={ci.path}
                      className={photo === u ? "on" : ""}
                      style={{ position: "relative" }}
                      disabled={cropBusy && photo === u}
                      onClick={() => void pickPhoto(u)}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={src} alt="" />
                      <span
                        style={{
                          position: "absolute",
                          left: 4,
                          bottom: 4,
                          background: "rgba(0,0,0,.65)",
                          color: "#fff",
                          fontSize: 10,
                          lineHeight: 1,
                          padding: "3px 6px",
                          borderRadius: 3,
                          fontWeight: 600,
                        }}
                      >
                        アップロード素材
                      </span>
                    </button>
                  );
                })}
                <label className={`uploadbtn${uploading ? " busy" : ""}`}>
                  {uploading ? "アップロード中…" : "＋ 画像を追加"}
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    disabled={uploading}
                    onChange={(e) => void handleUpload(e)}
                  />
                </label>
                {(site?.images ?? [])
                  .filter((u) => !looksLikeCasePhoto(u))
                  .filter((u) => {
                    // 文字チェック自体が丸ごと失敗した（AI呼び出しエラー・全画像の取得失敗など）
                    // 場合、判定結果が1件も無いのに全候補が「未判定」扱いになり、写真が
                    // 一枚も表示されなくなってしまう。判定が丸ごと無い時は安全側に倒さず、
                    // 未判定のまま全部を候補に出す（目視で選んでもらう）
                    if (checkUnavailable) return true;
                    const info = imageScan?.items.find((x) => x.url === u);
                    // 判定結果が無い（AIの文字チェックに回らなかった等）場合、文字なしと
                    // 決めつけない。安全側に倒し、除外側と同じ「それも表示する」に回す
                    if (!info) return showTexted;
                    if (!info.hasText) return true;
                    return showTexted; // 文字が重なっている写真。手動で「それも表示する」を選んだときだけ
                  })
                  // 文字が重なっていない写真を最優先で並べ、次に未判定、文字ありの順にする。文字なしの写真がサイト内に存在するのに
                  // 発見順（HTML内の並び順）がたまたま後ろだと、下の枚数上限で弾かれて
                  // 表示されないことがあったため、切り詰める前に並べ替える。
                  // Array#sort は安定ソートなので、同じ優先度内の順序は変えない
                  .sort((a, b) => {
                    const rank = (u: string) => {
                      const info = imageScan?.items.find((x) => x.url === u);
                      if (!info) return 1; // 未判定は中間扱い
                      if (!info.hasText) return 0; // 文字が重なっていない写真を最優先
                      return 2; // 文字が重なっている写真（「それも表示する」を選んだときだけここに来る）
                    };
                    return rank(a) - rank(b);
                  })
                  .slice(0, 12)
                  .map((u) => {
                    const info = imageScan?.items.find((x) => x.url === u);
                    const textedPhoto = !!info?.hasText;
                    const src = `/api/analysis/${id}/img?u=${encodeURIComponent(u)}`;
                    return (
                      <button
                        key={u}
                        className={photo === u ? "on" : ""}
                        style={{ position: "relative" }}
                        onClick={() => void pickPhoto(u)}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={src} alt="" />
                        {textedPhoto && (
                          <span
                            style={{
                              position: "absolute",
                              left: 4,
                              bottom: 4,
                              background: "rgba(0,0,0,.65)",
                              color: "#fff",
                              fontSize: 10,
                              lineHeight: 1,
                              padding: "3px 6px",
                              borderRadius: 3,
                              fontWeight: 600,
                            }}
                          >
                            文字あり
                          </span>
                        )}
                      </button>
                    );
                  })}
              </div>

              {cropError && (
                <div className="note warn" style={{ marginTop: 10 }}>
                  <i className="i">!</i>
                  <span>{cropError}</span>
                </div>
              )}

              {uploadError && (
                <div className="note warn" style={{ marginTop: 10 }}>
                  <i className="i">!</i>
                  <span>{uploadError}</span>
                </div>
              )}

              {checkUnavailable && (
                <div className="note warn" style={{ marginTop: 10 }}>
                  <i className="i">!</i>
                  <span>
                    写真に文字が写り込んでいないかの自動チェックが実行できませんでした。
                    そのため今回はすべての写真を未判定のまま候補に表示しています。
                    価格表記やキャッチコピーなどの文字が写っている写真を選ぶと、切り抜いたときに
                    文字が途中で切れることがあるため、選ぶ前にご自身でご確認ください。
                    {imageScan?.error && (
                      <>
                        <br />
                        <b style={{ fontWeight: 600 }}>要因：</b>
                        {imageScan.error}
                      </>
                    )}
                  </span>
                </div>
              )}

              {!checkUnavailable && (() => {
                const withText = imageScan?.items.filter((x) => x.hasText) ?? [];
                const clean = imageScan?.items.filter((x) => !x.hasText) ?? [];
                // AIの文字チェックに回らなかった画像（判定件数の上限などで対象外になったもの）。
                // 「文字なし」と決めつけて候補に出すと文字入りのまま使われかねないので、
                // 文字ありの写真と同じ「それも表示する」の裏に回す
                const checkedUrls = new Set((imageScan?.items ?? []).map((x) => x.url));
                const unverified = (site?.images ?? [])
                  .filter((u) => !looksLikeCasePhoto(u))
                  .filter((u) => !checkedUrls.has(u));
                const hiddenCount = withText.length + unverified.length;
                if (hiddenCount === 0 && clean.length > 0) return null;
                return (
                  <div className="note" style={{ marginTop: 10 }}>
                    <i className="i">i</i>
                    <span>
                      写真は切り出さず、文字が重なっていない写真を優先して候補に出しています。
                      {clean.length === 0 && (
                        <> 今回は文字が重なっていない写真を判定できませんでした。{imageScan?.error && <>（要因：{imageScan.error}）</>}<br /></>
                      )}
                      {hiddenCount > 0 && (
                        <>
                          {" "}
                          {withText.length > 0 && (
                            <>文字が重なっている写真 <b style={{ fontWeight: 600 }}>{withText.length}枚</b></>
                          )}
                          {withText.length > 0 && unverified.length > 0 && "、"}
                          {unverified.length > 0 && (
                            <>文字の有無を確認できなかった写真 <b style={{ fontWeight: 600 }}>{unverified.length}枚</b></>
                          )}
                          は候補から外しています。
                          <button className="linkbtn" onClick={() => setShowTexted(!showTexted)}>
                            {showTexted ? "また隠す" : "それも表示する"}
                          </button>
                        </>
                      )}
                    </span>
                  </div>
                );
              })()}

              {photo && (
                <div className="crop">
                  <div className="row">
                    <span>テキストの重ね方</span>
                    <button className={photoLayout === "split" ? "on" : ""} onClick={() => setPhotoLayout("split")}>
                      画像とテキストを分ける
                    </button>
                    <button className={photoLayout === "overlay" ? "on" : ""} onClick={() => setPhotoLayout("overlay")}>
                      画像にテキストを重ねる
                    </button>
                  </div>
                  {photoLayout === "overlay" && (
                    <>
                      <small>
                        {(() => {
                          const info = imageScan?.items.find((x) => x.url === photo);
                          return info?.hasFace
                            ? "顔の位置を避けて、文字を重ねる場所を自動で選んでいます。"
                            : "視認性が高くなるよう、暗いグラデーションを敷いた上に文字を重ねます。";
                        })()}
                      </small>
                      <div className="row" style={{ marginTop: 8 }}>
                        <span>重ねる場所</span>
                        {([
                          ["top", "上"],
                          ["bottom", "下"],
                          ["left", "左"],
                          ["right", "右"],
                        ] as [TextZone, string][]).map(([z, label]) => (
                          <button key={z} className={photoTextZone === z ? "on" : ""} onClick={() => setPhotoTextZone(z)}>
                            {label}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  <div className="row" style={{ marginTop: photoLayout === "overlay" ? 8 : 0 }}>
                    <span>写真の入れ方</span>
                    <button className={photoFit === "cover" ? "on" : ""} onClick={() => setPhotoFit("cover")}>
                      切り抜く
                    </button>
                    <button className={photoFit === "contain" ? "on" : ""} onClick={() => setPhotoFit("contain")}>
                      全体を入れる
                    </button>
                  </div>
                  {photoFit === "cover" ? (
                    (() => {
                      // 写真の縦横比とバナー枠の縦横比の組み合わせ次第で、横・縦どちらかの
                      // スライダーがそのサイズには効かないことがある（cover の性質上、
                      // はみ出さない軸は動かしても変化しない）。選択中のサイズごとに
                      // 判定し、効かないサイズがあれば各スライダーの下に明示する
                      const per = photoNatural
                        ? chosenSizes.map((s) => ({ s, e: coverAxisEffect(s, photoNatural) }))
                        : [];
                      const xDead = per.filter((p) => !p.e.x).map((p) => p.s);
                      const yDead = per.filter((p) => !p.e.y).map((p) => p.s);
                      const label = (s: SizePreset) => `${s.media} ${s.w}×${s.h}`;
                      return (
                        <>
                          <div className="row">
                            <span>横の位置</span>
                            <input
                              type="range"
                              min={0}
                              max={100}
                              value={photoFocus.x}
                              onChange={(e) => setPhotoFocus((f) => ({ ...f, x: Number(e.target.value) }))}
                            />
                            <small>{photoFocus.x}%</small>
                          </div>
                          {xDead.length > 0 && (
                            <small className="hint" style={{ display: "block", marginTop: -4 }}>
                              {xDead.map(label).join("・")}ではこの写真だと変化しません（このサイズの枠は縦方向にしかはみ出さないため）
                            </small>
                          )}
                          <div className="row">
                            <span>縦の位置</span>
                            <input
                              type="range"
                              min={0}
                              max={100}
                              value={photoFocus.y}
                              onChange={(e) => setPhotoFocus((f) => ({ ...f, y: Number(e.target.value) }))}
                            />
                            <small>{photoFocus.y}%</small>
                          </div>
                          {yDead.length > 0 && (
                            <small className="hint" style={{ display: "block", marginTop: -4 }}>
                              {yDead.map(label).join("・")}ではこの写真だと変化しません（このサイズの枠は横方向にしかはみ出さないため）
                            </small>
                          )}
                        </>
                      );
                    })()
                  ) : (
                    <small>切らずに全体を入れます。余白が出ますが、画像内の文字は欠けません。</small>
                  )}
                </div>
              )}
            </div>
          )}

          <p style={{ fontSize: 12.5, color: "var(--faint)", marginTop: 12 }}>
            選択 {chosen.length} 案 × {chosenSizes.length} サイズ ＝ {chosen.length * chosenSizes.length} 枚
          </p>
          <button className="btn" style={{ marginTop: 14 }} onClick={() => guarded("zip", downloadZip)} disabled={!!busy || chosen.length === 0}>
            {busy === "zip" ? "書き出し中…" : "全部まとめてZIPで保存"}<span className="arw">↓</span>
          </button>
          {chosen.length === 0 && (
            <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 6 }}>上の「使うコピーを選ぶ」で1件以上チェックしてください</p>
          )}

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
                            <Banner service={service} facts={bannerFacts} id={`bn-${ci}-${s.id}`} copy={c} brand={d.brand} size={s} image={photoSrc} imageFit={photoFit} imageFocus={photoFocus} layout={photoLayout} textZone={photoTextZone} />
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
          </>
          </GuestMask>
        </section>
      )}
      {LP_GENERATION_ENABLED && chosen.length > 0 && (
        <section className="block no-print">
          <div className="sec-head" style={{ marginTop: 0 }}>
            <div>
              <h2 id="sec-lp">LP生成（ベータ）</h2>
              <div className="sub">広告と同じ訴求軸で着地を作ります</div>
            </div>
            <span className="rule" />
          </div>
          {isGuest && (
            <p className="sub">AIによるLP試作が可能です</p>
          )}
          <GuestMask guest={isGuest} label="LP生成は会員登録でご利用いただけます">
            <>
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
            </>
          </GuestMask>
        </section>
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
                  <Banner service={service} facts={bannerFacts} id={`zoom-${zoom.ci}-${zs.id}`} copy={zc} brand={d.brand} size={zs} image={photoSrc} imageFit={photoFit} imageFocus={photoFocus} layout={photoLayout} textZone={photoTextZone} />
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      <ReportChat id={id} />
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

/** 広告原稿1本。文字数と法令の指摘をその場に出す */
function AdLine({
  text, limit, mode, flag,
}: {
  text: string;
  limit: number;
  mode: CountMode;
  flag: { law: string; reason: string; suggestion: string } | null;
}) {
  const w = lengthIn(mode, text);
  const over = w > limit;
  // 全角換算の媒体は半角の数字で出すと運用者が読み替えることになるので、全角の数で出す
  const div = mode === "半角換算" ? 2 : 1;
  return (
    <div className={`ln${over ? " over" : ""}${flag ? " flagged" : ""}`}>
      <div className="t">
        <span>{text}</span>
        <small>{Math.ceil(w / div)}/{limit / div}</small>
      </div>
      {flag && (
        <div className="why">
          <b>{flag.law}</b>
          <span>{flag.reason}</span>
          <span className="fix">言い換え：{flag.suggestion}</span>
        </div>
      )}
    </div>
  );
}
