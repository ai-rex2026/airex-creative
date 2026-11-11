"use client";

import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import type { BannerCopy, BrandProfile } from "@/lib/types";

/**
 * fal で作った文字なしの動画に、コピーを重ねて MP4 に書き出す（ブラウザ。2026-11-11）。
 * 文字は canvas で組む（画像・動画の生成モデルに日本語を描かせない）。音声は無し。
 * H.264（広告媒体が受け付ける形式）を優先し、使えないブラウザでは書き出さない。
 */

const FONT = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Yu Gothic","Meiryo",sans-serif';

export function canRenderBannerVideo(): string | null {
  if (typeof window === "undefined") return "ブラウザで開いてください";
  if (!("VideoEncoder" in window)) return "このブラウザでは書き出せません。パソコンの Chrome（最新版）で開いてください";
  return null;
}

async function loadVideo(src: string): Promise<{ v: HTMLVideoElement; revoke: () => void }> {
  // 先に全部読み込んでから使う（コマ送りのシークを安定させるため）
  const res = await fetch(src);
  if (!res.ok) throw new Error(`動画を読めませんでした（HTTP ${res.status}）`);
  const url = URL.createObjectURL(await res.blob());
  const v = document.createElement("video");
  v.muted = true;
  v.preload = "auto";
  v.playsInline = true;
  v.src = url;
  await new Promise<void>((ok, ng) => {
    v.onloadeddata = () => ok();
    v.onerror = () => ng(new Error("動画を読めませんでした"));
  });
  return { v, revoke: () => URL.revokeObjectURL(url) };
}

async function seek(v: HTMLVideoElement, t: number) {
  const target = Math.min(t, Math.max(0, v.duration - 0.01));
  if (Math.abs(v.currentTime - target) < 0.001) return;
  await new Promise<void>((ok) => {
    v.onseeked = () => ok();
    v.currentTime = target;
  });
}

function fitFont(ctx: CanvasRenderingContext2D, lines: string[], maxW: number, start: number, weight = 800): number {
  let s = start;
  for (; s > 12; s -= 2) {
    ctx.font = `${weight} ${s}px ${FONT}`;
    if (lines.every((l) => ctx.measureText(l).width <= maxW)) break;
  }
  return s;
}

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.pow(1 - x, 3));

function drawOverlay(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, dur: number, copy: BannerCopy, brand: BrandProfile) {
  const accent = brand.accent || "#8B7355";
  const u = Math.min(W, H) / 1080;
  const pad = 64 * u;
  // 下の文字を読みやすくする暗いグラデーション
  const g = ctx.createLinearGradient(0, H * 0.5, 0, H);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.7)");
  ctx.fillStyle = g;
  ctx.fillRect(0, H * 0.5, W, H * 0.5);

  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 12 * u;

  // ブランド名（左上）
  ctx.globalAlpha = ease(t / 0.4);
  ctx.font = `700 ${34 * u}px ${FONT}`;
  ctx.fillStyle = "#fff";
  ctx.fillText(brand.name || "", pad, pad + 34 * u, W - pad * 2);

  // 見出し（下から浮かび上がる）
  const lines = copy.headline.filter(Boolean);
  const hs = fitFont(ctx, lines, W - pad * 2, Math.round(88 * u));
  const a = ease((t - 0.5) / 0.6);
  const lift = (1 - a) * 30 * u;
  const ctaH = 96 * u;
  const bottom = H - pad - ctaH - 36 * u;
  const lh = hs * 1.3;
  const top = bottom - lh * lines.length;
  // 条件・限定（帯）
  if (copy.ribbonTop) {
    ctx.globalAlpha = ease((t - 0.3) / 0.5);
    const fs = 34 * u;
    ctx.font = `700 ${fs}px ${FONT}`;
    const w = Math.min(W - pad * 2, ctx.measureText(copy.ribbonTop).width + fs * 1.2);
    ctx.shadowBlur = 0;
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.roundRect(pad, top - fs * 2.2 + lift, w, fs * 1.7, fs * 0.25);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.fillText(copy.ribbonTop, pad + fs * 0.6, top - fs * 0.95 + lift, w - fs * 1.2);
    ctx.shadowBlur = 12 * u;
  }
  ctx.globalAlpha = a;
  ctx.font = `800 ${hs}px ${FONT}`;
  lines.forEach((l, i) => {
    ctx.fillStyle = "#fff";
    ctx.fillText(l, pad, top + lh * (i + 1) - hs * 0.2 + lift, W - pad * 2);
  });

  // 行動喚起（最後の2秒）
  const c = ease((t - Math.max(1.2, dur - 2.2)) / 0.4);
  if (c > 0 && copy.cta) {
    ctx.globalAlpha = c;
    ctx.shadowBlur = 0;
    const fs = 40 * u;
    ctx.font = `800 ${fs}px ${FONT}`;
    const w = Math.min(W - pad * 2, ctx.measureText(copy.cta).width + fs * 2.4);
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.roundRect(pad, H - pad - ctaH, w, ctaH, ctaH / 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.fillText(copy.cta, pad + w / 2, H - pad - ctaH / 2 + fs * 0.36, w - fs);
    ctx.textAlign = "left";
  }
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
}

