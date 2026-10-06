import { askJson } from "./anthropic";
import type { Diagnosis } from "./types";
import type { SeoEstimate, SiteScan } from "./site-scan";
import type { KpiTree } from "./kpi";
import type { MeoScan } from "./meo";
import type { PriceScan } from "./pricing";
import type { SocialAccount, SocialScan } from "./social";
import type { SocialCompetitorScan } from "./social-competitors";
import { canonPlatform, isB2c } from "./biz-model";
import type { SpeedScan } from "./pagespeed";
import type { KeywordPlan, LpoPlan } from "./deep";
import type { SuggestScan } from "./outreach";
import type { GscData } from "./google";
import type { AdOps } from "./ad-ops";
import type { AdReview } from "./ad-review";
import { facts, fixNodes, flag, RULES, type Measure, type MeasurePlan } from "./measures";
import { MEASURED_ANCHORS, topicSection, type SourceItem } from "./measure-sources";

/**
 * サマリータブ（旧「施策」タブ）の生成。
 *
 * 2026-10-04: 「KPIを絞って、絞った分だけ施策を出す」という考え方から、
 * 「全データ（22章の分析結果）を評価してから、弱い所・測れない所に効く
 * 施策を優先して見せる」という考え方へ転換した（前セッションでの合意）。
 * カテゴリ別評価（evaluations）は実測値からの決定的な判定で、AI呼び出しは
 * 無い。施策（measures）の生成だけが唯一の有料API呼び出しで、呼び出し元
 * （lib/analysis.ts）が章ごとの即保存・catchでラップする既存パターンを
 * そのまま使う（このファイル単体でPromise.allを使う箇所は無い）。
 */

export type CategoryKey = "広告の準備" | "広告" | "MEO" | "SEO強度" | "対策キーワード充足度" | "LP" | "SNS" | "検索サジェスト" | "外部施策";

export type CategoryEvaluation = {
  category: CategoryKey;
  score: "強" | "標準" | "弱" | null; // null = 分析不可
  measured: boolean; // 実測フラグ。falseならscoreは常にnull
  basis: string; // このスコアの根拠（文言）
  sectionAnchor: string; // 分析データタブの対応id（例: "sec-meo"）
};

export type SummaryTab = {
  evaluations: CategoryEvaluation[];
  measures: Measure[];
};

/**
 * 「強/標準/弱」の境界値。
 * 2026-10-04決定：本来は同業種内の相対評価が望ましいが、他利用者の分析結果を
 * 業種別に集計する仕組みが無いため、今回は固定しきい値で実装する
 * （将来、業種別集計ができたら置き換える前提）。
 */
function tier(score: number, strongAt: number, standardAt: number): "強" | "標準" | "弱" {
  return score >= strongAt ? "強" : score >= standardAt ? "標準" : "弱";
}

/** サイト健全性の評価は、LPのセキュリティ項目と重なるため出さない。以前に保存された評価に残っていれば取り除く（表示専用） */
export function withSiteHealth(evs: CategoryEvaluation[] | null, _site?: SiteScan | null): CategoryEvaluation[] | null {
  return evs ? evs.filter((e) => (e.category as string) !== "サイト健全性") : evs;
}

function evalAdTags(adOps: AdOps | null): CategoryEvaluation {
  const anchor = "sec-tags";
  if (!adOps || adOps.tags.length === 0) {
    return { category: "広告の準備", score: null, measured: false, basis: "計測タグの判定がまだできていません", sectionAnchor: anchor };
  }
  const required = adOps.tags.filter((t) => t.need === "必須");
  if (required.length === 0) {
    return { category: "広告の準備", score: "標準", measured: true, basis: "必須タグの対象媒体が無いため、現状を「標準」としています", sectionAnchor: anchor };
  }
  const missing = required.filter((t) => t.status === "未導入");
  const unchecked = required.filter((t) => t.status === "要確認");
  if (missing.length > 0) {
    return {
      category: "広告の準備",
      score: "弱",
      measured: true,
      basis: `必須タグ${required.length}件中${missing.length}件が未導入です`,
      sectionAnchor: anchor,
    };
  }
  if (unchecked.length > 0) {
    return {
      category: "広告の準備",
      score: "標準",
      measured: true,
      basis: `必須タグ${required.length}件中${unchecked.length}件が要確認です`,
      sectionAnchor: anchor,
    };
  }
  return { category: "広告の準備", score: "強", measured: true, basis: `必須タグ${required.length}件がすべて導入済みです`, sectionAnchor: anchor };
}

/** MEOは既存の店舗間相対評価（grade()による近隣比較込みのscore/scoreMax）をそのまま使う */
function evalMeo(meo: MeoScan | null): CategoryEvaluation {
  const anchor = "sec-meo";
  if (!meo?.self) {
    return { category: "MEO", score: null, measured: false, basis: "Googleビジネスプロフィールが取得できていません", sectionAnchor: anchor };
  }
  const ratio = meo.scoreMax > 0 ? meo.score / meo.scoreMax : 0;
  const score = tier(ratio * 100, 70, 40);
  return {
    category: "MEO",
    score,
    measured: true,
    basis: `近隣${meo.totalShops}店中の実測評価で${meo.score}/${meo.scoreMax}点です`,
    sectionAnchor: anchor,
  };
}

