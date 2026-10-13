import type { SnsPlatform } from "../social-connect/platforms";
import type { GuardVerdict, Industry } from "../types";

/**
 * SNS運用（公式アカウントへの投稿案）の型。
 * 投稿は人が確認してから。自動で動くのは「下書きを作る」まで（AGENTS.md の決めごと）。
 */

export type SnsPostStatus = "draft" | "published" | "skipped";

export type SnsPost = {
  id: string;
  topicId: string;
  platform: SnsPlatform;
  topic: string;
  body: string;
  hashtags: string[];
  guard: GuardVerdict | null;
  status: SnsPostStatus;
  source: "manual" | "auto";
  publishedVia: "api" | "copy" | null;
  externalId: string | null;
  errorMessage: string | null;
  publishedAt: string | null;
  createdAt: string;
};

export type SnsSettings = {
  autoEnabled: boolean;
  /** 0=日 … 6=土（JST） */
  autoWeekday: number;
  brandName: string;
  brandUrl: string;
  brandNotes: string;
  industry: Industry;
};

export const DEFAULT_SNS_SETTINGS: SnsSettings = {
  autoEnabled: false,
  autoWeekday: 1,
  brandName: "",
  brandUrl: "",
  brandNotes: "",
  industry: "general",
};

/** 設定画面で連携したアカウント（トークンは含めない）＋投稿に使える方法 */
export type SnsAccount = {
  platform: SnsPlatform;
  label: string | null;
  followers: number | null;
  connectedAt: string;
  /** API で直接投稿できるか（X は tweet.write を含む再連携が必要。Instagram/TikTok はコピー運用） */
  canPublishViaApi: boolean;
  /** API投稿できない理由（画面に出す）。できるときは null */
  publishNote: string | null;
};

export const WEEKDAY_LABEL = ["日", "月", "火", "水", "木", "金", "土"];

/** 媒体ごとの書き分けの前提（文字数・体裁）。生成プロンプトと画面の両方で使う */
export const PLATFORM_STYLE: Record<SnsPlatform, { name: string; maxChars: number; hint: string }> = {
  x: { name: "X（Twitter）", maxChars: 140, hint: "全角140字以内。1投稿1メッセージ。冒頭で要点、ハッシュタグは1〜2個" },
  meta: { name: "Instagram", maxChars: 2200, hint: "写真に添えるキャプション。冒頭1行で引きを作り、改行を使って読みやすく。末尾にハッシュタグ5〜10個" },
  tiktok: { name: "TikTok", maxChars: 2200, hint: "動画の説明文。短く話し言葉で、ハッシュタグ3〜5個" },
};

/** 本文とハッシュタグを1つの投稿文にする（画面のプレビューと API 送信で同じ形にする） */
export function composeBody(body: string, hashtags: string[]): string {
  const tags = hashtags.filter(Boolean).map((h) => `#${h}`).join(" ");
  return tags ? `${body}\n\n${tags}` : body;
}
