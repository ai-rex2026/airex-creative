import type { BannerCopy, Diagnosis } from "../types";

/**
 * 広告運用 ＞ バナー制作（2026-11-11）。画面（client）からも読むので、サーバー専用のものは import しない。
 *
 * - 絵（背景・商品の場面）は fal の画像モデルで作る。文字は描かせない（AGENTS.md：日本語の文字を画像生成モデルに描かせない）
 * - 文字（コピー・CTA）は DOM（components/Banner.tsx）と canvas で重ね、法令チェック済みの文言だけを使う
 * - 媒体のサイズへは、近い縦横比で絵を作り直し（fal の編集モデル）てから、正確なピクセルに切り抜いて文字を組む
 * - 動画は、そのサイズの絵を fal の image-to-video で動かし、文字はブラウザで重ねて MP4 に書き出す
 */

export const BANNER_BUCKET = "banner-assets";

/** fal のモデル（2026-11 時点の公開料金：画像 $0.0398／枚、動画 5秒 $0.28） */
export const FAL_IMAGE_MODEL = "fal-ai/nano-banana";
export const FAL_EDIT_MODEL = "fal-ai/nano-banana/edit";
export const FAL_VIDEO_MODEL = "fal-ai/kling-video/v2.1/standard/image-to-video";
export const FAL_PRICE = { image: 0.0398, video5: 0.28 };

/** 1人あたり1か月の上限（費用の歯止め） */
export const MONTHLY_LIMIT = { images: 200, videos: 20 };

/** 基本パターンの数 */
export const PATTERN_COUNT = 4;

/** fal の画像モデルが受け付ける縦横比 */
export const FAL_ASPECTS = ["21:9", "16:9", "3:2", "4:3", "5:4", "1:1", "4:5", "3:4", "2:3", "9:16"] as const;
export type FalAspect = (typeof FAL_ASPECTS)[number];

export function aspectValue(a: string): number {
  const [w, h] = a.split(":").map(Number);
  return w / h;
}

/** そのサイズに一番近い縦横比 */
export function nearestAspect(w: number, h: number): FalAspect {
  const r = Math.log(w / h);
  let best: FalAspect = "1:1";
  let d = Infinity;
  for (const a of FAL_ASPECTS) {
    const x = Math.abs(Math.log(aspectValue(a)) - r);
    if (x < d) {
      d = x;
      best = a;
    }
  }
  return best;
}

export type BannerSize = { id: string; label: string; media: string; w: number; h: number };

/** 媒体の主なサイズ（静止画） */
export const BANNER_SIZES: BannerSize[] = [
  { id: "meta-1x1", media: "Meta", label: "フィード 正方形", w: 1080, h: 1080 },
  { id: "meta-4x5", media: "Meta", label: "フィード 縦", w: 1080, h: 1350 },
  { id: "meta-9x16", media: "Meta", label: "ストーリーズ・リール", w: 1080, h: 1920 },
  { id: "google-1200x628", media: "Google", label: "横長（P-MAX・デマンド ジェン）", w: 1200, h: 628 },
  { id: "google-1200x1200", media: "Google", label: "正方形", w: 1200, h: 1200 },
  { id: "google-960x1200", media: "Google", label: "縦長", w: 960, h: 1200 },
  { id: "google-300x250", media: "Google", label: "レクタングル", w: 300, h: 250 },
  { id: "google-336x280", media: "Google", label: "レクタングル（大）", w: 336, h: 280 },
  { id: "yahoo-1200x628", media: "Yahoo!", label: "横長", w: 1200, h: 628 },
  { id: "yahoo-1200x1200", media: "Yahoo!", label: "正方形", w: 1200, h: 1200 },
  { id: "yahoo-600x500", media: "Yahoo!", label: "レクタングル", w: 600, h: 500 },
  { id: "yahoo-300x250", media: "Yahoo!", label: "レクタングル（小）", w: 300, h: 250 },
  { id: "line-1080x1080", media: "LINE", label: "正方形", w: 1080, h: 1080 },
  { id: "line-1200x628", media: "LINE", label: "横長", w: 1200, h: 628 },
  { id: "line-600x400", media: "LINE", label: "小", w: 600, h: 400 },
  { id: "tiktok-1080x1920", media: "TikTok", label: "縦（インフィード）", w: 1080, h: 1920 },
  { id: "x-1200x675", media: "X", label: "横長", w: 1200, h: 675 },
  { id: "x-1080x1080", media: "X", label: "正方形", w: 1080, h: 1080 },
];