/** estimateSeo（lib/site-scan.ts）が既に使っている境界値（70/45）をそのまま流用する */
function evalSeo(seo: SeoEstimate | null): CategoryEvaluation {
  const anchor = "sec-seo";
  if (!seo) {
    return { category: "SEO強度", score: null, measured: false, basis: "サイトが読めていないため推定できません", sectionAnchor: anchor };
  }
  return {
    category: "SEO強度",
    score: tier(seo.score, 70, 45),
    measured: true,
    basis: `推定スコア${seo.score}点（${seo.label}）です`,
    sectionAnchor: anchor,
  };
}

function evalKeywordCoverage(gsc: GscData | null, keywords: KeywordPlan | null): CategoryEvaluation {
  const anchor = "sec-kw";
  if (!gsc || gsc.queries.length === 0) {
    return { category: "対策キーワード充足度", score: null, measured: false, basis: "Search Console が連携されていません", sectionAnchor: anchor };
  }
  const positions = (keywords?.rows ?? []).map((r) => r.position).filter((p): p is number => p !== null);
  const avgPosition =
    positions.length > 0
      ? positions.reduce((n, p) => n + p, 0) / positions.length
      : gsc.totals.position || 100;
  // 位置は小さいほど良い。しきい値は固定（同業種内の相対評価は未実装、2026-10-04決定）
  const score = avgPosition <= 10 ? "強" : avgPosition <= 30 ? "標準" : "弱";
  return {
    category: "対策キーワード充足度",
    score,
    measured: true,
    basis: `対策キーワードの平均掲載順位は${avgPosition.toFixed(1)}位です`,
    sectionAnchor: anchor,
  };
}

/**
 * LP（新設カテゴリ）。
 * 2026-10-04決定：表示速度の実測（PageSpeed）をスコアのアンカーにし、
 * LPOのAI定性所見（ファーストビュー/CTA/信頼性）に重大度判定を追加した上で
 * 合成する（重大な指摘が多いほど減点）。単純な指摘件数は使わない
 * （generateLpo は実測の有無に関わらず常に3〜5件を出す設計のため）。
 */
function evalLp(speed: SpeedScan | null, lpo: LpoPlan | null): CategoryEvaluation {
  const anchor = "sec-lpo";
  if (!speed || speed.score === null) {
    // その場の計測（スコア）が取れず、実ユーザーの計測値（CrUX）だけ取れた場合は、LCP の判定で評価する
    const lcp = speed?.field.find((f) => f.id === "LARGEST_CONTENTFUL_PAINT_MS");
    if (lcp?.rating) {
      const t = lcp.rating === "良好" ? "強" : lcp.rating === "改善が必要" ? "標準" : "弱";
      return {
        category: "LP",
        score: t,
        measured: true,
        basis: `実ユーザーの計測値でLCP（主役の表示）が${lcp.value}（${lcp.rating}）です（その場の計測スコアは取れていません）`,
        sectionAnchor: anchor,
      };
    }
    return { category: "LP", score: null, measured: false, basis: "PageSpeed Insights の計測が取れていません", sectionAnchor: anchor };
  }
  const base = tier(speed.score, 70, 45);
  const heavyCount = (lpo?.groups ?? []).reduce(
    (n, g) => n + g.items.filter((it) => typeof it !== "string" && it.severity === "重").length,
    0
  );
  const DOWNGRADE_AT = 3; // 「重」の指摘がこの件数以上なら1段階下げる
  const order: ("強" | "標準" | "弱")[] = ["強", "標準", "弱"];
  const downgraded = heavyCount >= DOWNGRADE_AT && base !== "弱" ? order[order.indexOf(base) + 1] : base;
  return {
    category: "LP",
    score: downgraded,
    measured: true,
    basis:
      heavyCount > 0
        ? `表示速度スコア${speed.score}点に、重大な指摘${heavyCount}件を反映しています`
        : `表示速度スコア${speed.score}点です（重大な指摘はありません）`,
    sectionAnchor: anchor,
  };
}

const TIER_POINT = { 強: 2, 標準: 1, 弱: 0 } as const;
const pointToTier = (avg: number): "強" | "標準" | "弱" => (avg >= 1.5 ? "強" : avg >= 0.75 ? "標準" : "弱");

/** 投稿1件あたりの反応（いいね＋コメント＋シェア）の平均 ÷ フォロワー数。反応数が1つも取れていなければ null */
function engagementRate(a: SocialAccount): number | null {
  const posts = (a.recentPosts ?? []).filter((p) => p.likes !== null || p.comments !== null || p.shares !== null);
  if (!a.followers || posts.length === 0) return null;
  const total = posts.reduce((n, p) => n + (p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0), 0);
  return total / posts.length / a.followers;
}

