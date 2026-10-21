import type { GuardVerdict } from "../types";

/**
 * AIO の「運用」＝ 自社サイトのコラム記事・note 記事の型。
 * 既存記事のトンマナを読み → 画像つきで記事を作り → WordPress は人の承認で公開／note は貼って人が投稿 →
 * 数字を見て改善案を出す、までを1つの流れで扱う。
 */

export type AioChannelKind = "site" | "note" | "satellite";

export const CHANNEL_LABEL: Record<AioChannelKind, string> = { site: "自社サイトのコラム", note: "note", satellite: "サテライトサイト" };

/** DB の文字列から媒体の種類を読む（不明なものは自社サイト扱い。古い行との互換） */
export function channelKindOf(v: unknown): AioChannelKind {
  return v === "note" ? "note" : v === "satellite" ? "satellite" : "site";
}

/** WordPress で公開する媒体（自社サイト・サテライトサイト）。note は人が投稿する */
export const isWpKind = (k: AioChannelKind) => k === "site" || k === "satellite";

/**
 * サテライトサイト（2026-10-21〜）：自社とは別の第三者ドメインで、他社の商品・サービスも扱って発信する比較・解説メディア。
 * Google のスパムに関する方針（リンクスキーム・大量生成）と景品表示法のステマ規制（2023-10〜）に触れないよう、
 * 運営者の明記・自社商品の PR 表記・自社への誘導リンクの rel="sponsored" をコードで必ず付ける（AI には任せない）。
 */
export type AioSatelliteItem = {
  /** 商品・サービス名 */
  name: string;
  /** 公式サイトなど、事実の出どころ */
  url: string;
  /** 記事に書いてよい事実（公開情報から人が入れたもの。ここに無い数字・価格・機能は書かない） */
  facts: string;
  /** 自社（運営者・関連会社）の商品か */
  own: boolean;
};

export type AioSatellite = {
  /** メディアの名前 */
  mediaName: string;
  /** 何を扱うメディアか（ジャンル・読者） */
  theme: string;
  /** 運営者の表記（会社名など。記事の冒頭の PR 表記と運営者情報に使う） */
  operator: string;
  /** 自社との関係（自社運営・グループ会社・提携 など） */
  relation: string;
  /** 扱う商品・サービス */
  items: AioSatelliteItem[];
};

/** 既存記事から読んだトンマナ。記事を書くときにそのまま指示として渡す */
export type AioStyle = {
  /** 1行で言うとどんな書き方か */
  summary: string;
  /** 文体（です・ます／だ・である、一人称、語りかけ等） */
  voice: string;
  /** 読者 */
  reader: string;
  /** 見出しの付け方（数・言い回し・疑問形か等） */
  headings: string;
  /** 導入とまとめ・問い合わせへのつなげ方 */
  structure: string;
  /** よく使う言い回し・避けている言い回し */
  phrases: string;
  /** 画像の使い方（枚数・雰囲気） */
  imagery: string;
  /** 既存記事が扱っているテーマ（重複を避けるため） */
  topics: string[];
  /** コードで数えた実測（AIに数えさせない） */
  measured: { articles: number; avgChars: number; avgH2: number; politeRatio: number };
};

export type AioSample = { url: string; title: string; chars: number; h2: number };

/** アカウント／コラムが無いときの立ち上げ支援と戦略 */
export type AioStrategy = {
  /** 立ち上げの手順（コードで固定の手順に、AI が事業に合わせた補足を足す） */
  setup: { title: string; detail: string }[];
  /** 誰に何を届けるか */
  concept: string;
  /** プロフィール文（note）／コラムの紹介文（サイト） */
  profile: string;
  /** カテゴリ（サイト）・マガジン（note） */
  categories: { name: string; purpose: string }[];
  /** 頻度と曜日の目安 */
  cadence: string;
  /** 最初に書く記事 */
  firstArticles: { title: string; target: string; why: string }[];
  createdAt: string;
};

export type AioChannel = {
  id: string;
  kind: AioChannelKind;
  sourceUrl: string | null;
  hasSource: boolean;
  style: AioStyle | null;
  samples: AioSample[];
  analyzedAt: string | null;
  strategy: AioStrategy | null;
  analytics: { gscSite?: string | null; ga4Property?: string | null; pathPrefix?: string | null } | null;
  /** サテライトサイトの設定（kind=satellite のときだけ） */
  satellite: AioSatellite | null;
};

export type AioImageRole = "eyecatch" | "inline";

export type AioArticleImage = {
  key: string;
  role: AioImageRole;
  /** inline のとき、何番目の見出し（##）の直後に置くか（0始まり） */
  afterH2: number | null;
  /** 画像生成に渡す説明（英語。文字を描かせない指示はコードで足す） */
  prompt: string;
  /** 代替テキスト（日本語。画像の中には入れない） */
  alt: string;
  /** Storage（aio-images）上のパス。未生成は null */
  path: string | null;
  /** 生成した画像に文字が入っていた（使わない） */
  hasText?: boolean;
  error?: string | null;
  /** 画面表示用（サーバーで署名したURL。DB には保存しない） */
  signedUrl?: string | null;
};

export type AioArticle = {
  id: string;
  channel: AioChannelKind;
  title: string;
  slug: string;
  metaDescription: string;
  keywords: string[];
  target: string;
  bodyMd: string;
  hashtags: string[];
  images: AioArticleImage[];
  guard: GuardVerdict | null;
  status: "draft" | "published";
  wpPostId: number | null;
  publishedUrl: string | null;
  publishedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
};

export type AioMetricSource = "gsc" | "ga4" | "note_manual" | "note_csv";

export type AioMetric = {
  id: string;
  channel: AioChannelKind;
  articleId: string | null;
  url: string;
  title: string;
  source: AioMetricSource;
  periodFrom: string | null;
  periodTo: string | null;
  views: number | null;
  clicks: number | null;
  impressions: number | null;
  position: number | null;
  engagementSec: number | null;
  likes: number | null;
  comments: number | null;
  queries: { query: string; clicks: number; impressions: number; position: number }[];
  createdAt: string;
};

/** 改善案 */
export type AioContentReview = {
  id: string;
  channel: AioChannelKind;
  summary: string;
  /** よく読まれている記事と、その理由の見立て */
  working: { title: string; why: string }[];
  /** 直す記事 */
  fixes: { title: string; url: string; problem: string; action: string; priority: "高" | "中" | "低" }[];
  /** 次に書く記事 */
  next: { title: string; target: string; why: string }[];
  createdAt: string;
};

/** WordPress の接続（秘密は含めない。画面に出す分だけ） */
export type AioWpInfo = { baseUrl: string; wpUser: string; siteName: string; categoryId: number | null; verifiedAt: string | null };

/** 1対象1か月あたりに作れる記事の数（本文＋画像で外部の AI を呼ぶため） */
export const ARTICLE_MONTHLY_LIMIT = 40;
/** 1記事の画像の枚数（アイキャッチ1＋本文中2） */
export const MAX_INLINE_IMAGES = 2;
