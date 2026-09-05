/** 媒体の主要サイズ。1つのコピーから全サイズを同時に出すのが量産の肝 */
export type SizePreset = {
  id: string;
  label: string;
  media: "Meta" | "Google" | "Yahoo" | "LINE";
  w: number;
  h: number;
};

export const SIZES: SizePreset[] = [
  { id: "meta-1x1", label: "フィード 正方形", media: "Meta", w: 1080, h: 1080 },
  { id: "meta-4x5", label: "フィード 縦", media: "Meta", w: 1080, h: 1350 },
  { id: "meta-9x16", label: "ストーリー/リール", media: "Meta", w: 1080, h: 1920 },
  { id: "google-lb", label: "レスポンシブ 横長", media: "Google", w: 1200, h: 628 },
  { id: "google-rect", label: "レクタングル", media: "Google", w: 300, h: 250 },
  { id: "yahoo-rect", label: "レクタングル", media: "Yahoo", w: 300, h: 250 },
];
