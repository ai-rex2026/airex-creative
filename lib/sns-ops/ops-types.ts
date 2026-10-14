import type { SnsPlatform } from "../social-connect/platforms";
import type { GuardVerdict } from "../types";

/**
 * 媒体ごとの「運用」（X 運用・Instagram 運用・TikTok 運用・YouTube 運用）の型。
 * 集める → 伸びた型を分析 → 案（画像・スレッドつき） → 人がまとめて承認 → 投稿 → 結果を次の案へ。
 */

export const OPS_PLATFORMS = ["x", "instagram", "tiktok", "youtube"] as const;
export type OpsPlatform = (typeof OPS_PLATFORMS)[number];

/** 画面の媒体 → 連携（sns_connections.platform）の名前 */
export const OPS_TO_CONN: Record<OpsPlatform, SnsPlatform> = { x: "x", instagram: "meta", tiktok: "tiktok", youtube: "youtube" };

export const OPS_LABEL: Record<OpsPlatform, string> = { x: "X運用", instagram: "Instagram運用", tiktok: "TikTok運用", youtube: "YouTube運用" };

export type XOpsConfig = {
  /** 参考にする伸びているアカウント（@なし） */
  benchHandles: string[];
  /** 反応する投稿を探すキーワード */
  keywords: string[];
  /** 毎日作る投稿案の数 */
  dailyDrafts: number;
  /** 毎日出す反応（リプライ・引用・リポスト）の候補の数 */
  dailyEngage: number;
  /** 投稿で避けること・決まりごと */
  rules: string;
};

export const DEFAULT_X_CONFIG: XOpsConfig = { benchHandles: [], keywords: [], dailyDrafts: 3, dailyEngage: 5, rules: "" };

export type OpsKind = "post" | "reply" | "quote" | "repost" | "dm";

export const KIND_LABEL: Record<OpsKind, string> = { post: "投稿", reply: "リプライ", quote: "引用", repost: "リポスト", dm: "DM の返信" };

export type OpsMedia = {
  key: string;
  type: "image" | "video";
  /** Storage（sns-media）上のパス。未生成は null */
  path: string | null;
  /** 画像生成への説明（英語。文字は描かせない） */
  prompt: string;
  alt: string;
  hasText?: boolean;
  error?: string | null;
  regen?: number;
  /** 画面表示用（DB には保存しない） */
  signedUrl?: string | null;
};

export type OpsTarget = {
  /** 反応する投稿 */
  externalId?: string;
  url?: string;
  author?: string;
  text?: string;
  /** 相手がこちらをメンション／こちらの投稿への返信（＝ X の API でリプライできる） */
  summoned?: boolean;
  /** DM の会話 */
  conversationId?: string;
  senderName?: string;
  lastMessage?: string;
};

export type OpsPostStatus = "draft" | "approved" | "published" | "skipped" | "failed";

export type OpsPost = {
  id: string;
  platform: SnsPlatform;
  kind: OpsKind;
  topic: string;
  body: string;
  thread: string[];
  hashtags: string[];
  media: OpsMedia[];
  pattern: string;
  reason: string;
  target: OpsTarget | null;
  guard: GuardVerdict | null;
  status: OpsPostStatus;
  source: "manual" | "auto";
  publishedVia: string | null;
  externalIds: string[];
  scheduledAt: string | null;
  approvedAt: string | null;
  publishedAt: string | null;
  errorMessage: string | null;
  metrics: Record<string, number | null> | null;
  createdAt: string;
};

export type ObservedPost = {
  id: string;
  source: "bench" | "search" | "own";
  externalId: string;
  author: string;
  authorName: string;
  authorFollowers: number | null;
  text: string;
  url: string;
  media: { type: string; url: string }[];
  likes: number | null;
  reposts: number | null;
  replies: number | null;
  quotes: number | null;
  views: number | null;
  bookmarks: number | null;
  mentionsMe: boolean;
  postedAt: string | null;
  /** コードで計算した反応率（%） */
  rate: number | null;
};

export type XPattern = {
  name: string;
  /** どう書くか（構成） */
  howTo: string;
  /** なぜ伸びていそうか（見立て） */
  why: string;
  /** 根拠にした投稿の ID */
  examples: string[];
  /** 自社で使えそうか */
  fit: string;
};

export type PatternReport = {
  id: string;
  summary: string;
  patterns: XPattern[];
  /** 自分の投稿の結果から分かったこと */
  ownLearnings: { finding: string; evidence: string; next: string }[];
  createdAt: string;
};

export type InboxMessage = { id: string; externalId: string; conversationId: string; senderId: string; senderName: string; fromMe: boolean; text: string; sentAt: string | null };

/** 反応率（%）：(いいね＋リポスト×2＋返信＋引用＋ブックマーク) ÷ 表示回数。表示回数が無ければフォロワー数で割る */
export function engagementRate(p: { likes: number | null; reposts: number | null; replies: number | null; quotes: number | null; bookmarks: number | null; views: number | null; authorFollowers?: number | null }): number | null {
  const e = (p.likes ?? 0) + 2 * (p.reposts ?? 0) + (p.replies ?? 0) + (p.quotes ?? 0) + (p.bookmarks ?? 0);
  const base = p.views && p.views > 0 ? p.views : p.authorFollowers && p.authorFollowers > 0 ? p.authorFollowers : null;
  return base ? Math.round((e / base) * 10000) / 100 : null;
}
