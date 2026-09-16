import type { SafeCrop } from "./image-check";

/**
 * 文字が写り込んだ画像から、文字を含まない領域（SafeCrop）だけを
 * ブラウザ上で実際に切り出す。
 *
 * サーバー側に画像処理ライブラリを増やしたくない（依存が増える）のと、
 * 切り出し後の画像はその場でバナーに使うだけなので、canvas で完結させる。
 * 同一オリジン経由（/api/analysis/[id]/img）で受け取った画像なので、
 * canvas が汚染されず toDataURL / 後段の PNG 書き出しも問題なく通る。
 */
export async function cropImageToDataUrl(src: string, crop: SafeCrop): Promise<string> {
  const img = await loadImage(src);
  const sx = (crop.x0 / 100) * img.naturalWidth;
  const sy = (crop.y0 / 100) * img.naturalHeight;
  const sw = ((crop.x1 - crop.x0) / 100) * img.naturalWidth;
  const sh = ((crop.y1 - crop.y0) / 100) * img.naturalHeight;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw));
  canvas.height = Math.max(1, Math.round(sh));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context を取得できませんでした");
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("画像の読み込みに失敗しました"));
    img.src = src;
  });
}
