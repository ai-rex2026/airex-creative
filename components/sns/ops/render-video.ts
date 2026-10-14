"use client";

import { ArrayBufferTarget, Muxer } from "mp4-muxer";

/**
 * 動画をブラウザで書き出す（WebCodecs で H.264＋AAC/Opus に符号化し、mp4 にまとめる）。
 * 場面ごとに：写真（ゆっくり寄る）／動画の素材、ナレーション（音声合成の WAV）、テロップ（日本語は canvas で組む。
 * 画像生成モデルには文字を描かせない＝ AGENTS.md）。
 */

export type RenderScene = {
  imageUrl?: string | null;
  videoUrl?: string | null;
  audioUrl?: string | null;
  caption: string;
  /** 長尺：章の最初の場面だけ、章の見出しを出す */
  chapterTitle?: string | null;
  sec: number;
};

/**
 * strict：Instagram・TikTok 向け（H.264＋AAC でないと受け付けない媒体）。
 * relaxed：YouTube 向け（H.264 が使えなければ VP9、AAC が使えなければ Opus でも受け付ける）
 */
export type RenderInput = { width: number; height: number; fps: number; scenes: RenderScene[]; layout: "short" | "long"; codecs: "strict" | "relaxed" };

export type RenderResult = { blob: Blob; durationSec: number; audioCodec: string; videoCodec: string };

export function canRender(): string | null {
  if (typeof window === "undefined") return "ブラウザで開いてください";
  if (!("VideoEncoder" in window) || !("AudioEncoder" in window)) return "このブラウザでは書き出せません。パソコンの Chrome（最新版）で開いてください";
  return null;
}

const SR = 48000;
const FONT = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Yu Gothic","Meiryo",sans-serif';

async function loadImage(url: string): Promise<ImageBitmap> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`画像を読めませんでした（HTTP ${res.status}）`);
  return createImageBitmap(await res.blob());
}

async function loadVideo(url: string): Promise<HTMLVideoElement> {
  const v = document.createElement("video");
  v.crossOrigin = "anonymous";
  v.muted = true;
  v.preload = "auto";
  v.playsInline = true;
  v.src = url;
  await new Promise<void>((ok, ng) => {
    v.onloadeddata = () => ok();
    v.onerror = () => ng(new Error("動画の素材を読めませんでした"));
  });
  return v;
}

async function seek(v: HTMLVideoElement, t: number) {
  const target = v.duration ? t % v.duration : t;
  if (Math.abs(v.currentTime - target) < 0.001) return;
  await new Promise<void>((ok) => {
    v.onseeked = () => ok();
    v.currentTime = target;
  });
}

function drawCover(ctx: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number, W: number, H: number, zoom: number, panX: number) {
  const scale = Math.max(W / sw, H / sh) * zoom;
  const dw = sw * scale;
  const dh = sh * scale;
  const x = (W - dw) / 2 + panX * (dw - W) * 0.5;
  const y = (H - dh) / 2;
  ctx.drawImage(src, x, y, dw, dh);
}

/** テロップを折り返す（全角を前提に、幅で切る） */
export function wrapText(ctx: Pick<CanvasRenderingContext2D, "measureText">, text: string, maxWidth: number, maxLines: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const ch of Array.from(text.replace(/\s+/g, " ").trim())) {
    if (ctx.measureText(cur + ch).width > maxWidth && cur) {
      lines.push(cur);
      cur = ch === " " ? "" : ch;
      if (lines.length === maxLines) break;
    } else cur += ch;
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  return lines;
}

function drawCaption(ctx: CanvasRenderingContext2D, text: string, W: number, H: number, layout: "short" | "long") {
  if (!text) return;
  const size = layout === "short" ? Math.round(W * 0.062) : Math.round(H * 0.058);
  ctx.font = `800 ${size}px ${FONT}`;
  const lines = wrapText(ctx, text, W * (layout === "short" ? 0.84 : 0.86), layout === "short" ? 3 : 2);
  const lh = size * 1.35;
  const boxH = lines.length * lh + size * 0.8;
  const boxW = Math.min(W * 0.92, Math.max(...lines.map((l) => ctx.measureText(l).width)) + size * 1.2);
  const cy = layout === "short" ? H * 0.7 : H - boxH - H * 0.06;
  const x = (W - boxW) / 2;
  ctx.fillStyle = "rgba(20,20,20,0.72)";
  const r = size * 0.35;
  ctx.beginPath();
  ctx.roundRect(x, cy, boxW, boxH, r);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  lines.forEach((l, i) => ctx.fillText(l, W / 2, cy + size * 0.4 + lh * i + lh / 2));
}

