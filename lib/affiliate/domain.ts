/** ドメイン正規化（メディア台帳の名寄せキー） */
export function normalizeDomain(input: string): string {
  let s = (input || "").trim().toLowerCase();
  if (!s) return "";
  s = s.replace(/^https?:\/\//, "");
  s = s.split("/")[0].split("?")[0].split("#")[0];
  s = s.replace(/:\d+$/, "");
  s = s.replace(/^www\./, "");
  return s;
}

export function safeUrl(u: string): string {
  const s = (u || "").trim();
  if (!s) return "";
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

/** 打診候補のステータス。いまは調査の結果として「収集済」「対象外」だけを使う */
export const TARGET_STATUS: Record<string, string> = {
  collected: "収集済",
  excluded: "対象外",
};

export function statusTone(s: string): string {
  if (s === "excluded") return "bg-zinc-200 text-zinc-600";
  return "bg-slate-100 text-slate-700";
}

/** HTML をざっくり本文テキストにする */
export function htmlToText(html: string, limit = 15000): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}