/** いちばん新しい投稿が何日前か。投稿日時が取れていなければ null */
function daysSinceLatestPost(a: SocialAccount, now: number): number | null {
  const times = (a.recentPosts ?? [])
    .map((p) => (p.postedAt ? Date.parse(p.postedAt) : NaN))
    .filter((t) => Number.isFinite(t));
  if (times.length === 0) return null;
  return Math.max(0, Math.round((now - Math.max(...times)) / 86_400_000));
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}

/**
 * SNS。取得できた媒体数ではなく、取得したデータを分析した結果で評価する。
 * 見るのは次の3つ（媒体ごとに、取れているものだけ。取れていない指標は数えない）:
 *  - 更新の新しさ（最新の投稿が何日前か）
 *  - 投稿への反応（投稿1件あたりの反応数 ÷ フォロワー数）
 *  - 競合との比較（競合の実測が取れた媒体だけ。フォロワー数を競合の中央値と比べる）
 * LINEは友だち数が公開されず分析できないので対象に含めない。
 * 一般消費者向け（B2C）ではFacebookの優先度が低いため、評価には入れない。
 */
function evalSocial(
  social: SocialScan | null,
  competitors: SocialCompetitorScan | null,
  b2c: boolean,
  now: number = Date.now()
): CategoryEvaluation {
  const anchor = "sec-social";
  const detected = (social?.accounts ?? []).filter((a) => canonPlatform(a.platform) !== "LINE");
  if (detected.length === 0) {
    return { category: "SNS", score: null, measured: false, basis: "分析できるSNSアカウントが見つかっていません", sectionAnchor: anchor };
  }

  const lines: string[] = [];
  const points: number[] = [];
  for (const a of detected) {
    if (!a.readable) continue;
    const plat = canonPlatform(a.platform);
    if (b2c && plat === "Facebook") continue; // 優先度が低い媒体は評価に入れない
    const signals: { name: string; t: "強" | "標準" | "弱"; text: string }[] = [];

    const days = daysSinceLatestPost(a, now);
    if (days !== null) {
      signals.push({ name: "更新", t: days <= 14 ? "強" : days <= 45 ? "標準" : "弱", text: days === 0 ? "最終投稿が今日" : `最終投稿${days}日前` });
    }
    const er = engagementRate(a);
    if (er !== null) {
      const lowBar = plat === "X" ? [0.002, 0.0005] : [0.01, 0.003];
      signals.push({ name: "反応", t: er >= lowBar[0] ? "強" : er >= lowBar[1] ? "標準" : "弱", text: `反応率${(er * 100).toFixed(2)}%` });
    }
    const comp = (competitors?.items ?? []).filter((c) => canonPlatform(c.account.platform) === plat && c.account.followers);
    const med = median(comp.map((c) => c.account.followers as number));
    if (med && a.followers) {
      const r = a.followers / med;
      signals.push({ name: "競合比", t: r >= 1 ? "強" : r >= 0.3 ? "標準" : "弱", text: `フォロワーが競合の${Math.round(r * 100)}%` });
    }
    if (signals.length === 0) continue;
    const avg = signals.reduce((n, s) => n + TIER_POINT[s.t], 0) / signals.length;
    points.push(avg);
    // 2026-10-06: 全項目を並べると長すぎたので、評価が「弱」の項目だけを媒体ごとに出す
    const weak = signals.filter((s) => s.t === "弱").map((s) => s.text);
    if (weak.length > 0) lines.push(`${plat ?? a.platform}は${weak.join("・")}`);
  }

  if (points.length === 0) {
    return {
      category: "SNS",
      score: null,
      measured: false,
      basis: "投稿の更新・反応を分析できる媒体がありません（投稿内容が取得できていません）",
      sectionAnchor: anchor,
    };
  }
  const overall = pointToTier(points.reduce((n, p) => n + p, 0) / points.length);
  return {
    category: "SNS",
    score: overall,
    measured: true,
    basis:
      lines.length > 0
        ? `${points.length}媒体を分析。弱い点：${lines.join("／")}`
        : `${points.length}媒体を分析。更新頻度・反応・競合比に弱い点はありません`,
    sectionAnchor: anchor,
  };
}

/**
 * 検索サジェスト。取得できた件数ではなく、取れた語を分類した結果で評価する。
 * 「注意が必要な語」「誘導先に注意」「同名の別物」は放置すると不利になる語なので、
 * 全体に占める割合が低いほど良いとみなす。
 */
function evalSuggest(suggests: SuggestScan | null): CategoryEvaluation {
  const anchor = "sec-suggest";
  if (!suggests || suggests.error || suggests.rows.length === 0) {
    return {
      category: "検索サジェスト",
      score: null,
      measured: false,
      basis: suggests?.error ? `分析できませんでした（${suggests.error}）` : "サジェストが取得できておらず、分析できていません",
      sectionAnchor: anchor,
    };
  }
  const rows = suggests.rows;
  const count = (k: string) => rows.filter((r) => r.kind === k).length;
  const caution = count("注意");
  const detour = count("誘導先に注意");
  const sameName = count("同名の別物");
  const neutral = rows.length - caution - detour - sameName;
  const riskShare = (caution + detour + sameName) / rows.length;
  const score = riskShare <= 0.1 ? "強" : riskShare <= 0.3 ? "標準" : "弱";
  return {
    category: "検索サジェスト",
    score,
    measured: true,
    basis: `${rows.length}語を分類：注意が必要${caution}語・誘導先に注意${detour}語・同名の別物${sameName}語・問題なし${neutral}語（不利になりうる語は${Math.round(riskShare * 100)}%）`,
    sectionAnchor: anchor,
  };
}