/** 動画の縦横（Kling は元の絵の縦横で出る） */
export const VIDEO_ASPECTS: { aspect: FalAspect; label: string; w: number; h: number }[] = [
  { aspect: "9:16", label: "縦（リール・ストーリーズ・TikTok・ショート）", w: 1080, h: 1920 },
  { aspect: "1:1", label: "正方形（フィード）", w: 1080, h: 1080 },
  { aspect: "4:5", label: "縦（フィード）", w: 1080, h: 1350 },
  { aspect: "16:9", label: "横（YouTube・X）", w: 1920, h: 1080 },
];

export type BannerMaterial = { path: string; kind: "product" | "logo" | "photo"; name: string };

export type BannerPattern = {
  key: string;
  /** 日本語の名前（例：商品を主役にした写真） */
  label: string;
  /** どんな絵か（日本語1文） */
  concept: string;
  /** 画像モデルへの指示（英語。文字なし・下3分の1に余白） */
  prompt: string;
  /** 動画にするときの動き（英語） */
  motion: string;
  /** 取り込んだ素材（商品写真など）を使うか */
  useMaterials: boolean;
};

export type VisualKind = "base" | "resize" | "video";
export type VisualStatus = "queued" | "done" | "error";

export type BannerVisual = {
  id: string;
  kind: VisualKind;
  pattern: string;
  parentId: string | null;
  aspect: string;
  status: VisualStatus;
  path: string | null;
  error: string | null;
  /** 絵に文字が入っていそう（文字チェックの結果。素材を使った絵はしない） */
  textWarning: string | null;
  createdAt: string;
};

export type BannerProject = {
  id: string;
  name: string;
  url: string;
  description: string;
  diagnosis: Diagnosis | null;
  copies: BannerCopy[];
  materials: BannerMaterial[];
  patterns: BannerPattern[];
  error: string | null;
  createdAt: string;
};

export const BANNER_PROJECT_COLUMNS = "id, name, url, description, diagnosis, copies, materials, patterns, error, created_at";
export const BANNER_VISUAL_COLUMNS = "id, kind, pattern, parent_id, aspect, status, path, error, text_warning, created_at";

export function rowToBannerProject(r: Record<string, unknown>): BannerProject {
  return {
    id: String(r.id),
    name: String(r.name ?? ""),
    url: String(r.url ?? ""),
    description: String(r.description ?? ""),
    diagnosis: (r.diagnosis as Diagnosis | null) ?? null,
    copies: Array.isArray(r.copies) ? (r.copies as BannerCopy[]) : [],
    materials: Array.isArray(r.materials) ? (r.materials as BannerMaterial[]) : [],
    patterns: Array.isArray(r.patterns) ? (r.patterns as BannerPattern[]) : [],
    error: (r.error as string | null) ?? null,
    createdAt: String(r.created_at ?? ""),
  };
}

export function rowToVisual(r: Record<string, unknown>): BannerVisual {
  return {
    id: String(r.id),
    kind: (r.kind as VisualKind) ?? "base",
    pattern: String(r.pattern ?? ""),
    parentId: (r.parent_id as string | null) ?? null,
    aspect: String(r.aspect ?? "1:1"),
    status: (r.status as VisualStatus) ?? "queued",
    path: (r.path as string | null) ?? null,
    error: (r.error as string | null) ?? null,
    textWarning: (r.text_warning as string | null) ?? null,
    createdAt: String(r.created_at ?? ""),
  };
}

/** 画面から読む素材の URL（同じオリジン。PNG・MP4 の書き出しで CORS に当たらないように） */
export const assetUrl = (path: string) => `/api/banner-assets/${path.split("/").map(encodeURIComponent).join("/")}`;
