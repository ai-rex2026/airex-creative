"use client";

import type { CSSProperties } from "react";
import type { BrandProfile } from "@/lib/types";
import type { Archetype, BannerPattern, PatternCopy } from "@/lib/banner-studio/types";

/**
 * バナー制作のバナー（2026-11-12）。文字は DOM で組む（画像生成モデルに描かせない）。
 *
 * 成果の出るバナーの共通点を、型ごとのレイアウトにした:
 * - 主役（絵）と文字を重ねない：絵は主役を左右どちらかに寄せて作ってあり、文字は空けた側の面に置く
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

export type StudioBannerProps = {
  id?: string;
  pattern: BannerPattern;
  copy: PatternCopy;
  brand: BrandProfile;
  w: number;
  h: number;
  image?: string | null;
  logo?: string | null;
};

export function StudioBanner({ id, pattern, copy, brand, w, h, image, logo }: StudioBannerProps) {
  const arch: Archetype = pattern.archetype ?? "scene";
  const ratio = w / h;
  const minSide = Math.min(w, h);
  const compact = minSide < 360; // 300×250・336×280
  const small = !compact && minSide < 480; // 600×400
  const col = palette(brand.accent || "#8B7355");
  const subject = pattern.subject ?? "left";

  const mode: "type" | "side" | "stack" = arch === "type" ? "type" : ratio < 0.9 || subject === "center" ? "stack" : "side";
  const textSide = subject === "right" ? "left" : "right";

  // 文字の面
  const panelW = mode === "side" ? w * (ratio > 1.5 ? 0.5 : 0.5) : mode === "type" ? w * 0.86 : w;
  const panelH = mode === "stack" ? h * (ratio < 0.7 ? 0.42 : ratio < 0.9 ? 0.46 : 0.42) : mode === "type" ? h * 0.8 : h;
  const pad = Math.max(10, Math.min(panelW, panelH) * (compact ? 0.07 : 0.085));
  const innerW = panelW - pad * 2;
  const innerH = panelH - pad * 2;

  const showTarget = !compact && !small && !!copy.target;
  const showSub = !compact && !small && !!copy.sub;
  const showEmph = !!copy.emphasis && (arch === "number" || arch === "offer" || arch === "proof" || !compact);
  const showBrand = !compact;
  const onDark = mode === "type";
  const ink = onDark ? "#ffffff" : col.ink;
  const muted = onDark ? "rgba(255,255,255,.86)" : col.muted;
  const emphColor = onDark ? "#ffffff" : col.brand;

  const headLines = copy.headline.filter(Boolean);
  const longest = headLines.reduce((a, b) => (b.length > a.length ? b : a), "");
  const headMax = innerH * (arch === "number" && showEmph ? 0.11 : compact ? 0.2 : arch === "question" || arch === "type" ? 0.15 : 0.13);
  let headSize = lineSize(longest, innerW, headMax);
  let emphSize =
    arch === "number" ? lineSize(copy.emphasis, innerW, innerH * (compact ? 0.3 : 0.26)) : lineSize(copy.emphasis, innerW * 0.85, innerH * (compact ? 0.14 : 0.1));
  let ctaSize = lineSize(copy.cta, innerW * 0.7, Math.max(10, innerH * (compact ? 0.11 : 0.065)));
  let smallSize = Math.max(9, Math.min(innerH * 0.045, lineSize(copy.target || copy.sub, innerW, innerH * 0.05)));
  let gap = innerH * (compact ? 0.04 : 0.035);
  // 面の高さに収まるよう、全体を同じ比で縮める（縦長・小さいサイズで CTA が切れないように）
  {
    const parts: number[] = [];
    if (!compact) parts.push(logo ? minSide * 0.06 : smallSize * 1.3);
    if (showTarget) parts.push(smallSize * 1.4);
    if (showEmph) parts.push(arch === "offer" ? emphSize * 1.8 : emphSize * 1.05 + (copy.emphasisLabel && !compact ? emphSize * 0.5 : 0));
    parts.push(headLines.length * headSize * 1.28);
    if (showSub) parts.push(smallSize * 1.5 * Math.ceil(([...copy.sub].length * smallSize) / Math.max(1, innerW)));
    parts.push(ctaSize * 2.3);
    const total = parts.reduce((a, b) => a + b, 0) + gap * (parts.length - 1);
    const k = Math.min(1, innerH / total);
    headSize *= k;
    emphSize *= k;
    ctaSize *= k;
    smallSize = Math.max(8, smallSize * k);
    gap *= k;
  }

  const root: CSSProperties = {
    position: "relative",
    width: w,
    height: h,
    overflow: "hidden",
    background: "#f3f1ec",
    fontFamily: '"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Yu Gothic","Meiryo",sans-serif',
    boxShadow: "inset 0 0 0 1px rgba(0,0,0,.14)",
  };

  const imgPos = mode === "side" ? (subject === "right" ? "right center" : "left center") : mode === "stack" ? "center top" : "center";

  let panel: CSSProperties;
  if (mode === "side") {
    const fade = Math.round(panelW * 0.16);
    panel = {
      position: "absolute",
      top: 0,
      bottom: 0,
      [textSide]: 0,
      width: panelW + fade,
      paddingLeft: textSide === "right" ? fade + pad : pad,
      paddingRight: textSide === "right" ? pad : fade + pad,
      background: `linear-gradient(to ${textSide}, rgba(255,255,255,0) 0, rgba(255,255,255,.92) ${fade}px, rgba(255,255,255,.96) 100%)`,
    };
  } else if (mode === "stack") {
    const fade = Math.round(panelH * 0.18);
    panel = {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      height: panelH + fade,
      paddingTop: fade + pad,
      paddingLeft: pad,
      paddingRight: pad,
      paddingBottom: pad,
      background: `linear-gradient(to bottom, rgba(255,255,255,0) 0, rgba(255,255,255,.92) ${fade}px, rgba(255,255,255,.96) 100%)`,
    };
  } else {
    panel = {
      position: "absolute",
      inset: 0,
      padding: `${(h - panelH) / 2}px ${(w - panelW) / 2}px`,
      background: "linear-gradient(rgba(0,0,0,.30), rgba(0,0,0,.42))",
      textAlign: "center",
      alignItems: "center",
    };
  }

  const center = mode === "type";
  const pill: CSSProperties = {
    display: "inline-block",
    alignSelf: center ? "center" : "flex-start",
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
          alignSelf: center ? "center" : "flex-start",
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
          alignSelf: center ? "center" : "flex-start",
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

  // 型ごとの並び（上から）。数字の型は数字が先、それ以外は見出しが先
  const body = (
    <div
      style={{
        ...panel,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap,
        boxSizing: "border-box",
      }}
    >
      {brandMark}
      {showTarget && (
        <div style={{ color: emphColor, fontWeight: 800, fontSize: smallSize, letterSpacing: "0.03em" }}>{copy.target}</div>
      )}
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

  return (
    <div id={id} style={root}>
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: imgPos }} />
      ) : (
        <div style={{ position: "absolute", inset: 0, background: mode === "type" ? col.brand : "#ece8e0" }} />
      )}
      {body}
    </div>
  );
}