/**
 * 「広告」（広告アカウントの運用実績）の評価を「広告の準備」の次に差し込む（表示専用・保存しない）。
 * 2026-10-06: 広告アカウントの連携は分析ごとではなく利用者ごとなので、保存済みの評価には入れず、
 * 画面を開くたびに連携の有無から作る。実績の良し悪しを判定する基準はまだ無いため、連携済みでも
 * 評価は付けない（分析不可のまま、連携先だけを示す）。
 * sectionAnchor が "/" で始まるときは、分析データタブ内ではなくそのページへ移動する（Measures.tsx）
 */
export function withAdAccounts(
  evs: CategoryEvaluation[] | null,
  connectedNames: string[],
  isGuest = false,
  /** その分析で読んだ広告の実績（2026-10-06〜の分析）。あればこちらを優先する */
  review?: AdReview | null
): CategoryEvaluation[] | null {
  if (!evs) return evs;
  const fromReview: CategoryEvaluation | null =
    review?.status === "ok"
      ? review.analysisError || !review.analyzed
        ? { category: "広告", score: null, measured: false, basis: "広告の実績は取得できましたが、分析できませんでした", sectionAnchor: "sec-adreview" }
        : { category: "広告", score: review.score ?? null, measured: (review.score ?? null) !== null, basis: review.basis || "広告の実績を分析しました", sectionAnchor: "sec-adreview" }
      : review?.status === "noselection"
        ? { category: "広告", score: null, measured: false, basis: "広告アカウント は連携済みですが、分析するアカウントが選ばれていません", sectionAnchor: "/analysis/new" }
        : review?.status === "error"
          ? { category: "広告", score: null, measured: false, basis: "広告の実績を取得できませんでした", sectionAnchor: "/settings" }
          : null;
  const ad: CategoryEvaluation =
    fromReview ??
    (connectedNames.length > 0
      ? {
          category: "広告",
          score: null,
          measured: false,
          basis: `${connectedNames.join("・")} と連携済み。実績は新規分析の画面で確認できます（評価は準備中）`,
          sectionAnchor: "/analysis/new",
        }
      : {
          category: "広告",
          score: null,
          measured: false,
          basis: "広告アカウント が連携されていません",
          sectionAnchor: isGuest ? "/login?mode=signup" : "/settings",
        });
  const rest = evs.filter((e) => e.category !== "広告");
  const at = rest.findIndex((e) => e.category === "広告の準備");
  return at < 0 ? [ad, ...rest] : [...rest.slice(0, at + 1), ad, ...rest.slice(at + 1)];
}

/** 実測ソースが無いため常に分析不可（2026-10-04・既決） */
function evalOutreach(): CategoryEvaluation {
  return { category: "外部施策", score: null, measured: false, basis: "実測できるソースがありません", sectionAnchor: "sec-outreach" };
}

export function evaluateCategories(input: {
  /** サイト健全性の判定に使う */
  site?: SiteScan | null;
  adOps: AdOps | null;
  meo: MeoScan | null;
  seo: SeoEstimate | null;
  gsc: GscData | null;
  keywords: KeywordPlan | null;
  speed: SpeedScan | null;
  lpo: LpoPlan | null;
  social: SocialScan | null;
  suggests: SuggestScan | null;
  /** SNS競合の実測。自社との比較に使う。無くても評価できる */
  socialCompetitors?: SocialCompetitorScan | null;
  /** 一般消費者向けかの判定に使う。無ければB2Cとみなす */
  diagnosis?: Diagnosis | null;
}): CategoryEvaluation[] {
  return [
    evalAdTags(input.adOps),
    evalMeo(input.meo),
    evalSeo(input.seo),
    evalKeywordCoverage(input.gsc, input.keywords),
    evalLp(input.speed, input.lpo),
    evalSocial(input.social, input.socialCompetitors ?? null, isB2c(input.diagnosis)),
    evalSuggest(input.suggests),
    evalOutreach(),
  ];
}

/**
 * 施策（measures）の生成。旧 generateMeasures と同じ1回のAI呼び出し
 * （KPIを絞らず、常に全KPI候補に対して出す）。evaluateCategories（決定的・
 * 無料）とは別の関数に分けている。呼び出し元（lib/analysis.ts）で、
 * 無料のevaluationsが有料API呼び出しの成否に引きずられて失われないようにする
 */
