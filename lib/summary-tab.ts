import { askJson } from "./anthropic";
import type { Diagnosis } from "./types";
import type { SeoEstimate, SiteScan } from "./site-scan";
import type { KpiTree } from "./kpi";
import type { MeoScan } from "./meo";
import type { PriceScan } from "./pricing";
import type { SocialScan } from "./social";
import type { SpeedScan } from "./pagespeed";
import type { KeywordPlan, LpoPlan } from "./deep";
import type { SuggestScan } from "./outreach";
import type { GscData } from "./google";
import type { AdOps } from "./ad-ops";
import { facts, fixNodes, flag, RULES, type Measure, type MeasurePlan } from "./measures";

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

export type CategoryKey = "広告の準備" | "MEO" | "SEO強度" | "対策キーワード充足度" | "LP" | "SNS" | "検索サジェスト" | "外部施策";

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

function evalSocial(social: SocialScan | null): CategoryEvaluation {
  const anchor = "sec-social";
  if (!social || social.accounts.length === 0) {
    return { category: "SNS", score: null, measured: false, basis: "公式SNSアカウントが見つかっていません", sectionAnchor: anchor };
  }
  const readable = social.accounts.filter((a) => a.readable).length;
  const ratio = readable / social.accounts.length;
  return {
    category: "SNS",
    score: tier(ratio * 100, 70, 30),
    measured: true,
    basis: `検出した${social.accounts.length}媒体中${readable}媒体の実測ができています`,
    sectionAnchor: anchor,
  };
}

function evalSuggest(suggests: SuggestScan | null): CategoryEvaluation {
  const anchor = "sec-suggest";
  if (!suggests || suggests.error || suggests.rows.length === 0) {
    return {
      category: "検索サジェスト",
      score: null,
      measured: false,
      basis: suggests?.error ? `取得できませんでした（${suggests.error}）` : "取得できていません",
      sectionAnchor: anchor,
    };
  }
  return {
    category: "検索サジェスト",
    score: tier(suggests.rows.length, 8, 3),
    measured: true,
    basis: `${suggests.rows.length}件のサジェストが取得できています`,
    sectionAnchor: anchor,
  };
}

/** 実測ソースが無いため常に分析不可（2026-10-04・既決） */
function evalOutreach(): CategoryEvaluation {
  return { category: "外部施策", score: null, measured: false, basis: "実測できるソースがありません", sectionAnchor: "sec-outreach" };
}

export function evaluateCategories(input: {
  adOps: AdOps | null;
  meo: MeoScan | null;
  seo: SeoEstimate | null;
  gsc: GscData | null;
  keywords: KeywordPlan | null;
  speed: SpeedScan | null;
  lpo: LpoPlan | null;
  social: SocialScan | null;
  suggests: SuggestScan | null;
}): CategoryEvaluation[] {
  return [
    evalAdTags(input.adOps),
    evalMeo(input.meo),
    evalSeo(input.seo),
    evalKeywordCoverage(input.gsc, input.keywords),
    evalLp(input.speed, input.lpo),
    evalSocial(input.social),
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
  priorityNote?: string
): Promise<Measure[]> {
  const res = await askJson<MeasurePlan>(
    `あなたは集客の実務者です。下のKPIに効く施策を設計します。

${RULES}
- items は6〜9件
- **node を1つに集中させない。** 上のノードのうち少なくとも3つに散らす。
  「問い合わせを増やす」だけでなく、来院率・単価・リピートを動かす施策も考える
${priorityNote ? `\n${priorityNote}` : ""}`,
    `${facts(d, site, meo, pricing, extra, doneTitles, social)}

【追うKPI】
${kpi.candidates.map((c) => `- ${c.id}：${c.name}（${c.node}）／ ${c.trackable}`).join("\n")}

【KPIツリーのノード】※ node にはこの中の語をそのまま使う
${kpi.branches.map((b) => `- ${b.node}（${b.formula}）`).join("\n")}

【カテゴリ】※ category にはこの中の語をそのまま1つ使う（その施策が主に改善するもの）
${CATEGORY_NAMES.map((c) => `- ${c}`).join("\n")}

出力:
{"items":[{"id":"m1","title":"","kpis":["k1"],"node":"","category":"","impact":"大","impactWhy":"",
 "effort":"すぐ","owner":"","steps":[""],"done":""}]}`,
    { maxTokens: 6000 }
  );
  const items = fixNodes(res.items ?? [], kpi).map((m) => ({ ...m, category: normalizeCategory(m) }));
  return await flag(items.filter((m) => !isUnverifiableTagMeasure(m)), d.industry);
}

/** 「カテゴリ別評価」のカテゴリ名（evaluateCategories が返す category と同じ語） */
export const CATEGORY_NAMES = ["広告の準備", "MEO", "SEO強度", "対策キーワード充足度", "LP", "SNS", "検索サジェスト", "外部施策"] as const;

/**
 * 施策の文面から、どのカテゴリの施策かを推定する（AIが category を返さなかった・古い分析向け）。
 * 語の出現数が最も多いカテゴリを採る。1語も当たらなければ null。
 */
const CATEGORY_HINTS: Record<(typeof CATEGORY_NAMES)[number], RegExp> = {
  広告の準備: /広告アカウント|リマーケ|広告タグ|広告媒体|運用型広告|リスティング|P-?MAX|出稿|入札|予算配分/g,
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
export function isUnverifiableTagMeasure(m: Pick<Measure, "title" | "impactWhy">): boolean {
  const text = `${m.title} ${m.impactWhy ?? ""}`;
  const mentionsTag = /GTM|タグマネージャー|計測タグ|コンバージョンタグ|CVタグ|ピクセル|Pixel|計測の設置|計測設定|タグ設置|タグを設置|タグの設置/i.test(text);
  const mentionsTarget = /電話|LINE|友だち追加|友達追加|予約(完了|申込|申し込み)|完了画面|フォーム送信|問い合わせ完了|コンバージョン/.test(text);
  return mentionsTag && mentionsTarget;
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
  priorityNote?: string
): Promise<SummaryTab> {
  const evaluations = evaluateCategories({ adOps, meo, seo, gsc, keywords, speed, lpo, social, suggests });
  const measures = await generateSummaryMeasures(d, site, kpi, meo, pricing, extra, doneTitles, social, priorityNote);
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
  return [...measures].sort((a, b) => {
    const primary = rankOf(a) - rankOf(b);
    if (primary !== 0) return primary;
    const impact = IMPACT_RANK[a.impact] - IMPACT_RANK[b.impact];
    if (impact !== 0) return impact;
    return EFFORT_RANK[a.effort] - EFFORT_RANK[b.effort];
  });
}
