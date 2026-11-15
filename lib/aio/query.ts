import { normalizeJapanese } from "../meo-ops/japanese";

/** Google 検索の「AI による概要」を測るときの検索語を整える（全角30字前後・空白1つ区切り） */
export const cleanQuery = (q: unknown) => normalizeJapanese(String(q ?? "")).replace(/\s+/g, " ").trim().slice(0, 40);

// ── Google の「AI による概要」の出典の見分け（2026-11-15） ──────────────
// 出典の中には google.com のものがあり、実測では2種類だった：
// - /goto?url=…（Google の転送リンク。転送先のサイトは暗号化されていて URL からは分からない。タイトルは転送先のページのもの）
// - /searchviewer/…（Google のビジネスプロフィール＝店舗・場所。タイトルは店名）
// これらを「google.com」1つにまとめると、自社サイトの引用やビジネスプロフィールの引用が見えなくなるので分けて扱う

export type OvRef = { url: string; domain: string; title: string };
export type OvRefKind = "site" | "place" | "redirect" | "google";

export const OV_KIND_LABEL: Record<Exclude<OvRefKind, "site">, string> = {
  place: "Google ビジネスプロフィール（店舗・場所）",
  redirect: "Google 経由のリンク（転送先不明）",
  google: "google.com（その他）",
};

const NOISE = /[\s\-‐‑–—ー・\/／|｜│()（）[\]「」『』【】"'’、。．,.!！?？&＆*#_`>]/g;
const LEGAL = /株式会社|\(株\)|有限会社|\(有\)|合同会社|\(合\)|\(同\)/g;
export const normName = (s: string) => s.normalize("NFKC").replace(LEGAL, "").replace(NOISE, "").toLowerCase();
const bare = (d: string) => d.toLowerCase().replace(/^www\./, "");

export function ovRefKind(r: OvRef): OvRefKind {
  const d = bare(r.domain);
  const isGoogle = /^google\.[a-z.]+$/.test(d) || /^maps\.google\.[a-z.]+$/.test(d);
  if (!isGoogle) return "site";
  let path = "";
  try {
    path = new URL(r.url).pathname;
  } catch {
    path = "";
  }
  if (d.startsWith("maps.") || path.startsWith("/searchviewer") || path.startsWith("/maps")) return "place";
  if (path.startsWith("/goto") || path === "/url") return "redirect";
  return "google";
}

/** 媒体の集計に使う名前（サイトはドメイン、Google のものは種類ごとの名前） */
export function ovRefLabel(r: OvRef): string {
  const k = ovRefKind(r);
  return k === "site" ? bare(r.domain) : OV_KIND_LABEL[k];
}

/** 出典が自社か：サイトはドメイン、Google のもの（ビジネスプロフィール・転送リンク）はタイトルに自社名があるか */
export function ovRefIsOwn(r: OvRef, names: string[], domains: string[]): boolean {
  if (ovRefKind(r) === "site") {
    const d = bare(r.domain);
    return domains.map(bare).some((o) => !!o && (d === o || d.endsWith(`.${o}`)));
  }
  const t = normName(r.title);
  return names.some((n) => {
    const k = normName(n);
    return k.length >= 2 && t.includes(k);
  });
}

export function ovOwnCited(ov: { references: OvRef[] }, names: string[], domains: string[]): boolean {
  return ov.references.some((r) => ovRefIsOwn(r, names, domains));
}