export async function generateSummaryMeasures(
  d: Diagnosis,
  site: SiteScan | null,
  kpi: KpiTree,
  meo: MeoScan | null,
  pricing: PriceScan | null,
  extra: { platform: string; url: string }[] = [],
  doneTitles: string[] = [],
  social: SocialScan | null = null,
  priorityNote?: string,
  /**
   * 分析データタブで提案済みの打ち手（lib/measure-sources.ts）。2026-10-05から、施策はここから選んで
   * まとめる（分析データに無い施策は2件まで）。空なら従来どおり、材料だけから考える
   */
  ledger: SourceItem[] = []
): Promise<Measure[]> {
  const useLedger = ledger.length > 0;
  let res: MeasurePlan;
  try {
    res = await askJson<MeasurePlan>(
    `あなたは集客の実務者です。下のKPIに効く施策を設計します。

${RULES}
- items は10〜14件。効果の見込みが大きいものから考え、分析データの打ち手をなるべく広く拾う
- **node を1つに集中させない。** 上のノードのうち少なくとも3つに散らす。
  「問い合わせを増やす」だけでなく、来院率・単価・リピートを動かす施策も考える
${useLedger ? LEDGER_RULES : ""}
${priorityNote ? `\n${priorityNote}` : ""}`,
    `${facts(d, site, meo, pricing, extra, doneTitles, social)}
${useLedger ? `
【分析データで提案済みの打ち手】※ 施策はここから選んでまとめる。sources にこの番号を入れる
${ledger.map((x) => `- ${x.id}［${x.chapter}／${x.category}${x.unverified ? "／実施状況は未確認" : ""}］${x.text}`).join("\n")}
` : ""}
【追うKPI】
${kpi.candidates.map((c) => `- ${c.id}：${c.name}（${c.node}）／ ${c.trackable}`).join("\n")}

【KPIツリーのノード】※ node にはこの中の語をそのまま使う
${kpi.branches.map((b) => `- ${b.node}（${b.formula}）`).join("\n")}

【カテゴリ】※ category にはこの中の語をそのまま1つ使う（その施策が主に改善するもの）
${CATEGORY_NAMES.map((c) => `- ${c}`).join("\n")}

出力:
{"items":[{"id":"m1","title":"","kpis":["k1"],"node":"","category":"","impact":"大","impactWhy":"",
 "effort":"すぐ","owner":"","steps":[""],"done":""${useLedger ? `,"sources":["s1"]` : ""}}]}`,
    { maxTokens: 10000 }
  );
  } catch (e) {
    // 施策を空のまま保存しない。台帳があれば、分析データの打ち手をそのまま施策として出す
    if (!useLedger) throw e;
    return await flag(measuresFromLedger(ledger, kpi), d.industry);
  }
  let raw = useLedger ? attachSources(res.items ?? [], ledger) : (res.items ?? []);
  // 施策に使われなかった分析データの打ち手も、効果中の施策として足す（supplementFromLedger）
  if (useLedger) raw = supplementFromLedger(raw, ledger, kpi);
  const items = fixNodes(raw, kpi).map((m) => ({ ...m, category: normalizeCategory(m) }));
  const trackingMissing = trackingKnownMissing(site);
  return await flag(items.filter((m) => !isUnverifiableTagMeasure(m, trackingMissing || fromConfirmedTags(m))), d.industry);
}

const LEDGER_RULES = `- **施策は【分析データで提案済みの打ち手】から選んでまとめる。** 近い打ち手は1つの施策に束ねてよい。
  各施策の sources に、元にした打ち手の番号（s1 など）を1つ以上入れる。打ち手の中身を変えて別の施策にしない
- 分析データに無い施策は**2件まで**。その施策だけ sources を空の配列 [] にする
- category は、元にした打ち手のカテゴリに合わせる
- 「実施状況は未確認」の打ち手（広告キャンペーン・アフィリエイト・掲載先など）は、すでに実施しているかどうかが
  分かっていない。「未実施です」「まだ行っていません」と決めつけて書かない。title の頭に注記は付けない（こちらで付ける）`;

/** すでに実施しているかを確かめられない施策のタイトルの頭に付ける語 */
export const UNVERIFIED_PREFIX = "（もし未実施であれば）";

function withPrefix(m: Measure, unverified: boolean): Measure {
  if (!unverified) return { ...m, unverified: false };
  const title = m.title.startsWith(UNVERIFIED_PREFIX) ? m.title : `${UNVERIFIED_PREFIX}${m.title}`;
  return { ...m, title, unverified: true };
}

/** 分析データに無い施策の上限 */
const MAX_OUTSIDE = 2;
/** サマリーに出す施策の上限（AIが作った分＋台帳から足した分） */
const MAX_MEASURES = 40;

/**
 * 分析データタブで出した打ち手のうち、どの施策にも使われていないものを「効果 中」の施策として足す（AIは使わない）。
 * 2026-10-06: 分析データで出した打ち手をサマリーでもできるだけ見せる。件数が多いと画面では折り畳む。
 * 実データの章（MEO・LP改善・表示速度・計測タグ）の打ち手を先に、それ以外を後に並べる。
 * 作成済みの分析にも、レポートを開いたときに同じ処理で足す（app/analysis/[id]/report/page.tsx）
 */
