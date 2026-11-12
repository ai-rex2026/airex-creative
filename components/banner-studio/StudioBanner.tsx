"use client";

import type { CSSProperties } from "react";
import type { BrandProfile } from "@/lib/types";
import type { Archetype, BannerPattern, PatternCopy } from "@/lib/banner-studio/types";

/**
 * バナー制作のバナー（2026-11-12）。文字は DOM で組む（画像生成モデルに描かせない）。
 *
 * 成果の出るバナーの共通点を、型ごとのレイアウトにした:
 * - 主役（絵）と文字を重ねない：写真と文字の面を分ける（左右分割・上下分割）。写真は正方形の絵をそのまま
 *   （または余白だけ切って）見せ、何の写真か分からなくなるほど隠さない（2026-11-12 改善）
 * - 6つのレイアウト（写真 左／右・写真 上／下・写真に文字カード・文字が主役）。サイズの形で使えないものは自動で切り替える
 * - メッセージは1つ・強弱をはっきり：いちばん大きいのは見出し（数字の型は数字）
 * - 色は2〜3色：本文は濃い墨、強調はブランド色、CTA だけ別のアクセント色（ブランド色の反対色）
 * - 小さいサイズ（300×250 など）は見出しと CTA だけに間引く
 * - 提供元（ロゴ・ブランド名）を入れ、外枠に細い線を引いて掲載面と区別する
 */

// ── 色 ─────────────────────