function drawChapter(ctx: CanvasRenderingContext2D, title: string, W: number, H: number, alpha: number) {
  const size = Math.round(H * 0.045);
  ctx.globalAlpha = alpha;
  ctx.font = `700 ${size}px ${FONT}`;
  const w = Math.min(W * 0.8, ctx.measureText(title).width + size * 1.4);
  ctx.fillStyle = "rgba(201,168,76,0.95)";
  ctx.beginPath();
  ctx.roundRect(W * 0.04, H * 0.06, w, size * 1.8, size * 0.3);
  ctx.fill();
  ctx.fillStyle = "#2E2D29";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(title, W * 0.04 + size * 0.7, H * 0.06 + size * 0.9, w - size * 1.4);
  ctx.globalAlpha = 1;
}

async function pickVideoCodec(width: number, height: number, fps: number, bitrate: number, relaxed: boolean): Promise<{ cfg: VideoEncoderConfig; mux: "avc" | "vp9" }> {
  for (const codec of ["avc1.640028", "avc1.4d0028", "avc1.42e028", "avc1.640033"]) {
    const cfg: VideoEncoderConfig = { codec, width, height, bitrate, framerate: fps, latencyMode: "quality" };
    const s = await VideoEncoder.isConfigSupported(cfg).catch(() => null);
    if (s?.supported) return { cfg, mux: "avc" };
  }
  if (relaxed) {
    const cfg: VideoEncoderConfig = { codec: "vp09.00.40.08", width, height, bitrate, framerate: fps, latencyMode: "quality" };
    if ((await VideoEncoder.isConfigSupported(cfg).catch(() => null))?.supported) return { cfg, mux: "vp9" };
  }
  throw new Error("このパソコンでは H.264 の書き出しができません。Mac か Windows のパソコンの Chrome（最新版）で開いてください");
}

async function pickAudioCodec(relaxed: boolean): Promise<{ cfg: AudioEncoderConfig; mux: "aac" | "opus" }> {
  const aac: AudioEncoderConfig = { codec: "mp4a.40.2", sampleRate: SR, numberOfChannels: 1, bitrate: 128000 };
  if ((await AudioEncoder.isConfigSupported(aac).catch(() => null))?.supported) return { cfg: aac, mux: "aac" };
  if (!relaxed) throw new Error("このパソコンでは AAC（Instagram・TikTok が求める音声の形式）で書き出せません。Mac か Windows のパソコンの Chrome（最新版）で開いてください");
  const opus: AudioEncoderConfig = { codec: "opus", sampleRate: SR, numberOfChannels: 1, bitrate: 96000 };
  if ((await AudioEncoder.isConfigSupported(opus).catch(() => null))?.supported) return { cfg: opus, mux: "opus" };
  throw new Error("このブラウザでは音声を書き出せません");
}