export function supplementFromLedger(measures: Measure[], ledger: SourceItem[], kpi: KpiTree): Measure[] {
  const used = new Set(measures.flatMap((m) => (m.sources ?? []).map((s) => s.id)));
  const have = new Set(measures.map((m) => m.id));
  const rest = ledger
    .filter((x) => !used.has(x.id) && !have.has(`l-${x.id}`))
    .sort((a, b) => Number(MEASURED_ANCHORS.has(b.anchor)) - Number(MEASURED_ANCHORS.has(a.anchor)));
  const room = Math.max(0, MAX_MEASURES - measures.length);
  if (rest.length === 0 || room === 0) return measures;
  const speedShown = ledger.some((x) => x.anchor === "sec-speed");
  const added = ledgerToMeasures(rest.slice(0, room), kpi, "").map((m, i) => ({ ...m, id: `l-${rest[i].id}` }));
  return [...measures, ...added.map((m) => reconcileSources(m, speedShown))];
}

/**
 * 施策のリンク先を、題名の話題（表示速度・LPの改修）に合わせる。AIが別の章の打ち手を元にしていても、
 * 題名がLPの改修ならリンク先は「LP改善」にする。リンク先が実データの章だけなら「（もし未実施であれば）」は付けない。
 * 画面側（components/Measures.tsx）でも、作成済みの施策に同じ補正をかける
 */
export function reconcileSources(m: Measure, speedShown = true): Measure {
  if (m.outside) return m;
  const topic = topicSection(m.title, speedShown);
  let sources = m.sources ?? [];
  if (topic && sources.length > 0 && !sources.some((s) => s.anchor === topic.anchor)) {
    sources = [{ id: sources[0].id, chapter: topic.chapter, anchor: topic.anchor }];
  }
  const allMeasured = sources.length > 0 && sources.every((s) => MEASURED_ANCHORS.has(s.anchor));
  const title = allMeasured && m.title.startsWith(UNVERIFIED_PREFIX) ? m.title.slice(UNVERIFIED_PREFIX.length) : m.title;
  return { ...m, sources, title, unverified: allMeasured ? false : m.unverified };
}

/**
 * AIが付けた sources（台帳の番号）を検証して、画面用の章名・移動先に置き換える。
 * 存在しない番号は捨てる。元が1つも無い施策は「分析データ外」とし、2件を超えた分は捨てる
 */
export function attachSources(items: Measure[], ledger: SourceItem[]): Measure[] {
  const byId = new Map(ledger.map((x) => [x.id, x]));
  let outside = 0;
  const out: Measure[] = [];
  for (const m of items) {
    const ids = Array.isArray(m.sources) ? m.sources.map((s) => (typeof s === "string" ? s : (s as { id?: string })?.id ?? "")) : [];
    const found = [...new Set(ids)].map((id) => byId.get(String(id).trim())).filter((x): x is SourceItem => !!x);
    if (found.length === 0) {
      if (outside >= MAX_OUTSIDE) continue;
      outside++;
      // 分析データに無い施策は、実施しているかを何も確かめていない
      out.push(withPrefix({ ...m, sources: [], outside: true }, true));
      continue;
    }
    // 元にした打ち手がすべて「実施状況は未確認」なら、冒頭に注記を付ける
    out.push(withPrefix({
      ...m,
      sources: found.map((x) => ({ id: x.id, chapter: x.chapter, anchor: x.anchor })),
      outside: false,
      // カテゴリが空・不正なら、元にした打ち手のカテゴリを使う
      category: m.category && (CATEGORY_NAMES as readonly string[]).includes(m.category) ? m.category : found[0].category,
    }, found.every((x) => x.unverified)));
  }
  const speedShown = ledger.some((x) => x.anchor === "sec-speed");
  return out.map((m) => reconcileSources(m, speedShown));
}

const OWNER: Record<string, string> = {
  広告の準備: "広告運用担当",
  MEO: "店舗責任者",
  SEO強度: "サイト制作会社",
  対策キーワード充足度: "Web担当者",
  LP: "サイト制作会社",
  SNS: "SNS担当者",
  検索サジェスト: "Web担当者",
  外部施策: "広報担当",
};

/**
 * AIの生成に失敗したときの代わり。台帳からカテゴリごとに先頭の1件を施策にする（AIを使わない）。
 * 文面は分析データに書いてあるものをそのまま使い、効果の見込みは数字を出さない
 */
export function measuresFromLedger(ledger: SourceItem[], kpi: KpiTree): Measure[] {
  const picked = CATEGORY_NAMES.map((c) => ledger.find((x) => x.category === c)).filter((x): x is SourceItem => !!x);
  return ledgerToMeasures(picked, kpi, "f");
}

