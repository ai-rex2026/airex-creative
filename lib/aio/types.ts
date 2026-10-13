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
  createdAt: string;
};

export type AioCheckStatus = "pending" | "running" | "completed" | "failed";

export type AioCheck = {
  id: string;
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

export type AioDraftKind = "site_article" | "note_article" | "press_release" | "faq_schema" | "listing_memo";

export const AIO_DRAFT_KINDS: { kind: AioDraftKind; label: string; description: string }[] = [
  { kind: "site_article", label: "自社サイトの記事", description: "自社ドメインに載せる解説記事（SEOに近い。AIが引用しやすい見出し構成と事実の書き方）" },
  { kind: "note_article", label: "note の記事", description: "noteに出す読み物。自社の経験・考えを一人称で書き、AIに拾われやすい固有名詞と数字を入れる" },
  { kind: "press_release", label: "プレスリリース", description: "ニュース媒体に取り上げられるための発表文（PR TIMES 等の体裁）。事実のみ" },
  { kind: "faq_schema", label: "FAQ と構造化データ", description: "サイトに置く FAQ 5問と、その schema.org JSON-LD（AIが読み取りやすい形）" },
  { kind: "listing_memo", label: "掲載先の整理", description: "AIが根拠にした媒体の一覧と、自社が載っていない媒体への登録メモ（Wikipedia 等は要件も）" },
];

export type AioDraft = {
  id: string;
  kind: AioDraftKind;
  title: string;
  body: string;
  guard: GuardVerdict | null;
  status: "draft" | "done";
  createdAt: string;
};

/** 1か月（JST）に実行できる実測の回数（店舗のAI検索と同じ。1回ごとに web 検索つきの AI 呼び出しが走る） */
export const AIO_MONTHLY_LIMIT = 10;
