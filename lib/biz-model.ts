import type { Diagnosis } from "./types";

/**
 * 商材が一般消費者向け（B2C）か、法人向け（B2B）かの簡易判定。
 *
 * 診断（Diagnosis）に専用の項目が無いので、ターゲットの記述から決める。
 * 法人向けと読める語が無ければ B2C とみなす（このアプリの利用者は店舗・クリニック等の
 * 一般消費者向けが中心のため）。SNSの媒体ごとの優先度の判断にだけ使う。
 */
const B2B_RE = /法人|企業|BtoB|B2B|事業者|経営者|経営層|担当者|店舗オーナー|代理店|人事|総務|情シス|取引先|卸|導入企業|中小企業|自治体/i;

export function isB2c(d: Pick<Diagnosis, "audience" | "product"> | null | undefined): boolean {
  if (!d) return true;
  return !B2B_RE.test(`${d.audience ?? ""} ${d.product ?? ""}`);
}

/** 媒体名の表記ゆれ（「X（Twitter）」など）を、扱う5媒体のどれかにそろえる */
export function canonPlatform(label: string): "YouTube" | "X" | "TikTok" | "Instagram" | "Facebook" | "LINE" | null {
  if (/youtube/i.test(label)) return "YouTube";
  if (/twitter|^x([^a-z]|$)/i.test(label)) return "X";
  if (/tiktok/i.test(label)) return "TikTok";
  if (/instagram/i.test(label)) return "Instagram";
  if (/facebook/i.test(label)) return "Facebook";
  if (/line/i.test(label)) return "LINE";
  return null;
}