/** 台帳の打ち手を、そのまま施策の形にする（AIを使わない）。効果の見込みは「中」 */
function ledgerToMeasures(picked: SourceItem[], kpi: KpiTree, prefix: string): Measure[] {
  const node = kpi.branches[0]?.node ?? kpi.candidates[0]?.node ?? "";
  return picked.map((x, i) => withPrefix({
    id: `${prefix}${i + 1}`,
    title: x.text.length > 60 ? `${x.text.slice(0, 59)}…` : x.text,
    kpis: kpi.candidates[0] ? [kpi.candidates[0].id] : [],
    node,
    category: x.category,
    impact: "中",
    impactWhy: `分析データの「${x.chapter}」で提案している打ち手です。詳しい根拠はその章をご覧ください。`,
    effort: "数日",
    owner: OWNER[x.category] ?? "Web担当者",
    steps: [x.text, `分析データの「${x.chapter}」の内容を確認し、担当と期日を決める`, "対応したら、この施策を「実施済み」にする"],
    done: `「${x.chapter}」の該当の打ち手を実施した`,
    sources: [{ id: x.id, chapter: x.chapter, anchor: x.anchor }],
    outside: false,
  }, !!x.unverified));
}

/** 「カテゴリ別評価」のカテゴリ名（evaluateCategories が返す category と同じ語） */
export const CATEGORY_NAMES = ["広告の準備", "広告", "MEO", "SEO強度", "対策キーワード充足度", "LP", "SNS", "検索サジェスト", "外部施策"] as const;

/**
 * 施策の文面から、どのカテゴリの施策かを推定する（AIが category を返さなかった・古い分析向け）。
 * 語の出現数が最も多いカテゴリを採る。1語も当たらなければ null。
 */
const CATEGORY_HINTS: Record<(typeof CATEGORY_NAMES)[number], RegExp> = {
  広告の準備: /広告アカウント|リマーケ|広告タグ|広告媒体|運用型広告|リスティング|P-?MAX|出稿|入札|予算配分/g,
  広告: /CPA|ROAS|CTR|CVR|クリック単価|除外キーワード|入札単価|広告の実績|配信実績/g,
  MEO: /MEO|Googleマップ|ビジネスプロフィール|GBP|口コミ|店舗情報|写真投稿|営業時間/g,
  SEO強度: /SEO|内部リンク|メタ|タイトルタグ|構造化データ|サイトマップ|見出し|robots|canonical|被リンク/g,
  対策キーワード充足度: /キーワード|検索クエリ|Search Console|記事|コラム|コンテンツ|検索順位|検索流入/g,
  LP: /LP|ランディング|表示速度|ファーストビュー|CTA|予約フォーム|入力フォーム|導線|料金表|ページ速度/g,
  SNS: /SNS|Instagram|インスタ|TikTok|YouTube|ショート動画|リール|X（|Twitter|Facebook|LINE|投稿|フォロワー/g,
  検索サジェスト: /サジェスト|指名検索|ブランド名で検索|ブランド検索/g,
  外部施策: /プレスリリース|PR|被リンク|メディア掲載|ポータル|比較サイト|インフルエンサー|アフィリエイト|取材|寄稿/g,
};

export function inferCategory(m: Pick<Measure, "title" | "impactWhy" | "steps">): (typeof CATEGORY_NAMES)[number] | null {
  const text = `${m.title} ${m.impactWhy ?? ""} ${(m.steps ?? []).join(" ")}`;
  let best: (typeof CATEGORY_NAMES)[number] | null = null;
  let bestN = 0;
  for (const c of CATEGORY_NAMES) {
    const n = text.match(CATEGORY_HINTS[c])?.length ?? 0;
    if (n > bestN) {
      best = c;
      bestN = n;
    }
  }
  return best;
}

/** AIが返した category が正しい語ならそれを使い、そうでなければ文面から推定する */
function normalizeCategory(m: Measure): string | undefined {
  if (m.category && (CATEGORY_NAMES as readonly string[]).includes(m.category)) return m.category;
  return inferCategory(m) ?? undefined;
}

/**
 * 「計測タグ（GTM・コンバージョンタグ・ピクセル）を設置する」系の施策を落とす。
 * 対象は、電話番号タップ・LINE友だち追加リンク・予約/申込の完了画面・フォーム送信など。
 * これらは設置済みかどうかをプログラムでは確認できない（実際には設置済みの場合が多い）うえ、
 * 予約フォームが別ドメインで自社のGTMでは計測できないことも多いため、施策としては出さない
 * （プロンプト側のRULESにも明記しているが、AIが守らない場合の保険として生成後にも機械的に除く）
 */
export function isUnverifiableTagMeasure(m: Pick<Measure, "title" | "impactWhy">, trackingMissing = false): boolean {
  // 「計測まわりの施策」かどうかはタイトルで判定する（本文には SEO の「タイトルタグ」など別の語が混ざるため）
  const isTracking = /計測|トラッキング|パラメータ|UTM|GTM|タグマネージャー|GA4|アナリティクス|ピクセル|Pixel|コンバージョンタグ|CVタグ|タグ(の)?設置|タグを設置|イベント(設定|計測)|アトリビューション/i.test(m.title);
  if (!isTracking) return false;
  // 電話・LINE・予約完了・フォーム送信・URLパラメータ等の個別の計測は、設置済みかをプログラムで確認できないので常に出さない
  const text = `${m.title} ${m.impactWhy ?? ""}`;
  if (/電話|LINE|友だち追加|友達追加|予約(完了|申込|申し込み)|完了画面|フォーム送信|問い合わせ完了|パラメータ|UTM/i.test(text)) return true;
  // それ以外の計測の施策は、サイトを読んで「GTM・広告タグが入っていない」ことが分かっているときだけ出す
  return !trackingMissing;
}

