import type { Industry } from "./types";

/**
 * 17業種別・優先度マトリックス。
 *
 * 既存の Industry（beauty/medical/supplement/finance/general）は禁止表現の辞書を
 * 切り替えるための粗いカテゴリで、レポートの「どの章をどれだけ深く書くか」までは
 * 制御していない。ここではそれをさらに17業種へ細分化し、章（セクション）ごとに
 * 必須／任意／対象外を持たせて、AIへの指示文に優先度を注入する。
 *
 * 数値目標やスコアではなく「この業種ではこの章が重要か」という定性判断だけを持つ。
 * 実測の有無やAPI連携の有無とは独立（例：MEOは連携が無くても「必須」業種はある）。
 */
export type IndustryVertical =
  | "clinic_medical"
  | "clinic_aesthetic"
  | "dental"
  | "beauty_salon"
  | "supplement_subscription"
  | "general_ec"
  | "real_estate_sales"
  | "real_estate_rental"
  | "b2b_saas"
  | "b2b_other"
  | "finance_investment"
  | "legal_professional"
  | "education_school"
  | "restaurant_food"
  | "recruiting_hr"
  | "local_home_service"
  | "general_other";

export const INDUSTRY_VERTICAL_LABEL: Record<IndustryVertical, string> = {
  clinic_medical: "医療クリニック（保険診療中心）",
  clinic_aesthetic: "美容医療クリニック",
  dental: "歯科医院",
  beauty_salon: "美容室・エステ・ネイルサロン",
  supplement_subscription: "健康食品・サプリ定期通販",
  general_ec: "物販EC",
  real_estate_sales: "不動産売買・仲介",
  real_estate_rental: "賃貸不動産",
  b2b_saas: "BtoB SaaS・ITサービス",
  b2b_other: "BtoB（製造・商社・卸）",
  finance_investment: "金融・投資・保険",
  legal_professional: "士業（弁護士・税理士・社労士等）",
  education_school: "学習塾・スクール・資格講座",
  restaurant_food: "飲食店",
  recruiting_hr: "人材紹介・求人",
  local_home_service: "地域密着サービス（リフォーム・修理・引越等）",
  general_other: "その他一般",
};

/** 禁止表現の辞書を切り替える既存の粗いカテゴリへのマッピング（ガードレール用） */
export const INDUSTRY_VERTICAL_TO_INDUSTRY: Record<IndustryVertical, Industry> = {
  clinic_medical: "medical",
  clinic_aesthetic: "medical",
  dental: "medical",
  beauty_salon: "beauty",
  supplement_subscription: "supplement",
  general_ec: "general",
  real_estate_sales: "general",
  real_estate_rental: "general",
  b2b_saas: "general",
  b2b_other: "general",
  finance_investment: "finance",
  legal_professional: "general",
  education_school: "general",
  restaurant_food: "general",
  recruiting_hr: "general",
  local_home_service: "general",
  general_other: "general",
};

/** 優先度マトリックスの対象セクション（Studio の実装章・生成工程に対応） */
export type SectionKey =
  | "media_plan"
  | "ad_ops"
  | "meo"
  | "kpi"
  | "measures"
  | "lpo"
  | "keywords"
  | "seo_articles"
  | "line_plan"
  | "sns_plan"
  | "tactics"
  | "social_insights"
  | "outreach"
  | "pricing"
  | "speed";

export const SECTION_LABEL: Record<SectionKey, string> = {
  media_plan: "広告手法一覧",
  ad_ops: "広告運用設計",
  meo: "MEO（Googleマップ対策）",
  kpi: "KPIツリー",
  measures: "施策",
  lpo: "LP改善（受け皿の直し方）",
  keywords: "対策キーワード",
  seo_articles: "SEO記事設計",
  line_plan: "LINE公式アカウント",
  sns_plan: "SNSオーガニック運用・キャンペーン企画",
  tactics: "広告以外の施策",
  social_insights: "YouTube・Xの分析",
  outreach: "外部施策（自社サイトの外でやること）",
  pricing: "価格・損益分岐",
  speed: "表示速度",
};

export type SectionPriority = "required" | "optional" | "na";

type Row = Record<SectionKey, SectionPriority>;

/** 業種を問わず大半のレポートで軸になる章を土台にし、業種ごとに差分だけ上書きする */
function row(overrides: Partial<Row>): Row {
  const base: Row = {
    media_plan: "required",
    ad_ops: "required",
    meo: "optional",
    kpi: "required",
    measures: "required",
    lpo: "required",
    keywords: "optional",
    seo_articles: "optional",
    line_plan: "optional",
    sns_plan: "optional",
    tactics: "optional",
    social_insights: "optional",
    outreach: "optional",
    pricing: "optional",
    speed: "required",
  };
  return { ...base, ...overrides };
}

