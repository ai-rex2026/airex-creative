/**
 * MEO運用ワークスペースのドメイン型（AI-REX 本体 features/meo/types.ts の移植）。
 *
 * 1レポート = 1店舗を前提に、分析（analyses.id）にぶら下がる運用データとして扱う。
 * サーバー（layout）で組み立ててクライアントへ渡すため、日時はすべて ISO 文字列で持つ。
 */

import type { GuardHit } from "../types";

/** Googleビジネスプロフィール（GBP）連携の状態 */
export type GbpConnectionStatus = "connected" | "disconnected" | "unclaimed";

/** 店舗の候補（チェーン店で1つに決められないとき人に選ばせる） */
export type StoreCandidate = { place_id: string; name: string; address: string | null };

/** 近隣競合1件（Places 実測） */
export type MeoCompetitor = {
  placeId: string;
  name: string;
  rating: number | null;
  reviewCount: number | null;
  photoCount: number | null;
};

/** 確定した店舗の Places 実測。analyses.meo_store に保存する */
export type MeoStoreSnapshot = {
  placeId: string;
  name: string;
  address: string | null;
  /** 業種の表示名（Places の primaryTypeDisplayName） */
  category: string | null;
  primaryType: string | null;
  phoneNumber: string | null;
  websiteUrl: string | null;
  mapsUri: string | null;
  rating: number | null;
  reviewCount: number | null;
  photoCount: number | null;
  priceLevel: number | null;
  hasOpeningHours: boolean;
  location: { latitude: number; longitude: number } | null;
  competitors: MeoCompetitor[];
  meoScore: number | null;
  ratingRank: number | null;
  reviewRank: number | null;
  fetchedAt: string;
};

/** ワークスペースの対象店舗 */
export interface MeoStore {
  id: string;
  name: string;
  address: string | null;
  category: string | null;
  phoneNumber: string | null;
  websiteUrl: string | null;
  gbpStatus: GbpConnectionStatus;
  /** MEOスコア（0-100） */
  meoScore: number | null;
  rating: number | null;
  reviewCount: number | null;
  /** 競合内での評価順位 / 母数 */
  ratingRank: number | null;
  competitorCount: number;
  lastSyncedAt: string | null;
}

/** プロフィール完成度の項目 */
export interface ProfileChecklistItem {
  key: string;
  label: string;
  description: string;
  done: boolean;
  /** スコアへの寄与（合計100） */
  weight: number;
  /** GBP管理画面でしか編集できない項目は外部リンク扱いにする */
  editableInApp: boolean;
}

/**
 * 口コミへの返信状態。
 * pending / failed はサーバー（GBPへの送信）が管理する状態で、
 * 画面は「送信中」「送信失敗」として表示する。
 */
export type ReviewReplyStatus = "unreplied" | "pending" | "replied" | "needsUpdate" | "failed";

export interface MeoReview {
  id: string;
  authorName: string;
  rating: number;
  text: string;
  createdAt: string;
  status: ReviewReplyStatus;
  reply: string | null;
  repliedAt: string | null;
  /** 口コミ内容のAIO（AI検索最適化）スコア 1-5 */
  aioScore: number | null;
  errorMessage: string | null;
}

export type MeoPostStatus = "draft" | "scheduled" | "published";

export interface MeoPost {
  id: string;
  title: string;
  body: string;
  status: MeoPostStatus;
  scheduledAt: string | null;
  publishedAt: string | null;
  imageUrl: string | null;
  actionButton: { label: string; url: string } | null;
  aiGenerated: boolean;
  errorMessage: string | null;
}

/** 活用分析の1指標（前月比つき） */
export interface MeoMetric {
  key: string;
  label: string;
  /** null は「まだ取得できていない」。0（露出が無かった）と区別する */
  value: number | null;
  unit: string;
  changeRate: number | null;
  higherIsBetter: boolean;
}

/** 日次スナップショットの1点 */
export interface MeoDailyPoint {
  date: string;
  meoScore: number | null;
  reviewCount: number;
  newReviewCount: number | null;
  averageRating: number | null;
}

/** AIによる改善提案 */
export interface MeoSuggestion {
  id: string;
  title: string;
  body: string;
  priority: "high" | "medium" | "low";
  actionPath: string | null;
  actionLabel: string | null;
}

