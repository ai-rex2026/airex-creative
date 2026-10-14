import type { GuardVerdict, Industry } from "../types";

/**
 * AIO（AI検索対策）の型。店舗（MEO）とは独立して、会社・サービス単位で
 * 「今どうか（AIに聞いたとき候補に挙がるか）」と「何をすべきか（AIに拾われるための下書き）」を扱う。
 */

export type AioProject = {
  id: string;
  name: string;
  aliases: string[];
  url: string | null;
  industry: Industry;
  area: string;
  category: string;
  notes: string;
  siteSummary: string;
  /** 月次で全プロンプトを自動実測する */
  monitoringEnabled: boolean;
  createdAt: string;
};

export type AioCheckStatus = "pending" | "running" | "completed" | "failed";

export type AioCheck = {
  id: string;
  /** 対策プロンプトの id。null は「探し方」からの定型文での実測 */
  promptId: string | null;
  source: "manual" | "monthly";
  status: AioCheckStatus;
  engine: string;
  model: string;
  prompt: string;
  mentioned: boolean;
  rank: number | null;
  listed: string[];
  citedSources: { url: string; title: string; domain: string }[];
  ownSourceDomains: string[];
  rawAnswer: string;
  searchQueries: string[];
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type AioDraftKind = "site_article" | "note_article" | "press_release" | "survey_article" | "faq_schema" | "wantedly_story" | "job_posting_schema" | "listing_memo";

export const AIO_DRAFT_KINDS: { kind: AioDraftKind; label: string; description: string; recruit?: boolean }[] = [
  { kind: "site_article", label: "自社サイトの記事", description: "自社ドメインに載せる解説記事（SEOに近い。AIが引用しやすい見出し構成と事実の書き方）" },
  { kind: "note_article", label: "note の記事", description: "noteに出す読み物。自社の経験・考えを一人称で書き、AIに拾われやすい固有名詞と数字を入れる" },
  { kind: "press_release", label: "プレスリリース", description: "ニュース媒体に取り上げられるための発表文（PR TIMES 等の体裁）。事実のみ" },
  { kind: "survey_article", label: "アンケート記事", description: "調査設計（設問）と、結果を入れれば完成する記事の型。ファクトを作ってから書くので媒体に取り上げられやすい" },
  { kind: "faq_schema", label: "FAQ と構造化データ", description: "サイトに置く FAQ 5問と、その schema.org JSON-LD（AIが読み取りやすい形）" },
  { kind: "wantedly_story", label: "Wantedly ストーリー", description: "人・仕事・カルチャーを伝える記事（採用）。note と同じ事実を別ドメインで出す", recruit: true },
  { kind: "job_posting_schema", label: "採用ページの構造化データ", description: "採用サイト向けの Organization／JobPosting／FAQPage の JSON-LD と、ファクトの見出し化指示", recruit: true },
  { kind: "listing_memo", label: "掲載先の整理", description: "AIが根拠にした媒体の一覧と、自社が載っていない媒体への登録メモ（Wikipedia 等は要件も）" },
];

/** ギャップ分析（競合にあって自社にない情報）の結果。aio_gap_reports.body */
export type AioGapReport = {
  id: string;
  period: string;
  summary: string;
  gaps: { topic: string; evidence: string; media: string; idea: string }[];
  mediaTargets: { domain: string; reason: string; action: string }[];
  createdAt: string;
};

/** 月次コンテンツ計画の1項目。aio_content_plans.items */
export type AioPlanItem = {
  id: string;
  kind: AioDraftKind;
  title: string;
  /** どのプロンプト（問い）に答える内容か */
  target: string;
  outline: string;
  week: number;
  status: "planned" | "drafted" | "done";
  draftId: string | null;
};

export type AioContentPlan = {
  id: string;
  month: string;
  items: AioPlanItem[];
  createdAt: string;
};

export type AioDraft = {
  id: string;
  kind: AioDraftKind;
  title: string;
  body: string;
  guard: GuardVerdict | null;
  status: "draft" | "done";
  createdAt: string;
};

/** 1か月（JST）に手動で実行できる実測の回数（1回ごとに web 検索つきの AI 呼び出しが走る）。月次の自動計測は別枠 */
export const AIO_MONTHLY_LIMIT = 30;

/** 対策プロンプト（Vector 等の AIO サービスでいう Prompt Design。狙う問いを決め、月次で全部測る） */
export type AioPromptCategory = "issue" | "recommend" | "compare" | "track_record" | "select" | "trust" | "recruit";
export const AIO_PROMPT_CATEGORY_LABEL: Record<AioPromptCategory, string> = {
  issue: "課題",
  recommend: "おすすめ",
  compare: "比較",
  track_record: "実績",
  select: "選定",
  trust: "信頼性",
  recruit: "採用",
};
export const MAX_ACTIVE_PROMPTS = 20;

export type AioPrompt = {
  id: string;
  text: string;
  category: AioPromptCategory;
  active: boolean;
  createdAt: string;
};
