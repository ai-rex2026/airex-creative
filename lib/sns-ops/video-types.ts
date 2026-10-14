import type { GuardVerdict } from "../types";

/**
 * 動画（TikTok 20〜30秒・Instagram リール・YouTube 10〜20分）の型。
 * 場面ごとに「素材（写真・動画）か AI 画像」「ナレーション（音声合成）」「テロップ（画面で組む）」を持ち、
 * ブラウザで canvas に描いて mp4 に書き出す（日本語の文字を画像生成モデルに描かせない）。
 */

export type VideoPlatform = "tiktok" | "youtube" | "instagram";
export type VideoFormat = "short" | "long";

export const FORMAT_SPEC: Record<VideoFormat, { width: number; height: number; fps: number; minSec: number; maxSec: number; label: string; aspect: string }> = {
  short: { width: 1080, height: 1920, fps: 30, minSec: 20, maxSec: 30, label: "縦型ショート（20〜30秒）", aspect: "9:16" },
  long: { width: 1280, height: 720, fps: 30, minSec: 600, maxSec: 1200, label: "横型（10〜20分）", aspect: "16:9" },
};

/** 日本語ナレーションの読む速さの目安（1秒あたりの文字数） */
export const CHARS_PER_SEC = 5.5;

export type VideoScene = {
  key: string;
  /** 長尺の章（0始まり）。ショートは 0 */
  chapter: number;
  narration: string;
  /** 画面に出すテロップ（短く） */
  caption: string;
  plannedSec: number;
  /** 素材（sns_materials）を使うとき */
  materialId: string | null;
  /** 素材が無いときに AI で作る画像の説明（英語。文字は描かせない） */
  imagePrompt: string | null;
  imagePath: string | null;
  audioPath: string | null;
  audioSec: number | null;
  hasText?: boolean;
  error?: string | null;
  regen?: number;
  /** 画面表示用（DB には保存しない） */
  imageUrl?: string | null;
  audioUrl?: string | null;
  materialUrl?: string | null;
  materialType?: "image" | "video" | null;
};

export type VideoChapter = { title: string; points: string[]; minutes: number };

export type VideoStatus = "draft" | "ready" | "rendered" | "approved" | "published" | "skipped" | "failed";

export type SnsVideo = {
  id: string;
  platform: VideoPlatform;
  format: VideoFormat;
  theme: string;
  title: string;
  description: string;
  hashtags: string[];
  outline: VideoChapter[] | null;
  scenes: VideoScene[];
  voice: string;
  pattern: string;
  reason: string;
  guard: GuardVerdict | null;
  status: VideoStatus;
  videoPath: string | null;
  videoUrl?: string | null;
  durationSec: number | null;
  publishState: Record<string, unknown>;
  externalId: string | null;
  publishedUrl: string | null;
  privacy: string | null;
  errorMessage: string | null;
  metrics: Record<string, number | null> | null;
  createdAt: string;
};

export type Material = {
  id: string;
  kind: "image" | "video" | "text";
  source: "upload" | "gbp" | "x" | "instagram" | "ai" | "note";
  path: string | null;
  title: string;
  body: string;
  meta: Record<string, unknown>;
  createdAt: string;
  url?: string | null;
};

/** 場面の実際の長さ：ナレーションの長さ＋少しの間。ナレーションが無ければ予定の長さ */
export function sceneSeconds(s: Pick<VideoScene, "audioSec" | "plannedSec">): number {
  if (s.audioSec && s.audioSec > 0) return Math.max(2, Math.round((s.audioSec + 0.5) * 10) / 10);
  return Math.max(2, s.plannedSec || 4);
}

export function totalSeconds(scenes: Pick<VideoScene, "audioSec" | "plannedSec">[]): number {
  return Math.round(scenes.reduce((a, s) => a + sceneSeconds(s), 0) * 10) / 10;
}

/** 書き出しの準備ができているか（画面と音がそろっている） */
export function sceneReady(s: VideoScene): boolean {
  return !!(s.materialId || s.imagePath) && (!!s.audioPath || !s.narration.trim());
}

/** ナレーションの声（Gemini の音声合成の声） */
export const VOICES: { id: string; label: string }[] = [
  { id: "Kore", label: "落ち着いた女性" },
  { id: "Aoede", label: "明るい女性" },
  { id: "Leda", label: "若々しい女性" },
  { id: "Charon", label: "落ち着いた男性" },
  { id: "Puck", label: "明るい男性" },
  { id: "Orus", label: "力強い男性" },
];