export type MeoPostInput = Pick<
  MeoPost,
  "title" | "body" | "status" | "scheduledAt" | "imageUrl" | "actionButton" | "aiGenerated"
>;

export interface MeoFieldTopic {
  id: string;
  label: string;
  count: number;
  sentiment: "positive" | "negative";
  quotes: string[];
}

export interface MeoAiReplySettings {
  keywords: string[];
  tone: "polite" | "friendly" | "formal";
  styleInstruction: string;
  ngWords: string[];
  signature: string;
}

export interface MeoNotificationSettings {
  newReview: boolean;
  editedReview: boolean;
  monthlyReport: boolean;
}

export interface MeoProfileDraft {
  description: string;
  paymentMethods: string[];
  attributes: Record<string, boolean>;
  storeName: string;
  phoneNumber: string;
  address: string;
  websiteUrl: string;
}

export interface MeoTodo {
  id: string;
  label: string;
  count: number;
  path: string;
  actionLabel: string;
  tone: "urgent" | "normal";
}

export interface MeoPhotoOverview {
  ownCount: number | null;
  competitors: { name: string; count: number }[];
}

// ── AI検索可視性（AIO） ─────────────────────────
export type AiSearchEngine = "gemini" | "claude";
export type AiSearchCheckStatus = "pending" | "running" | "completed" | "failed";

export interface AiSearchCitedSource {
  url: string;
  title: string;
  domain: string;
}

export interface AiSearchCheck {
  id: string;
  engine: AiSearchEngine;
  model: string;
  status: AiSearchCheckStatus;
  queryArea: string;
  queryCategory: string;
  prompt: string;
  mentioned: boolean;
  rank: number | null;
  listedStores: string[];
  citedSources: AiSearchCitedSource[];
  ownSourceDomains: string[];
  rawAnswer: string;
  searchQueries: string[];
  searchSuggestionsHtml: string;
  errorMessage: string | null;
  executedAt: string;
}

export type AiSourceCoverageStatus = "listed" | "notFound" | "unknown";

export interface AiSourcePlatform {
  key: string;
  label: string;
  usedBy: string;
  status: AiSourceCoverageStatus;
  citedCount: number;
  manageUrl: string | null;
}

export type AiContentTechnique = "statistics" | "quotation" | "citeSources";

export interface AiContentSuggestion {
  id: string;
  target: "gbpDescription" | "gbpPost" | "siteSchema";
  technique: AiContentTechnique;
  title: string;
  body: string;
  sourceNote: string;
  /** 生成と同時に通した法令チェック（辞書）の指摘。無ければ空 */
  guardHits: GuardHit[];
}

export interface AiSearchHistoryEntry {
  checkId: string;
  date: string;
  mentioned: boolean;
  rank: number | null;
}

export interface AiSearchSummary {
  totalChecks: number;
  mentionedChecks: number;
  history: AiSearchHistoryEntry[];
  sources: AiSourcePlatform[];
  suggestions: AiContentSuggestion[];
  lastCheckedAt: string | null;
}

export interface MeoAiSearchData {
  checks: AiSearchCheck[];
  summary: AiSearchSummary;
}

/** ワークスペース全体のデータ */
export interface MeoWorkspaceData {
  store: MeoStore;
  checklist: ProfileChecklistItem[];
  reviews: MeoReview[];
  posts: MeoPost[];
  metrics: MeoMetric[];
  metricsPeriod: string | null;
  daily: MeoDailyPoint[];
  gbpLocationName: string | null;
  /** GBP（Google ビジネスプロフィール）の Google 連携が済んでいるか */
  gbpConnected: boolean;
  ownPlaceId: string | null;
  ownPlaceIdSource: "auto" | "manual" | null;
  storeCandidates: StoreCandidate[];
  photos: MeoPhotoOverview;
  fieldTopics: MeoFieldTopic[];
  suggestions: MeoSuggestion[];
  aiReplySettings: MeoAiReplySettings;
  notificationSettings: MeoNotificationSettings;
  profileDraft: MeoProfileDraft;
  aiSearch: MeoAiSearchData;
}