function drawCover(ctx: CanvasRenderingContext2D, v: HTMLVideoElement, W: number, H: number) {
  const scale = Math.max(W / v.videoWidth, H / v.videoHeight);
  const dw = v.videoWidth * scale;
  const dh = v.videoHeight * scale;
  ctx.drawImage(v, (W - dw) / 2, (H - dh) / 2, dw, dh);
}

export async function renderBannerVideo(
  input: { src: string; width: number; height: number; copy: BannerCopy; brand: BrandProfile; fps?: number },
  onProgress: (ratio: number) => void
): Promise<Blob> {
  const why = canRenderBannerVideo();
  if (why) throw new Error(why);
  // 書き出しは偶数ピクセルにする（H.264 の制約）
  const W = Math.round(input.width / 2) * 2;
  const H = Math.round(input.height / 2) * 2;
  const fps = input.fps ?? 30;
  const { v, revoke } = await loadVideo(input.src);
  try {
    const dur = Math.min(v.duration || 5, 15);
    let cfg: VideoEncoderConfig | null = null;
    for (const codec of ["avc1.640028", "avc1.4d0028", "avc1.42e028", "avc1.640033"]) {
      const c: VideoEncoderConfig = { codec, width: W, height: H, bitrate: 8_000_000, framerate: fps, latencyMode: "quality" };
      if ((await VideoEncoder.isConfigSupported(c).catch(() => null))?.supported) {
        cfg = c;
        break;
      }
    }
    if (!cfg) throw new Error("このパソコンでは H.264 の書き出しができません。Mac か Windows のパソコンの Chrome（最新版）で開いてください");
    const target = new ArrayBufferTarget();
    const muxer = new Muxer({ target, video: { codec: "avc", width: W, height: H, frameRate: fps }, fastStart: "in-memory", firstTimestampBehavior: "offset" });
    let encErr: Error | null = null;
    const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => (encErr = e as Error) });
    enc.configure(cfg);
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("書き出しの準備ができませんでした");
    const frames = Math.ceil(dur * fps);
    for (let f = 0; f < frames; f++) {
      if (encErr) throw encErr;
      const t = f / fps;
      await seek(v, t);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, H);
      drawCover(ctx, v, W, H);
      drawOverlay(ctx, W, H, t, dur, input.copy, input.brand);
      const frame = new VideoFrame(canvas, { timestamp: Math.round(t * 1e6), duration: Math.round(1e6 / fps) });
      enc.encode(frame, { keyFrame: f % (fps * 2) === 0 });
      frame.close();
      while (enc.encodeQueueSize > 10) await new Promise((r) => setTimeout(r, 2));
      if (f % 10 === 0) onProgress(f / frames);
    }
    await enc.flush();
    if (encErr) throw encErr;
    muxer.finalize();
    onProgress(1);
    return new Blob([target.buffer], { type: "video/mp4" });
  } finally {
    revoke();
  }
}
