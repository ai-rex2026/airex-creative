import type { GuardVerdict } from "../types";
import type { AioArticleImage } from "./content-types";

/**
 * PR TIMES に配信するプレスリリースの「入稿内容」。
 * 入稿そのものは人が PR TIMES の管理画面で行う（自動では送らない）。ここでは、そのまま貼れる形に整える。
 * 事実を創作しない。与えられていない数字・日付・固有名詞は【要確認：〇〇】として残す。
 */

export const PRESS_MONTHLY_LIMIT = 10;
/** 本文中に置く画像の上限（メイン画像は別に1枚） */
export const PRESS_MAX_INLINE_IMAGES = 4;
export const PRESS_MAX_VIDEOS = 3;

export type PressKind = "service" | "product" | "survey" | "partnership" | "event" | "other";
export const PRESS_KINDS: { kind: PressKind; label: string }[] = [
  { kind: "service", label: "新サービス・機能の提供開始" },
  { kind: "product", label: "新商品の発売" },
  { kind: "survey", label: "調査結果の発表" },
  { kind: "partnership", label: "提携・協業・採用の発表" },
  { kind: "event", label: "イベント・キャンペーンの開催" },
  { kind: "other", label: "その他のお知らせ" },
];

export type PressContact = { company: string; department: string; person: string; email: string; tel: string };
export type PressVideo = { url: string; title: string; afterH2: number };

/** 人が入力する内容 */
export type PressBrief = {
  kind: PressKind;
  /** 何を発表したいか（必須） */
  announcement: string;
  /** 確かな事実（数字・日付・価格・提供開始日・対象・実績など）。ここに無い数字は書かない */
  facts: string;
  /** 配信を希望する日（YYYY-MM-DD。未定なら空） */
  releaseDate: string;
  contact: PressContact;
  /** 本文に入れたい動画（YouTube などの URL） */
  videos: { url: string; title: string }[];
  /** 書き手への補足（トーン・訴求したい点・載せたくないこと） */
  note: string;
};

/** AI が整えた入稿内容（人が編集できる） */
export type PressContent = {
  /** タイトル案（先頭が採用中のタイトル） */
  titleOptions: string[];
  title: string;
  subtitle: string;
  /** リード文（本文の冒頭の要約） */
  lead: string;
  /** 本文（Markdown。見出しは ##）。画像・動画の位置は images[].afterH2 / videos[].afterH2 で持つ */
  bodyMd: string;
  keywords: string[];
  /** 会社概要（会社名・所在地・代表・事業内容・URL。不明な項目は【要確認】） */
  companyProfile: string;
  /** 問い合わせ先の文面 */
  contactText: string;
  /** 関連リンク（URL と説明） */
  relatedLinks: { label: string; url: string }[];
  /** 入稿前に人が確認する項目（【要確認】の洗い出し） */
  todo: string[];
  videos: PressVideo[];
};

export type PressImage = AioArticleImage & {
  /** AI が作った／人がアップロードした */
  source?: "ai" | "upload";
  /** 画像の説明（PR TIMES の画像キャプションに貼る。日本語・画像内には入れない） */
  caption?: string;
};

export type PressRelease = {
  id: string;
  title: string;
  status: "draft" | "submitted";
  brief: PressBrief;
  content: PressContent;
  images: PressImage[];
  guard: GuardVerdict | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export const EMPTY_CONTACT: PressContact = { company: "", department: "", person: "", email: "", tel: "" };
