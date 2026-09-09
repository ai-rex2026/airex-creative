/**
 * 媒体ごとの入稿規定。
 *
 * 文字数も件数も媒体で違う。Google の規定を全媒体に当てると、
 * Meta の見出しに「全角15文字」を強いるような、実際とは違う原稿になる。
 *
 * **数え方が2種類ある。**
 * Google・Yahoo! は全角1文字を2として数える（半角換算）。
 * Meta・LINE・TikTok は文字数そのままで数える。
 *
 * 規定は変わるので、辞書として1か所に置く。運用者が直せるようにするため。
 */

export type CountMode = "半角換算" | "文字数";

export type AdSpec = {
  id: string;
  label: string;
  /** channel 名からの引き当て */
  match: RegExp;
  count: CountMode;
  /** 見出しにあたる枠 */
  headline: { field: string; count: number; limit: number };
  /** 説明にあたる枠。Meta はメインテキストをここに当てる */
  description: { field: string; count: number; limit: number };
  /** キーワードで買う面か */
  keywords: boolean;
  source: string;
};

export const AD_SPECS: AdSpec[] = [
  {
    id: "google-search",
    label: "Google 検索（レスポンシブ検索広告）",
    match: /google.*(検索|search)|検索.*google|リスティング/i,
    count: "半角換算",
    headline: { field: "見出し", count: 12, limit: 30 },
    description: { field: "説明文", count: 4, limit: 90 },
    keywords: true,
    source: "Google 広告ヘルプ（レスポンシブ検索広告）",
  },
  {
    id: "yahoo-search",
    label: "Yahoo!検索広告（レスポンシブ検索広告）",
    match: /yahoo.*(検索|search)|検索.*yahoo/i,
    count: "半角換算",
    headline: { field: "タイトル", count: 12, limit: 30 },
    description: { field: "説明文", count: 4, limit: 90 },
    keywords: true,
    source: "Yahoo!広告ヘルプ（レスポンシブ検索広告）",
  },
  {
    id: "meta",
    label: "Meta（Facebook / Instagram）",
    match: /meta|facebook|instagram|インスタ/i,
    count: "文字数",
    // Meta の「メインテキスト」を説明文の枠に当てている。
    // 本文にあたる枠が Google の説明文と役割が近いため。
    headline: { field: "見出し", count: 5, limit: 27 },
    description: { field: "メインテキスト", count: 5, limit: 125 },
    keywords: false,
    source: "フィード面の推奨値（見出し27文字・メインテキスト125文字）。2026-09 時点の各社まとめより。要確認",
  },
  {
    id: "line",
    label: "LINE広告（Yahoo!広告 ディスプレイ運用型）",
    // 「オンライン」が「ライン」に当たるので、英字の境界を見て LINE だけを拾う
    match: /(^|[^A-Za-z])LINE([^A-Za-z]|$)|LINE広告/,
    count: "文字数",
    headline: { field: "タイトル", count: 5, limit: 20 },
    description: { field: "ディスクリプション", count: 5, limit: 75 },
    keywords: false,
    source: "要確認（鈴木さん）。LINE広告は Yahoo!広告に統合されているため、入稿は Yahoo! 側の規定に従う",
  },
  {
    id: "tiktok",
    label: "TikTok広告",
    match: /tiktok|ティックトック/i,
    count: "文字数",
    headline: { field: "テキスト", count: 5, limit: 40 },
    description: { field: "テキスト", count: 3, limit: 100 },
    keywords: false,
    source: "要確認（鈴木さん）",
  },
  {
    id: "yahoo-display",
    label: "Yahoo!広告 ディスプレイ（運用型）",
    match: /yahoo|ydn|yda/i,
    count: "文字数",
    headline: { field: "タイトル", count: 5, limit: 20 },
    description: { field: "ディスクリプション", count: 5, limit: 75 },
    keywords: false,
    source: "要確認（鈴木さん）",
  },
  {
    id: "google-display",
    label: "Google ディスプレイ / デマンドジェネレーション",
    match: /google|ディスプレイ|gdn|p-?max|youtube|demand/i,
    count: "半角換算",
    headline: { field: "見出し", count: 5, limit: 30 },
    description: { field: "説明文", count: 5, limit: 90 },
    keywords: false,
    source: "Google 広告ヘルプ（レスポンシブ ディスプレイ広告）",
  },
];

/**
 * 引き当てられない媒体は検索広告の規定に寄せる。最も厳しいので入稿で弾かれにくい。
 * ただし「その媒体の規定として確かめたもの」ではないので、出典でそう伝える。
 */
const DEFAULT_SPEC: AdSpec = {
  ...AD_SPECS[0],
  id: "unknown",
  label: "規定を確認できていない媒体",
  source: "この媒体の規定は辞書にありません。最も厳しい検索広告の規定を当てています。要確認",
};

export function specFor(channel: string): AdSpec {
  return AD_SPECS.find((s) => s.match.test(channel)) ?? DEFAULT_SPEC;
}

const FULL_WIDTH = /[^\x01-\x7E｡-ﾟ]/;

/** その媒体の数え方で長さを測る */
export function lengthIn(mode: CountMode, s: string) {
  return mode === "文字数" ? [...s].length : [...s].reduce((n, c) => n + (FULL_WIDTH.test(c) ? 2 : 1), 0);
}

/** 画面とプロンプトに出す上限の言い方 */
export function limitLabel(spec: AdSpec, kind: "headline" | "description") {
  const f = spec[kind];
  return spec.count === "半角換算"
    ? `${f.field}：${f.count}件・全角${f.limit / 2}文字以内`
    : `${f.field}：${f.count}件・${f.limit}文字以内`;
}
