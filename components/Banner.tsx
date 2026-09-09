"use client";

import type { CSSProperties } from "react";
import type { BannerCopy, BrandProfile } from "@/lib/types";
import type { SizePreset } from "@/lib/sizes";

/**
 * バナーは画像生成モデルに描かせず DOM で組む。
 * 日本語の字形が崩れないことと、文言だけ差し替えて量産できることの2点が理由。
 * PNG 化はブラウザ側（html-to-image）で行うので CSS の表現力をそのまま使える。
 *
 * レイアウトは絶対配置ではなく縦フレックス（ヘッダ／本文／フッタ）にしてある。
 * 媒体ごとに縦横比が大きく違うため、余白を機械的に分配しないと縦長で間延びする。
 */
export function Banner({
  copy,
  brand,
  size,
  id,
  service,
}: {
  copy: BannerCopy;
  brand: BrandProfile;
  size: SizePreset;
  id: string;
  /** 何屋かを示す短い語。無いとブランド名だけになり、何の広告か伝わらない */
  service?: string;
}) {
  const { w, h } = size;
  const compact = Math.min(w, h) < 400; // 300x250 のような小枠
  const landscape = w / h > 1.6; // 1200x628 のような横長
  const u = Math.min(w, h) / (compact ? 250 : landscape ? 628 : 1080);
  const px = (n: number) => `${n * u}px`;

  const pad = compact ? 16 * u : 52 * u;
  // 見出しは枠に収まる字送りから逆算する。日本語は1文字≒1em として扱える
  const colW = (landscape ? w * 0.62 : w) - pad * 2;
  const maxChars = Math.max(copy.headline[0].length, copy.headline[1].length, 1);
  const hSize = Math.min(compact ? 62 * u : landscape ? 92 * u : 132 * u, (colW / maxChars) * 1.02);
  const accent = brand.accent || "#f0b429";

  const stage: CSSProperties = {
    position: "relative",
    display: "flex",
    flexDirection: landscape ? "row" : "column",
    width: w,
    height: h,
    overflow: "hidden",
    fontFamily: '"Hiragino Sans", "ヒラギノ角ゴシック", "Noto Sans JP", sans-serif',
    background: `radial-gradient(120% 70% at 50% 6%, ${hexA(accent, 0.2)} 0%, rgba(0,0,0,0) 62%),
      linear-gradient(180deg,#2b2b2b 0%,#0d0d0d 48%,#000 100%)`,
    color: "#fff",
  };

  // 右カラム（横長）と本文カラムの実寸。ここに収める
  const rightW = landscape ? w * 0.38 - pad : w - pad * 2;
  const ctaMax = compact ? 26 * u : 40 * u;
  const ctaSize = fitOneLine(copy.cta, (landscape ? rightW : colW) - px2(compact ? 48 : 96, u), ctaMax);

  const cta = (
    <div
      style={{
        width: "fit-content",
        maxWidth: "100%",
        background: "#fff",
        borderRadius: 999,
        padding: `${px(compact ? 10 : 18)} ${px(compact ? 24 : 48)}`,
        boxShadow: `0 ${px(6)} ${px(16)} rgba(0,0,0,.35)`,
      }}
    >
      <b style={{ color: "#111", fontWeight: 900, fontSize: ctaSize, whiteSpace: "nowrap" }}>
        {copy.cta}
      </b>
    </div>
  );

  return (
    <div id={id} style={stage}>
      {/* 右上のストライプ。ブランド色のアクセント */}
      <div
        style={{
          position: "absolute",
          top: -h * 0.06,
          right: -w * 0.04,
          width: w * 0.26,
          height: h * 0.3,
          transform: "rotate(-38deg)",
          display: "flex",
          gap: px(12),
          pointerEvents: "none",
        }}
      >
        <i style={{ width: px(14), height: "100%", background: accent, opacity: 0.85 }} />
        <i style={{ width: px(14), height: "72%", background: accent, opacity: 0.45 }} />
        <i style={{ width: px(14), height: "88%", background: "#fff", opacity: 0.2 }} />
      </div>

      {/* 本文カラム */}
      <div
        style={{
          flex: landscape ? "0 0 62%" : 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: px(compact ? 8 : 18),
          padding: `${px(compact ? 14 : 40)} ${pad}px`,
          minWidth: 0,
        }}
      >
        {/* 何屋かを最初に置く。ブランド名だけでは何の広告か伝わらない */}
        {service && (
          <div
            style={{
              width: "fit-content",
              maxWidth: "100%",
              border: `${px(2)} solid ${accent}`,
              borderRadius: px(999),
              padding: `${px(compact ? 4 : 7)} ${px(compact ? 12 : 20)}`,
              color: accent,
              fontWeight: 900,
              fontSize: fitOneLine(service, colW * 0.9, compact ? 20 * u : 26 * u),
              whiteSpace: "nowrap",
              marginBottom: px(compact ? 6 : 12),
            }}
          >
            {service}
          </div>
        )}

        {!compact && (
          <div style={{ lineHeight: 1, marginBottom: px(10) }}>
            <b style={{ display: "block", fontSize: px(40), fontWeight: 900 }}>{brand.name}</b>
            {brand.kana && (
              <span style={{ display: "block", color: accent, fontSize: px(17), fontWeight: 700, marginTop: px(5) }}>
                {brand.kana}
              </span>
            )}
          </div>
        )}

        <div
          style={{
            fontSize: hSize,
            fontWeight: 900,
            lineHeight: 1.06,
            letterSpacing: `${-hSize * 0.04}px`,
            textShadow: `0 ${px(8)} ${px(20)} rgba(0,0,0,.55)`,
          }}
        >
          <div>{copy.headline[0]}</div>
          <div style={{ color: accent }}>{copy.headline[1]}</div>
        </div>

        {copy.subhead && !compact && (
          <div style={{ fontSize: fitSize(copy.subhead, colW, h * 0.12, hSize * 0.4, 1.35), fontWeight: 900 }}>{copy.subhead}</div>
        )}

        {(copy.ribbonTop || copy.ribbonBottom) && (
          <div
            style={{
              width: "fit-content",
              padding: `${px(compact ? 8 : 15)} ${px(compact ? 16 : 30)}`,
              background: "#fff",
              transform: "skewX(-6deg)",
              boxShadow: `0 ${px(6)} ${px(16)} rgba(0,0,0,.4)`,
            }}
          >
            <div style={{ transform: "skewX(6deg)" }}>
              {copy.ribbonTop && !compact && (
                <div style={{ fontWeight: 900, color: "#111", fontSize: fitOneLine(copy.ribbonTop ?? "", colW * 0.86, hSize * 0.3) }}>{copy.ribbonTop}</div>
              )}
              {copy.ribbonBottom && (
                <div
                  style={{
                    fontWeight: 900,
                    color: "#c30d1e",
                    fontSize: fitOneLine(copy.ribbonBottom ?? "", colW * 0.86, hSize * 0.44),
                    marginTop: compact ? 0 : px(4),
                    borderBottom: `${px(6)} solid #c30d1e`,
                    display: "inline-block",
                    whiteSpace: "nowrap",
                  }}
                >
                  {copy.ribbonBottom}
                </div>
              )}
            </div>
          </div>
        )}

        {compact && <div style={{ marginTop: px(6) }}>{cta}</div>}
      </div>

      {/* 横長は右カラムにCTA、縦は下の黒帯に本文＋CTA */}
      {landscape ? (
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: px(20),
            padding: `${px(40)} ${pad}px ${px(40)} 0`,
          }}
        >
          <p style={{ fontWeight: 700, fontSize: fitSize(copy.body, rightW - pad, h * 0.42, 26 * u, 1.6), lineHeight: 1.6, margin: 0 }}>
            {copy.body}
          </p>
          {cta}
        </div>
      ) : (
        !compact && (
          <div style={{ background: "#000", padding: `${px(34)} ${pad}px ${px(42)}` }}>
            <p style={{ fontWeight: 700, fontSize: fitSize(copy.body, w - pad * 2, h * 0.16, 32 * u, 1.5), lineHeight: 1.5, margin: 0 }}>{copy.body}</p>
            <div style={{ margin: `${px(24)} auto 0`, width: "fit-content" }}>{cta}</div>
          </div>
        )
      )}
    </div>
  );
}

/**
 * 枠に収まる文字サイズを字数から逆算する。
 * 日本語は1文字≒1em なので、1行に入る字数と行数から必要な高さが出る。
 * これをやらないと、長い文言が枠から出て切れる（1200x628 で実際に起きた）。
 */
function fitSize(text: string, boxW: number, boxH: number, max: number, lh = 1.5) {
  if (!text) return max;
  for (let s = max; s > 8; s -= 1) {
    const perLine = Math.max(Math.floor(boxW / s), 1);
    const lines = Math.ceil(text.length / perLine);
    if (lines * s * lh <= boxH) return s;
  }
  return 8;
}

/** 1行で見せたい文言を、枠幅に収める */
function fitOneLine(text: string, boxW: number, max: number) {
  if (!text) return max;
  return Math.min(max, boxW / (text.length + 0.5));
}

function px2(n: number, u: number) {
  return n * u;
}

function hexA(hex: string, a: number) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return `rgba(240,180,41,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
