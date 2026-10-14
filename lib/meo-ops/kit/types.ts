/**
 * 「やること」キット（オルコネレックスの MEO の作りを AI-REX に移したもの）。
 *
 * お店の URL（公式サイト・ホットペッパー・食べログ・Googleマップ）を入れるだけで、
 * 「やること」の一覧と、貼るだけの文章（今 → こう変える → なぜ／文字数／言葉のチェック済み）が出る。
 * 1 工程 = 1 回の呼び出しで、工程ごとに保存する（1本の失敗が他の成功を消さない。AGENTS.md の決まり）。
 */

import type { GuardHit } from "../../types";

/** 文章の書き分け。理美容（ホットペッパー中心）・飲食（Googleマップ中心）・その他の店舗 */
export type KitKind = "beauty" | "food" | "general";

export type KitStepId =
  | "scan"
  | "hpbpage"
  | "diagnose"
  | "score"
  | "hpb"
  | "meo"
  | "kit"
  | "coupon"
  | "aio"
  | "guard"
  | "winners"
  | "series";

/** 入れてもらうもの（URL と補足）。お店ごとに1行 */
export type KitInput = {
  url: string;
  note: string;
  /** 理美容：自動で見つからなかったときに入れてもらうホットペッパーの URL */
  hpbUrl: string;
  /** 口コミ画面で「お店に直接伝える」の宛先 */
  shopEmail: string;
  /** 口コミ画面に出す担当者名（任意） */
  staff: string[];
};

export type Copy = { field: string; text: string; limit?: number; count?: number; over?: boolean; before?: string; why?: string };

export type ScanResult = { title: string; text: string; finalUrl: string; via: "page" | "search" | "note" };
export type HpbPageResult = { url?: string; title?: string; text?: string; note?: string };

export type Diagnosis = {
  name: string;
  area: string;
  product: string;
  audience: string;
  strengths: string[];
  objections: string[];
  angles: { id: string; name: string; why: string }[];
  tone: string;
};

export type ScoreItem = { label: string; weight: number; score: number; reason: string; fix: string };
export type ScorePack = { total: number; rank: string; advice: string; items: ScoreItem[]; keywords: { word: string; found: boolean }[]; source: string; at: string };

export type HpbPack = { catch: Copy; intro: Copy; couponName: Copy; couponDesc: Copy; blog: Copy };
export type MeoPack = { description: Copy; posts: Copy[]; calendar: { week: string; theme: string }[]; menu?: Copy[] };
export type KitPack = { reviewUrl: string; pop: string[]; talk: string[]; line: string };
export type CouponPack = { items: { title: string; body: string; condition: string; expiry: string }[] };
export type AioPack = {
  current: { answer: string; sources: string[]; missing: string[]; engine: string; note: string };
  faq: { q: string; a: string }[];
  jsonld: string;
  jsonldMissing: string[];
  words: { word: string; why: string }[];
};
export type GuardPack = { hits: (GuardHit & { where: string })[]; checked: number; level: "green" | "yellow" | "red" };
export type Winner = {
  name: string;
  url?: string;
  works: string[];
  evidence: string;
  /** Google の登録情報（実測）。AI に作らせない数字 */
  rating?: number | null;
  reviewCount?: number | null;
  /** 何を読めたか：page=相手のページを直接読んだ / search=web 検索で集めた / places=Google の登録情報だけ / none=何も取れず */
  read?: "page" | "search" | "places" | "none";
};
export type WinnersPack = {
  from: "ai" | "places";
  items: Winner[];
  gaps: { point: string; ours: string; theirs: string }[];
  actions: { title: string; where: string; detail: string }[];
  note: string;
  at: string;
};
export type SeriesPost = { theme: string; title: string; body: string; count: number; createdAt: string; hits: GuardHit[] };
export type SeriesPack = { themes: { title: string; angle: string }[]; posts: SeriesPost[] };

/** 工程ごとの結果（meo_kit_steps.result） */
export type KitResults = {
  scan?: ScanResult;
  hpbpage?: HpbPageResult;
  diagnose?: Diagnosis;
  score?: ScorePack;
  hpb?: HpbPack;
  meo?: MeoPack;
  kit?: KitPack;
  coupon?: CouponPack;
  aio?: AioPack;
  guard?: GuardPack;
  winners?: WinnersPack;
  series?: SeriesPack;
};

/** 「やること」の状態。todo=やる / done=やった / skip=やらない */
export type PlanState = Record<string, "todo" | "done" | "skip">;

/** 自動で回す設定（お店ごと）。既定はすべてオフ */
export type AutoSettings = {
  /** 口コミの返信文を毎日作る（作ったものは確認待ちに入る） */
  replies: boolean;
  /** 星がこの数以上で、言葉のチェックを通った返信だけはそのまま Google に送る。0 = 送らない（全部確認待ち） */
  autoSendMinStars: 0 | 4 | 5;
  /** Googleマップの投稿を週1本作る */
  posts: boolean;
  /** 投稿を作る曜日（0=日 … 6=土、JST） */
  postWeekday: number;
  /** 言葉のチェックを通った投稿はそのまま Google に公開する（オフなら確認待ち） */
  autoPublishPosts: boolean;
};

export const DEFAULT_AUTO: AutoSettings = { replies: false, autoSendMinStars: 0, posts: false, postWeekday: 2, autoPublishPosts: false };

export type AutoLogKind = "reply" | "post" | "measure";
export type AutoLogStatus = "sent" | "pending" | "dismissed" | "failed" | "info";

export type AutoLogEntry = {
  id: string;
  kind: AutoLogKind;
  status: AutoLogStatus;
  refId: string | null;
  title: string;
  text: string;
  rating: number | null;
  reason: string;
  hits: GuardHit[];
  createdAt: string;
  decidedAt: string | null;
};

/** 画面の一番上の「今の数字」。前回比つき */
export type KitNumber = { key: string; label: string; value: string; prev: string | null; delta: "up" | "down" | "same" | null; note: string };

export type KitStepState = { status: "done" | "failed"; updatedAt: string; error: string | null };

export type KitData = {
  kind: KitKind;
  input: KitInput;
  results: KitResults;
  steps: Partial<Record<KitStepId, KitStepState>>;
  plan: PlanState;
  auto: AutoSettings;
  numbers: KitNumber[];
  pendingCount: number;
  /** Googleの「クチコミを書く」URL（place_id から作る） */
  reviewUrl: string | null;
  /** 口コミ画面（店頭QR）の URL（相対パス） */
  reviewPagePath: string;
  storeName: string;
  websiteUrl: string | null;
  /** AI検索で先に挙がった店（自店を除く）。winners の比べる相手 */
  aiListed: string[];
  placeCompetitors: string[];
  unrepliedReviews: number;
  gbpLinked: boolean;
};
