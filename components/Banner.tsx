"use client";

import type { CSSProperties } from "react";
import type { BannerCopy, BrandProfile } from "@/lib/types";
import type { SizePreset } from "@/lib/sizes";

/**
 * バナーは画像生成モデルに描かせず DOM で組む。
 * 日本語の字形が崩れないことと、文言だけ差し替えて量産できることの2点が理由。
 *
 * 白地・情報整理型（打ち合わせで選定）。
 * 効果を重ねると「AIが作った感じ」になるので、色の面はブランド色ひとつに絞り、
 * 影・グラデーション・傾き・原色の下線は使わない。以前はリボンの下線に
 * ブランドと無関係な赤が直書きされていて、それがテンプレート感の元になっていた。
 * 装飾の代わりに**実測できた事実**を並べて密度を出す。
 */

/** 枠に収まる文字サイズを字数から逆算する。日本語は1文字≒1em */
function fitSize(text: string, boxW: number, boxH: number, max: number, lh = 1.5) {
  if (!text) return max;
  for (let s = max; s > 8; s -= 1) {
    const perLine = Math.max(Math.floor(boxW / s), 1);
    if (Math.ceil(text.length / perLine) * s * lh <= boxH) return s;
  }
  return 8;
}

/** 1行で見せたい文言を枠幅に収める */
function fitOneLine(text: string, boxW: number, max: number) {
  if (!text) return max;
  return Math.min(max, boxW / (text.length + 0.6));
}

export type BannerFact = { value: string; label: string };

/**
 * 強みから「数字」と「その説明」を取り出す。
 * 装飾ではなく事実で密度を出すのがこのデザインの肝なので、数字を優先する。
 * AI には書かせない（毎回表記が揺れるため）。
 */
/**
 * 最上級・No.1の表現。実測で裏が取れないので、バナーに出さない。
 * 強みの文章には入り込むため、機械的に取り出す側で落とす（景表法）。
 */
const SUPERLATIVE = /No\.?1|ナンバーワン|日本一|国内一|世界一|最高|最大|最安|最多|最速|最先端|唯一|随一|トップクラス|TOPクラス|業界初|日本初|第一人者/i;

/**
 * 数字の前にある語から見出しを作る。
 * 頭から8文字で切ると「削らないラミネー」のように語の途中で切れるので、
 * 修飾を落として**末尾の名詞**を残す。
 */
function labelFor(before: string): string {
  const words = before.replace(/[。、（）()｜|]/g, " ").trim().split(/\s+/).filter((w) => w && !SUPERLATIVE.test(w));
  const t = words.pop() ?? "";
  const tail = t.split("の").pop() ?? "";
  const pick = tail.length >= 2 ? tail : t;
  return pick.length <= 9 ? pick : pick.slice(-9);
}

export function pickFacts(strengths: string[], max = 3): BannerFact[] {
  const out: BannerFact[] = [];
  for (const s of strengths) {
    if (out.length >= max) break;
    const m = s.match(/(約?[0-9][0-9,]*\s*(?:万|億)?\s*(?:件|年|分|名|人|%|％|円|時間|日))/);
    if (m) {
      const value = m[1].replace(/\s+/g, "");
      out.push({ value, label: labelFor(s.slice(0, m.index ?? 0)) });
      continue;
    }
    const short = s.replace(/[。、].*$/, "").trim();
    if (short.length <= 10) out.push({ value: short, label: "" });
  }
  return out;
}