function hexToRgb(hex: string): [number, number, number] | null {
  const m = hex.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function luminance([r, g, b]: [number, number, number]) {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

const contrast = (a: [number, number, number], b: [number, number, number]) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

const toHex = (c: [number, number, number]) => `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
const WHITE: [number, number, number] = [255, 255, 255];

/** 白地の上で読める濃さまで暗くする */
function readableOnWhite(c: [number, number, number]): [number, number, number] {
  const [h, s, l0] = rgbToHsl(c);
  let l = l0;
  let out = c;
  for (let i = 0; i < 20 && contrast(out, WHITE) < 4.5; i++) {
    l = Math.max(0.1, l - 0.04);
    out = hslToRgb(h, s, l);
  }
  return out;
}

/** ブランド色と、CTA だけに使うアクセント色（反対色。白文字が読める濃さ） */
export function palette(accent: string) {
  const base = hexToRgb(accent) ?? [139, 115, 85];
  const brand = readableOnWhite(base);
  const [h, s] = rgbToHsl(base);
  // 無彩色に近いブランドは、反対色が決まらないので暖色（オレンジ）にする
  const ctaHue = s < 0.15 ? 24 : (h + 180) % 360;
  let cta = hslToRgb(ctaHue, Math.max(0.7, s), 0.48);
  for (let i = 0; i < 20 && contrast(cta, WHITE) < 4.5; i++) cta = hslToRgb(ctaHue, Math.max(0.7, s), 0.48 - (i + 1) * 0.025);
  return { brand: toHex(brand), cta: toHex(cta), ink: "#16181d", muted: "#4b5160" };
}

// ── 文字の大きさ ─────────────────────

/** 1行に収まる大きさ（日本語は1文字≒1em。英数字は細いので少し得する） */
function lineSize(text: string, boxW: number, max: number) {
  if (!text) return max;
  const len = [...text].reduce((n, ch) => n + (/[ -~]/.test(ch) ? 0.58 : 1), 0);
  return Math.max(8, Math.min(max, boxW / (len + 0.3)));
}

// ── 本体 ─────────────────────

export type BannerLayout = "split-left" | "split-right" | "band-bottom" | "band-top" | "card" | "type";

export const LAYOUT_LABEL: Record<BannerLayout, string> = {
  "split-left": "左に写真・右に文字",
  "split-right": "右に写真・左に文字",
  "band-bottom": "上に写真・下に文字",
  "band-top": "上に文字・下に写真",
  card: "写真の上に文字カード",
  type: "文字が主役（背景に写真）",
};

/** 型ごとの既定のレイアウト（正方形・縦長のとき）。横長は左右分割にする */
const AUTO_BY_ARCH: Record<Archetype, BannerLayout> = {
  offer: "band-bottom",
  question: "card",
  number: "band-top",
  proof: "band-top",
  scene: "card",
  type: "type",
};

/**
 * 実際に使うレイアウトを決める。
 * - 横長（1.3 以上）は左右分割（正方形の写真を丸ごと見せられる）。上下分割・カードは写真が大きく切れるので使わない
 * - 正方形・縦長で左右分割を選んでも、写真の幅が細くなり何の写真か分からなくなるので上下分割にする
 * - カードは写真を全面に敷くので、写真の縦横比がバナーと大きく違う（＝大きく切れる）ときは上下分割にする
 */
export function resolveLayout(pattern: BannerPattern, w: number, h: number, imageAspect = 1, want?: BannerLayout | "auto"): BannerLayout {
  const arch: Archetype = pattern.archetype ?? "scene";
  const ratio = w / h;
  const wide = ratio >= 1.3;
  const n = Number(pattern.key.replace(/\D/g, "")) || 1;
  const sideAuto: BannerLayout = pattern.subject === "right" ? "split-right" : pattern.subject === "left" ? "split-left" : n % 2 ? "split-left" : "split-right";
  let l: BannerLayout = !want || want === "auto" ? (arch === "type" ? "type" : wide ? sideAuto : AUTO_BY_ARCH[arch]) : want;
  if (wide && (l === "band-bottom" || l === "band-top")) l = sideAuto;
  if (!wide && (l === "split-left" || l === "split-right")) l = "band-bottom";
  if (l === "card" && Math.abs(Math.log(imageAspect / ratio)) > 0.3) l = wide ? sideAuto : "band-bottom";
  // 300×250 などの小さいサイズでは、カードの文字が読めなくなるので上下分割にする
  if (l === "card" && Math.min(w, h) < 360) l = wide ? sideAuto : "band-bottom";
  return l;
}

export type StudioBannerProps = {
  id?: string;
  pattern: BannerPattern;
  copy: PatternCopy;
  brand: BrandProfile;
  w: number;
  h: number;
  image?: string | null;
  /** 写真の縦横比（幅÷高さ）。既定は正方形 */
  imageAspect?: number;
  logo?: string | null;
  /** レイアウトの指定（既定は自動） */
  layout?: BannerLayout | "auto";
};

type Box = { left: number; top: number; width: number; height: number };

export function StudioBanner({ id, pattern, copy, brand, w, h, image, imageAspect = 1, logo, layout = "auto" }: StudioBannerProps) {
  const arch: Archetype = pattern.archetype ?? "scene";
  const minSide = Math.min(w, h);
  const compact = minSide < 360; // 300×250・336×280
  const small = !compact && minSide < 480; // 600×400
  const col = palette(brand.accent || "#8B7355");
  const L = resolveLayout(pattern, w, h, imageAspect, layout);

  // 写真の枠と文字の面（重ねない）
  let img: Box = { left: 0, top: 0, width: w, height: h };
  let panel: Box;
  let card = false;
  if (L === "split-left" || L === "split-right") {
    const iw = Math.min(h * imageAspect, w * 0.58);
    img = { left: L === "split-left" ? 0 : w - iw, top: 0, width: iw, height: h };
    panel = { left: L === "split-left" ? iw : 0, top: 0, width: w - iw, height: h };
  } else if (L === "band-bottom" || L === "band-top") {
    const ih = Math.min(w / imageAspect, h * (h / w > 1.4 ? 0.58 : 0.6));
    img = { left: 0, top: L === "band-bottom" ? 0 : h - ih, width: w, height: ih };
    panel = { left: 0, top: L === "band-bottom" ? ih : 0, width: w, height: h - ih };
  } else if (L === "card") {
    card = true;
    const m = minSide * 0.045;
    const cw = w * (w / h < 0.9 ? 0.84 : 0.6);
    const ch = h * (w / h < 0.9 ? 0.32 : 0.42);
    panel = { left: m, top: h - ch - m, width: cw, height: ch };
  } else {
    panel = { left: w * 0.07, top: h * 0.1, width: w * 0.86, height: h * 0.8 };
  }

  const pad = card ? Math.max(10, Math.min(panel.width, panel.height) * 0.1) : Math.max(10, Math.min(panel.width, panel.height) * (compact ? 0.07 : 0.085));
  const innerW = panel.width - pad * 2;
  const innerH = panel.height - pad * 2;
  const center = L === "type" || ((L === "band-bottom" || L === "band-top") && panel.width / panel.height <= 1.8);

  const tight = compact || card;
  // 横に広い帯（正方形・4:5 の上下分割）は2列にする：左に対象・見出し、右に強調・CTA（小さい文字だらけにしない）
  const twoCol = (L === "band-bottom" || L === "band-top") && !compact && panel.width / panel.height > 1.8;
  const colA = twoCol ? innerW * 0.6 : innerW;
  const colB = twoCol ? innerW * 0.36 : innerW;
  const showTarget = !compact && !small && !!copy.target && !(card && minSide < 700);
  const showSub = !tight && !small && !twoCol && !!copy.sub;
  const showEmph = !!copy.emphasis && (arch === "number" || arch === "offer" || arch === "proof" || !compact);
  const showBrand = !compact;
  const onDark = L === "type";
  const ink = onDark ? "#ffffff" : col.ink;
  const muted = onDark ? "rgba(255,255,255,.86)" : col.muted;
  const emphColor = onDark ? "#ffffff" : col.brand;

  const headLines = copy.headline.filter(Boolean);
  const longest = headLines.reduce((a, b) => (b.length > a.length ? b : a), "");
  const headMax = innerH * (twoCol ? 0.26 : arch === "number" && showEmph ? 0.14 : compact ? 0.24 : arch === "question" || arch === "type" ? 0.18 : 0.16);
  let headSize = lineSize(longest, colA, headMax);
  let emphSize =
    arch === "number"
      ? lineSize(copy.emphasis, colB, innerH * (compact ? 0.32 : twoCol ? 0.4 : 0.3))
      : lineSize(copy.emphasis, colB * 0.85, innerH * (compact ? 0.16 : twoCol ? 0.22 : 0.13));
  let ctaSize = lineSize(copy.cta, colB * (twoCol ? 0.8 : 0.7), Math.max(10, innerH * (compact ? 0.13 : twoCol ? 0.13 : 0.085)));
  let smallSize = Math.max(9, Math.min(innerH * (twoCol ? 0.085 : 0.055), lineSize(copy.target || copy.sub, colA, innerH * (twoCol ? 0.09 : 0.06))));
  let gap = innerH * (compact ? 0.045 : 0.04);
  // 面の高さに収まるよう、全体を同じ比で縮める（CTA が切れないように）
  {
    const a: number[] = [];
    const b: number[] = [];
    if (showBrand) a.push(logo ? minSide * 0.06 : smallSize * 1.3);
    if (showTarget) a.push(smallSize * 1.4);
    a.push(headLines.length * headSize * 1.28);
    if (showSub) a.push(smallSize * 1.5 * Math.ceil(([...copy.sub].length * smallSize) / Math.max(1, colA)));
    if (showEmph) b.push(arch === "offer" ? emphSize * 1.8 : emphSize * 1.05 + (copy.emphasisLabel && !compact ? emphSize * 0.5 : 0));
    b.push(ctaSize * 2.3);
    const sum = (x: number[]) => x.reduce((p, q) => p + q, 0) + gap * Math.max(0, x.length - 1);
    const ka = Math.min(1, innerH / (twoCol ? sum(a) : sum([...a, ...b])));
    const kb = twoCol ? Math.min(1, innerH / sum(b)) : ka;
    headSize *= ka;
    smallSize = Math.max(8, smallSize * ka);
    emphSize *= kb;
    ctaSize *= kb;
    gap *= Math.min(ka, kb);
  }

  const root: CSSProperties = {
    position: "relative",
    width: w,
    height: h,
    overflow: "hidden",
    background: "#ffffff",
    fontFamily: '"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Yu Gothic","Meiryo",sans-serif',
  };

  const panelStyle: CSSProperties = {
    position: "absolute",
    ...panel,
    padding: pad,
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: center ? "center" : "flex-start",
    textAlign: center ? "center" : "left",
    gap,
    background: L === "type" ? "transparent" : "#ffffff",
    ...(card ? { borderRadius: minSide * 0.02, boxShadow: "0 6px 24px rgba(0,0,0,.18)" } : {}),
  };

  const pill: CSSProperties = {
    display: "inline-block",
    background: col.cta,
    color: "#fff",
    fontWeight: 800,
    fontSize: ctaSize,
    lineHeight: 1,
    padding: `${ctaSize * 0.62}px ${ctaSize * 1.15}px`,
    borderRadius: 999,
    whiteSpace: "nowrap",
    letterSpacing: "0.02em",
  };

  const brandMark = showBrand ? (
    logo ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logo}
        alt=""
        style={{
          height: Math.max(14, minSide * 0.06),
          maxWidth: innerW * 0.5,
          objectFit: "contain",
          ...(onDark ? { background: "rgba(255,255,255,.9)", padding: 4, borderRadius: 4 } : {}),
        }}
      />
    ) : (
      <div style={{ fontSize: Math.max(9, smallSize * 0.9), fontWeight: 700, color: muted, letterSpacing: "0.04em" }}>{brand.name}</div>
    )
  ) : null;

  const emph = showEmph ? (
    arch === "offer" ? (
      <div
        style={{
          background: onDark ? "#fff" : col.brand,
          color: onDark ? col.brand : "#fff",
          fontWeight: 800,
          fontSize: emphSize,
          lineHeight: 1.15,
          padding: `${emphSize * 0.32}px ${emphSize * 0.55}px`,
          borderRadius: emphSize * 0.18,
        }}
      >
        {copy.emphasis}
      </div>
    ) : (
      <div style={{ display: "flex", flexDirection: "column", alignItems: center ? "center" : "flex-start" }}>
        <div style={{ color: emphColor, fontWeight: 900, fontSize: emphSize, lineHeight: 1, letterSpacing: "-0.01em" }}>{copy.emphasis}</div>
        {copy.emphasisLabel && !compact && (
          <div style={{ color: muted, fontWeight: 700, fontSize: Math.max(9, emphSize * (arch === "number" ? 0.22 : 0.42)), marginTop: emphSize * 0.12 }}>
            {copy.emphasisLabel}
          </div>
        )}
      </div>
    )
  ) : null;

  const headline = (
    <div style={{ color: ink, fontWeight: 800, fontSize: headSize, lineHeight: 1.28, letterSpacing: "0.01em" }}>
      {headLines.map((l, i) => (
        <div key={i} style={{ whiteSpace: "nowrap" }}>
          {l}
        </div>
      ))}
    </div>
  );

  // 型ごとの並び（上から）。数字・実績の型は数字が先、それ以外は見出しが先
  const body = twoCol ? (
    <div style={{ ...panelStyle, flexDirection: "row", alignItems: "center", justifyContent: "space-between", textAlign: "left" }}>
      <div style={{ width: colA, display: "flex", flexDirection: "column", gap, alignItems: "flex-start" }}>
        {brandMark}
        {showTarget && <div style={{ color: emphColor, fontWeight: 800, fontSize: smallSize, letterSpacing: "0.03em" }}>{copy.target}</div>}
        {headline}
      </div>
      <div style={{ width: colB, display: "flex", flexDirection: "column", gap: gap * 1.4, alignItems: "center", textAlign: "center" }}>
        {emph}
        <div style={pill}>{copy.cta}</div>
      </div>
    </div>
  ) : (
    <div style={panelStyle}>
      {brandMark}
      {showTarget && <div style={{ color: emphColor, fontWeight: 800, fontSize: smallSize, letterSpacing: "0.03em" }}>{copy.target}</div>}
      {arch === "number" || arch === "proof" ? (
        <>
          {emph}
          {headline}
        </>
      ) : (
        <>
          {headline}
          {emph}
        </>
      )}
      {showSub && <div style={{ color: muted, fontWeight: 600, fontSize: smallSize, lineHeight: 1.5 }}>{copy.sub}</div>}
      <div style={pill}>{copy.cta}</div>
    </div>
  );

  // 写真は主役が中央・やや上にある前提で、切るときは上寄りを残す
  const imgStyle: CSSProperties = { position: "absolute", ...img, objectFit: "cover", objectPosition: "center 40%" };

  return (
    <div id={id} style={root}>
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" style={imgStyle} />
      ) : (
        <div style={{ position: "absolute", ...img, background: L === "type" ? col.brand : "#ece8e0" }} />
      )}
      {L === "type" && <div style={{ position: "absolute", inset: 0, background: "linear-gradient(rgba(0,0,0,.30), rgba(0,0,0,.45))" }} />}
      {body}
      {/* 外枠の細線（掲載面との境目） */}
      <div style={{ position: "absolute", inset: 0, boxShadow: "inset 0 0 0 1px rgba(0,0,0,.14)", pointerEvents: "none" }} />
    </div>
  );
}