export const INDUSTRY_MATRIX: Record<IndustryVertical, Row> = {
  clinic_medical: row({
    meo: "required",
    keywords: "required",
    seo_articles: "required",
    pricing: "na",
    outreach: "optional",
  }),
  clinic_aesthetic: row({
    meo: "required",
    keywords: "required",
    seo_articles: "required",
    pricing: "required",
    sns_plan: "required",
  }),
  dental: row({
    meo: "required",
    keywords: "required",
    seo_articles: "optional",
    pricing: "na",
  }),
  beauty_salon: row({
    meo: "required",
    sns_plan: "required",
    keywords: "optional",
    line_plan: "required",
    pricing: "required",
  }),
  supplement_subscription: row({
    pricing: "required",
    keywords: "required",
    seo_articles: "required",
    sns_plan: "required",
    line_plan: "required",
    meo: "na",
  }),
  general_ec: row({
    pricing: "required",
    keywords: "required",
    seo_articles: "required",
    sns_plan: "required",
    meo: "na",
  }),
  real_estate_sales: row({
    meo: "required",
    keywords: "required",
    seo_articles: "required",
    outreach: "required",
    line_plan: "optional",
  }),
  real_estate_rental: row({
    meo: "required",
    keywords: "required",
    seo_articles: "optional",
    sns_plan: "na",
  }),
  b2b_saas: row({
    meo: "na",
    sns_plan: "na",
    line_plan: "na",
    keywords: "required",
    seo_articles: "required",
    outreach: "required",
    social_insights: "required",
  }),
  b2b_other: row({
    meo: "na",
    sns_plan: "na",
    line_plan: "na",
    outreach: "required",
    keywords: "optional",
  }),
  finance_investment: row({
    keywords: "required",
    seo_articles: "required",
    meo: "optional",
    outreach: "required",
    pricing: "na",
  }),
  legal_professional: row({
    meo: "required",
    keywords: "required",
    seo_articles: "required",
    outreach: "required",
    pricing: "na",
  }),
  education_school: row({
    meo: "required",
    keywords: "required",
    seo_articles: "optional",
    line_plan: "required",
    sns_plan: "required",
  }),
  restaurant_food: row({
    meo: "required",
    sns_plan: "required",
    line_plan: "required",
    keywords: "optional",
    seo_articles: "na",
    outreach: "optional",
  }),
  recruiting_hr: row({
    meo: "na",
    keywords: "required",
    seo_articles: "required",
    outreach: "required",
    sns_plan: "required",
  }),
  local_home_service: row({
    meo: "required",
    keywords: "required",
    seo_articles: "optional",
    outreach: "optional",
    line_plan: "optional",
  }),
  general_other: row({}),
};

/**
 * 診断結果から17業種のどれに当たるかを判定する。
 * 追加のAI呼び出しはしない（診断はすでに終わっているので、既存の Industry と
 * 商材・ターゲット・タイトルのテキストから決定的に分類する）。
 */
export function classifyIndustryVertical(d: {
  industry: Industry;
  product: string;
  audience: string;
  title: string;
}): IndustryVertical {
  const text = `${d.product} ${d.audience} ${d.title}`;
  const has = (...words: string[]) => words.some((w) => text.includes(w));

  if (d.industry === "medical") {
    if (has("美容外科", "美容皮膚科", "医療脱毛", "美容クリニック", "美容医療")) return "clinic_aesthetic";
    if (has("歯科", "デンタル", "矯正歯科", "インプラント", "歯医者")) return "dental";
    return "clinic_medical";
  }
  if (d.industry === "beauty") return "beauty_salon";
  if (d.industry === "supplement") return "supplement_subscription";
  if (d.industry === "finance") return "finance_investment";

  // general はテキストから業種を推定する
  if (has("賃貸", "入居者募集", "賃貸仲介")) return "real_estate_rental";
  if (has("不動産", "マンション売却", "土地売買", "一戸建て", "不動産売買")) return "real_estate_sales";
  if (has("SaaS", "クラウド", "法人向けシステム", "BtoB SaaS", "業務システム")) return "b2b_saas";
  if (has("卸", "商社", "製造業", "OEM", "法人向け", "業務用")) return "b2b_other";
  if (has("弁護士", "税理士", "社労士", "司法書士", "行政書士", "法律事務所", "会計事務所")) return "legal_professional";
  if (has("学習塾", "予備校", "スクール", "資格講座", "オンライン講座")) return "education_school";
  if (has("レストラン", "飲食店", "カフェ", "居酒屋", "焼肉", "ラーメン")) return "restaurant_food";
  if (has("求人", "採用支援", "人材紹介", "転職支援")) return "recruiting_hr";
  if (has("リフォーム", "水漏れ", "引越し", "害虫駆除", "エアコンクリーニング", "修理")) return "local_home_service";
  if (has("定期購入", "通販", "ネットショップ", "EC", "単品リピート")) return "general_ec";
  return "general_other";
}

/**
 * 業種×章の優先度を、AIへの指示文の一部として使える一文にする。
 * 生成関数の system instruction の末尾に足すことで、章の分量・深度を動的に変える。
 */
export function buildPriorityInstruction(vertical: IndustryVertical, section: SectionKey): string {
  const p = INDUSTRY_MATRIX[vertical][section];
  const label = INDUSTRY_VERTICAL_LABEL[vertical];
  if (p === "required") {
    return `【業種別の優先度：必須】業種「${label}」ではこの章の重要度が高い。一般的な分量より具体的・網羅的に書くこと。`;
  }
  if (p === "na") {
    return `【業種別の優先度：対象外】業種「${label}」では通常この章の該当性が低い。無理に一般論で埋めず、該当しにくい理由に軽く触れたうえで、必要最小限の記述にとどめる。`;
  }
  return `【業種別の優先度：任意】業種「${label}」ではこの章の優先度は標準。過不足なく簡潔に書く。`;
}