/**
 * 分析データの「計測タグの導入状況」で未導入と確認できたタグ（GTMのコンテナまで読んだうえでの判定）を
 * 元にした施策か。この場合は計測の施策でも出してよい（電話・LINE等の個別計測は引き続き出さない）
 */
export function fromConfirmedTags(m: Pick<Measure, "sources">): boolean {
  return (m.sources ?? []).some((s) => s.anchor === "sec-tags");
}

/** サイトのHTMLから、GTM・広告タグのどちらも検出できなかったか（＝計測タグが未設置と分かっている状態） */
export function trackingKnownMissing(site: { gtmId: string | null; adTags: string[] } | null | undefined): boolean {
  return !!site && !site.gtmId && (site.adTags?.length ?? 0) === 0;
}

/**
 * サマリータブ全体（evaluations + measures）を一度に作る。
 * 画面からの「施策を作り直す」操作（app/actions.ts の regenerateSummaryTab）向け。
 * パイプライン本体（lib/analysis.ts）は、evaluations と measures を別々に
 * 保存するためこの関数を使わず、evaluateCategories と generateSummaryMeasures を
 * 個別に呼ぶ
 */
export async function generateSummaryTab(
  d: Diagnosis,
  site: SiteScan | null,
  kpi: KpiTree,
  meo: MeoScan | null,
  pricing: PriceScan | null,
  seo: SeoEstimate | null,
  gsc: GscData | null,
  keywords: KeywordPlan | null,
  speed: SpeedScan | null,
  lpo: LpoPlan | null,
  social: SocialScan | null,
  suggests: SuggestScan | null,
  adOps: AdOps | null,
  extra: { platform: string; url: string }[] = [],
  doneTitles: string[] = [],
  priorityNote?: string,
  ledger: SourceItem[] = []
): Promise<SummaryTab> {
  const evaluations = evaluateCategories({ site, adOps, meo, seo, gsc, keywords, speed, lpo, social, suggests });
  const measures = await generateSummaryMeasures(d, site, kpi, meo, pricing, extra, doneTitles, social, priorityNote, ledger);
  return { evaluations, measures };
}

/**
 * 「優先度の高い施策」の並び順（表示専用。保存はしない）。
 * 2026-10-04決定：一次ソートはスコアが低いカテゴリ優先、二次ソートで
 * Measure.impact/effortも加味する。
 */
const SCORE_RANK: Record<string, number> = { 弱: 0, 標準: 1, 強: 2 }; // null(分析不可)は弱と同じ扱い
const IMPACT_RANK: Record<string, number> = { 大: 0, 中: 1, 小: 2 };
const EFFORT_RANK: Record<string, number> = { すぐ: 0, 数日: 1, 数週間: 2 };

/**
 * Measure.node（KPIツリーの語。例: "問い合わせを増やす"）から、対応するカテゴリ評価
 * （例: "LP"）を推定する。直接一致しないことが多いため部分一致で見る。
 * 分からない場合は null（画面側・並び順側の両方で「不明」として扱う）。
 */
export function categoryForMeasure(m: Measure, evaluations: CategoryEvaluation[]): CategoryEvaluation | null {
  // 1) 生成時に付けたカテゴリ 2) 文面からの推定 3) 従来のノード名の部分一致、の順に使う
  const named = m.category ?? inferCategory(m);
  const byName = named ? evaluations.find((e) => e.category === named) : undefined;
  if (byName) return byName;
  return evaluations.find((e) => m.node && (m.node.includes(e.category) || e.category.includes(m.node))) ?? null;
}

export function sortMeasuresByPriority(measures: Measure[], evaluations: CategoryEvaluation[]): Measure[] {
  const rankOf = (m: Measure) => {
    // Measure.node はKPIツリーの語で、カテゴリ名と直接一致しないことが多いため、
    // 対応するカテゴリが分かる場合だけスコアを使う。分からない施策は中間順位にする
    const matched = categoryForMeasure(m, evaluations);
    return matched ? (matched.score === null ? SCORE_RANK["弱"] : SCORE_RANK[matched.score]) : 1;
  };
  // 2026-10-06: 効果の見込みが大きいものを先頭に並べる（一次）。同じ効果の中では、評価の弱いカテゴリ、
  // 手間の少ないものの順
  return [...measures].sort((a, b) => {
    const impact = (IMPACT_RANK[a.impact] ?? 1) - (IMPACT_RANK[b.impact] ?? 1);
    if (impact !== 0) return impact;
    const primary = rankOf(a) - rankOf(b);
    if (primary !== 0) return primary;
    return (EFFORT_RANK[a.effort] ?? 1) - (EFFORT_RANK[b.effort] ?? 1);
  });
}
