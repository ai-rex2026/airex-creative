import type { SafeCrop } from "./image-check";

/**
 * バナーで画像の上にテキストを重ねるとき、どの帯（上/下/左/右）にテキストを
 * 置くかを選ぶ。
 *
 * 「文字が入っている側を外して寄せられる」safeCrop の考え方と同じで、避けたい範囲
 * （＝顔の位置）が分かっているなら、そこと重ならない帯を機械的に選べる。
 * 顔の位置が取れていない画像は、広告の定石どおり下部に置く（下から暗くなる
 * グラデーションは違和感が出にくく、CTAも自然に下に収まるため）。
 */
export type TextZone = "top" | "bottom" | "left" | "right";

/**
 * 4つの帯の範囲（画像に対する%座標）。Banner.tsx のオーバーレイ表示も同じ範囲を使い、
 * 「避けた帯」と「実際にテキストを置く範囲」がずれないようにする
 */
export const ZONE_BOX: Record<TextZone, SafeCrop> = {
  bottom: { x0: 0, y0: 66, x1: 100, y1: 100 },
  top: { x0: 0, y0: 0, x1: 100, y1: 34 },
  right: { x0: 62, y0: 0, x1: 100, y1: 100 },
  left: { x0: 0, y0: 0, x1: 38, y1: 100 },
};

/** 優先順（同じ重なり量なら先頭を選ぶ）。下→上→右→左の定石順 */
const ZONES: { zone: TextZone; box: SafeCrop }[] = (
  ["bottom", "top", "right", "left"] as TextZone[]
).map((zone) => ({ zone, box: ZONE_BOX[zone] }));

function overlapArea(a: SafeCrop, b: SafeCrop): number {
  const w = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const h = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  return w * h;
}

/**
 * 顔の位置（facePosition）から、最も顔と重ならない帯を選ぶ。
 * 顔情報が無い場合は "bottom"（定石どおり）を返す。
 */
export function pickTextZone(facePosition: SafeCrop | null): TextZone {
  if (!facePosition) return "bottom";
  let best: TextZone = "bottom";
  let bestOverlap = Infinity;
  for (const { zone, box } of ZONES) {
    const overlap = overlapArea(box, facePosition);
    if (overlap < bestOverlap) {
      bestOverlap = overlap;
      best = zone;
    }
  }
  return best;
}