export async function renderVideo(input: RenderInput, onProgress: (phase: string, ratio: number) => void, signal?: AbortSignal): Promise<RenderResult> {
  const err = canRender();
  if (err) throw new Error(err);
  const { width: W, height: H, fps, scenes, layout } = input;
  // 素材を読む前に、書き出せる形式かを先に確かめる（読み込んだあとで失敗させない）
  await pickVideoCodec(W, H, fps, 1_000_000, input.codecs === "relaxed");
  await pickAudioCodec(input.codecs === "relaxed");
  const starts: number[] = [];
  let total = 0;
  for (const s of scenes) {
    starts.push(total);
    total += s.sec;
  }
  if (!scenes.length || total <= 0) throw new Error("場面がありません");
  await document.fonts?.ready;

  // 1) 素材を読む
  onProgress("素材を読み込んでいます", 0);
  const visuals: ({ kind: "image"; bmp: ImageBitmap } | { kind: "video"; el: HTMLVideoElement } | null)[] = [];
  for (let i = 0; i < scenes.length; i++) {
    if (signal?.aborted) throw new Error("中止しました");
    const s = scenes[i];
    try {
      if (s.videoUrl) visuals.push({ kind: "video", el: await loadVideo(s.videoUrl) });
      else if (s.imageUrl) visuals.push({ kind: "image", bmp: await loadImage(s.imageUrl) });
      else visuals.push(null);
    } catch {
      visuals.push(null);
    }
    onProgress("素材を読み込んでいます", (i + 1) / scenes.length);
  }

  // 2) 音（ナレーションを時間どおりに並べて1本にする）
  onProgress("音声をまとめています", 0);
  const off = new OfflineAudioContext(1, Math.ceil(total * SR), SR);
  for (let i = 0; i < scenes.length; i++) {
    const url = scenes[i].audioUrl;
    if (!url) continue;
    const buf = await fetch(url).then((r) => r.arrayBuffer());
    const audio = await off.decodeAudioData(buf);
    const src = off.createBufferSource();
    src.buffer = audio;
    src.connect(off.destination);
    src.start(starts[i] + 0.25);
    onProgress("音声をまとめています", (i + 1) / scenes.length);
  }
  const mixed = await off.startRendering();

  // 3) 符号化の準備
  const relaxed = input.codecs === "relaxed";
  const vcodec = await pickVideoCodec(W, H, fps, layout === "short" ? 6_000_000 : 1_800_000, relaxed);
  const vcfg = vcodec.cfg;
  const acodec = await pickAudioCodec(relaxed);
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: vcodec.mux, width: W, height: H, frameRate: fps },
    audio: { codec: acodec.mux, numberOfChannels: 1, sampleRate: SR },
    fastStart: "in-memory",
    firstTimestampBehavior: "offset",
  });
  let encErr: Error | null = null;
  const venc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => (encErr = e as Error) });
  venc.configure(vcfg);
  const aenc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (e) => (encErr = e as Error) });
  aenc.configure(acodec.cfg);

  // 4) 音を符号化
  const pcm = mixed.getChannelData(0);
  const FR = 1024;
  for (let off2 = 0; off2 < pcm.length; off2 += FR) {
    const n = Math.min(FR, pcm.length - off2);
    const data = new AudioData({ format: "f32-planar", sampleRate: SR, numberOfFrames: n, numberOfChannels: 1, timestamp: Math.round((off2 / SR) * 1e6), data: pcm.slice(off2, off2 + n) });
    aenc.encode(data);
    data.close();
  }

  // 5) 映像を1コマずつ描いて符号化
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;
  const frames = Math.ceil(total * fps);
  let si = 0;
  for (let f = 0; f < frames; f++) {
    if (signal?.aborted) throw new Error("中止しました");
    if (encErr) throw encErr;
    const t = f / fps;
    while (si < scenes.length - 1 && t >= starts[si + 1]) si++;
    const s = scenes[si];
    const local = t - starts[si];
    const p = Math.min(1, local / Math.max(0.1, s.sec));
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, W, H);
    const vis = visuals[si];
    if (vis?.kind === "image") {
      drawCover(ctx, vis.bmp, vis.bmp.width, vis.bmp.height, W, H, 1 + 0.07 * p, si % 2 ? p - 0.5 : 0.5 - p);
    } else if (vis?.kind === "video") {
      await seek(vis.el, local);
      drawCover(ctx, vis.el, vis.el.videoWidth, vis.el.videoHeight, W, H, 1, 0);
    }
    // 場面の切り替わりは短く暗転させる
    const fade = Math.min(local / 0.25, (s.sec - local) / 0.25, 1);
    if (fade < 1) {
      ctx.fillStyle = `rgba(0,0,0,${(1 - Math.max(0, fade)) * 0.6})`;
      ctx.fillRect(0, 0, W, H);
    }
    drawCaption(ctx, s.caption, W, H, layout);
    if (s.chapterTitle && local < 3) drawChapter(ctx, s.chapterTitle, W, H, Math.min(1, (3 - local) / 0.5));
    const frame = new VideoFrame(canvas, { timestamp: Math.round(t * 1e6), duration: Math.round(1e6 / fps) });
    venc.encode(frame, { keyFrame: f % (fps * 2) === 0 });
    frame.close();
    while (venc.encodeQueueSize > 10) await new Promise((r) => setTimeout(r, 2));
    if (f % fps === 0) onProgress("書き出しています", f / frames);
  }
  await venc.flush();
  await aenc.flush();
  if (encErr) throw encErr;
  muxer.finalize();
  visuals.forEach((v) => v?.kind === "image" && v.bmp.close());
  onProgress("書き出しました", 1);
  return { blob: new Blob([target.buffer], { type: "video/mp4" }), durationSec: total, audioCodec: acodec.mux, videoCodec: vcfg.codec };
}