export function Banner({
  copy,
  brand,
  size,
  id,
  service,
  facts = [],
  image,
}: {
  copy: BannerCopy;
  brand: BrandProfile;
  size: SizePreset;
  id: string;
  /** サイトから拾った写真。同一オリジン経由で渡すこと（PNG書き出しが失敗するため） */
  image?: string | null;
  /** 何屋かを示す短い語。無いとブランド名だけになり、何の広告か伝わらない */
  service?: string;
  /** 下部に並べる事実。実測から作る */
  facts?: BannerFact[];
}) {
  const { w, h } = size;
  const compact = Math.min(w, h) < 400;
  const landscape = w / h > 1.6;
  const u = Math.min(w, h) / (compact ? 250 : landscape ? 628 : 1080);
  const px = (n: number) => `${n * u}px`;

  const accent = brand.accent || "#8B7355";
  const pad = compact ? 18 * u : 44 * u;
  // 小枠では側面パネルを出さない。文字が入らなくなる
  const side = !compact && landscape && !image;
  // 写真は文字と重ねない。重ねると日本語が読めなくなり、
  // 読ませるために暗幕を敷くと「加工した写真」に見える
  const photoSide = !!image && landscape;
  const photoTop = !!image && !landscape;
  const textW = photoSide ? w * 0.6 : w;
  const colW = (side ? w * 0.66 : textW) - pad * 2;

  const maxChars = Math.max(copy.headline[0].length, copy.headline[1].length, 1);
  // 1文字1emで折り返さない上限。係数を1超にすると300x250で見出しが1文字だけ
  // 次行に落ちるので、字送りのぶんを見て1未満に留める
  const hSize = Math.min(compact ? 34 * u : landscape ? 74 * u : 104 * u, (colW / maxChars) * 0.96);
  const shown = facts.slice(0, compact ? 2 : 3);

  const stage: CSSProperties = {
    position: "relative",
    display: "flex",
    flexDirection: photoTop ? "column" : "row",
    width: w,
    height: h,
    overflow: "hidden",
    background: "#fff",
    color: "#1A1A1A",
    fontFamily: '"Hiragino Sans", "ヒラギノ角ゴシック", "Noto Sans JP", sans-serif',
    // 白背景が配信面に沈まないよう細い枠だけ置く。影は使わない
    border: `${Math.max(1, u)}px solid #E8E4DC`,
  };

  const cta = (
    <div
      style={{
        background: side ? "#fff" : accent,
        color: side ? accent : "#fff",
        fontWeight: 900,
        fontSize: fitOneLine(copy.cta, (side ? w * 0.34 : colW) - pad, compact ? 22 * u : 30 * u),
        padding: `${px(compact ? 8 : 15)} ${px(compact ? 16 : 30)}`,
        borderRadius: px(3),
        whiteSpace: "nowrap",
        width: "fit-content",
      }}
    >
      {copy.cta}
    </div>
  );

  const photo = image ? (
    <div
      style={{
        flex: photoTop ? `0 0 ${compact ? 38 : 42}%` : "0 0 40%",
        position: "relative",
        overflow: "hidden",
        background: "#EFEBE4",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image}
        alt=""
        crossOrigin="anonymous"
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          bottom: 0,
          background: accent,
          color: "#fff",
          fontWeight: 700,
          fontSize: fitOneLine(brand.name, w * 0.34, compact ? 14 * u : 20 * u),
          padding: `${px(compact ? 4 : 7)} ${px(compact ? 10 : 15)}`,
          whiteSpace: "nowrap",
        }}
      >
        {brand.name}
      </div>
    </div>
  ) : null;

  return (
    <div id={id} style={stage}>
      {photoTop && photo}
      <div
        style={{
          flex: side ? "0 0 66%" : 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: px(compact ? 5 : 13),
          padding: `${px(compact ? 10 : 34)} ${pad}px`,
        }}
      >
        {service && (
          <div
            style={{
              width: "fit-content",
              maxWidth: "100%",
              background: accent,
              color: "#fff",
              fontWeight: 700,
              letterSpacing: px(0.6),
              fontSize: fitOneLine(service, colW * 0.9, compact ? 15 * u : 20 * u),
              padding: `${px(compact ? 3 : 5)} ${px(compact ? 9 : 13)}`,
              borderRadius: px(2),
              whiteSpace: "nowrap",
            }}
          >
            {service}
          </div>
        )}

        <div style={{ fontSize: hSize, fontWeight: 900, lineHeight: 1.16, letterSpacing: `${-hSize * 0.02}px` }}>
          <div>{copy.headline[0]}</div>
          <div style={{ color: accent }}>{copy.headline[1]}</div>
        </div>

        {copy.subhead && !compact && (
          <div
            style={{
              fontSize: fitSize(copy.subhead, colW, h * 0.13, hSize * 0.32, 1.6),
              lineHeight: 1.6,
              color: "#5A5348",
              fontWeight: 500,
            }}
          >
            {copy.subhead}
          </div>
        )}

        {shown.length > 0 && (
          <div
            style={{
              display: "flex",
              borderTop: `${Math.max(1, u)}px solid #EDE9E1`,
              paddingTop: px(compact ? 7 : 11),
              marginTop: px(2),
            }}
          >
            {shown.map((f, i) => (
              <div
                key={i}
                style={{
                  paddingRight: px(compact ? 12 : 20),
                  marginRight: px(compact ? 12 : 20),
                  borderRight: i < shown.length - 1 ? `${Math.max(1, u)}px solid #EDE9E1` : "none",
                }}
              >
                <b
                  style={{
                    display: "block",
                    fontSize: fitOneLine(f.value, colW / (shown.length + 0.4), compact ? 19 * u : 27 * u),
                    fontWeight: 900,
                    color: accent,
                    lineHeight: 1.2,
                    whiteSpace: "nowrap",
                  }}
                >
                  {f.value}
                </b>
                {f.label && (
                  <small style={{ fontSize: px(compact ? 9 : 13), color: "#8A8175", whiteSpace: "nowrap" }}>
                    {f.label}
                  </small>
                )}
              </div>
            ))}
          </div>
        )}

        {!side && <div style={{ marginTop: px(compact ? 5 : 12) }}>{cta}</div>}
      </div>

      {photoSide && photo}

      {side && (
        <div
          style={{
            flex: 1,
            background: accent,
            color: "#fff",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
            gap: px(16),
            padding: px(26),
            textAlign: "center",
          }}
        >
          <div style={{ lineHeight: 1.25 }}>
            <b style={{ display: "block", fontSize: px(30), fontWeight: 900 }}>{brand.name}</b>
            {brand.kana && (
              <span style={{ display: "block", fontSize: px(14), opacity: 0.85, marginTop: px(4) }}>{brand.kana}</span>
            )}
          </div>
          {cta}
        </div>
      )}
    </div>
  );
}
