import { askJson } from "../anthropic";
import { geminiGenerate, hasGemini } from "../gemini";
import { normalizeJapanese } from "../meo-ops/japanese";
import type { AioSatelliteItem } from "./content-types";
import { fetchHtml, htmlToText } from "./net";

/**
 * サテライトサイトの比較記事のために、商品・サービスの事実を集める（2026-10-21）。
 * 1. 公式サイトのトップと、料金・機能・会社概要・実績・FAQ らしいページ（最大5件）を読む
 * 2. 読んだ本文から、書かれている事実だけを AI に抜き出させる（出典の URL つき）
 * 3. Gemini（Google 検索つき）で、公式サイト以外の公開情報を補う（出典が取れたものだけ）
 * 集めた事実は「記事に書いてよい事実」の欄に入り、人が確かめて直せる。記事はこの欄の事実だけで書く
 */

export type FactDeps = {
  fetchPage: (url: string) => Promise<{ html: string; finalUrl: string }>;
  extract: (system: string, user: string) => Promise<{ facts?: { label?: string; fact?: string; source?: string }[] }>;
  search: ((system: string, question: string) => Promise<{ text: string; sources: { uri: string; title: string }[] }>) | null;
};

export const defaultFactDeps = (): FactDeps => ({
  fetchPage: (url) => fetchHtml(url, { browserUa: true, timeoutMs: 12_000 }),
  extract: (system, user) => askJson(system, user, { maxTokens: 4000, timeoutMs: 90_000 }),
  search: hasGemini()
    ? async (system, question) => {
        const r = await geminiGenerate({ system, parts: [{ text: question }], maxTokens: 4000, search: true, timeoutMs: 90_000 });
        return { text: r.text, sources: (r.grounding?.sources ?? []).map((s) => ({ uri: s.uri, title: s.title })) };
      }
    : null,
});

/** 比較に効くページ（料金・機能・会社概要・実績・FAQ）へのリンクらしさ */
const USEFUL = /(price|pricing|plan|fee|cost|料金|費用|価格|プラン|feature|function|機能|特徴|強み|service|サービス|about|company|corporate|会社|企業情報|概要|実績|事例|case|works|faq|よくある|flow|流れ|support|サポート)/i;

/** トップページから、同じサイトの比較に効くページを最大 n 件選ぶ */
export function pickUsefulLinks(html: string, base: string, n = 5): string[] {
  const host = new URL(base).hostname.replace(/^www\./, "");
  const out: string[] = [];
  for (const m of html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    let u: URL;
    try {
      u = new URL(m[1].replace(/&amp;/g, "&"), base);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(u.protocol) || u.hostname.replace(/^www\./, "") !== host) continue;
    if (/\.(pdf|jpe?g|png|gif|webp|zip|svg)$/i.test(u.pathname)) continue;
    const label = m[2].replace(/<[^>]+>/g, " ");
    if (!USEFUL.test(u.pathname) && !USEFUL.test(label)) continue;
    u.hash = "";
    const s = u.toString();
    if (s.replace(/\/$/, "") === base.replace(/\/$/, "") || out.includes(s)) continue;
    out.push(s);
    if (out.length >= n) break;
  }
  return out;
}

const EXTRACT_SYSTEM = `あなたは比較メディアの調査担当です。与えられたページの本文から、比較記事に使える**事実**だけを抜き出します。
- 本文にはっきり書かれていることだけ。推測・一般論・評価（「おすすめ」「高品質」など）は入れない。数字・料金・対応範囲・提供形態・会社情報・実績の件数・サポート内容など、他社と比べられるものを優先する
- 料金は条件（税込/税別・月額/初期費用・最低契約期間）もそのまま書く。書かれていなければ書かない
- 宣伝文句（「業界No.1」「満足度98%」など）は、事業者の自己申告として「〜と公式サイトに記載」の形で、調査の条件が書かれている場合だけ入れる
- 1件は1文・80字以内。最大15件。出典は、その事実が書かれていたページの URL（与えられた URL のどれか）
出力は JSON: {"facts":[{"label":"料金|機能|対応範囲|会社情報|実績|サポート|その他","fact":"…","source":"https://…"}]}`;

const SEARCH_SYSTEM = `あなたは比較メディアの調査担当です。Google検索で、指定のサービスについての公開情報（料金・対応範囲・会社情報・実績・提供形態など、他社と比べられる事実）を調べます。
- 検索結果のページにはっきり書かれている事実だけを書く。推測・評判・口コミ・個人の感想は入れない
- 1行に1件、「・事実（出典のサイト名）」の形で最大8件。分からなければ「なし」とだけ書く`;

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

/**
 * 1つの商品・サービスの事実を集めて、欄に入れる文面にする。
 * 公式サイトの読み取りが1ページも成功しなければ失敗にする（検索だけで埋めない）
 */
export async function collectItemFacts(
  item: Pick<AioSatelliteItem, "name" | "url">,
  ctx: { theme: string; basis: string },
  deps: FactDeps = defaultFactDeps()
): Promise<{ text: string; pages: number; searched: boolean; notes: string[] }> {
  if (!item.url) throw new Error(`「${item.name}」の公式サイトの URL を入れてください`);
  const notes: string[] = [];
  const top = await deps.fetchPage(item.url).catch((e: unknown) => {
    throw new Error(`「${item.name}」の公式サイトを開けませんでした（${e instanceof Error ? e.message : "不明"}）`);
  });
  const links = pickUsefulLinks(top.html, top.finalUrl);
  const subs = await Promise.allSettled(links.map((u) => deps.fetchPage(u)));
  const pages = [{ url: top.finalUrl, text: htmlToText(top.html) }];
  subs.forEach((r, i) => {
    if (r.status === "fulfilled") pages.push({ url: r.value.finalUrl, text: htmlToText(r.value.html) });
    else notes.push(`${links[i]} を開けませんでした`);
  });

  const urls = new Set(pages.map((p) => p.url));
  const body = pages.map((p) => `## ページ: ${p.url}\n${clip(p.text, 6000)}`).join("\n\n");
  const user = [
    `# 対象: ${item.name}`,
    ctx.theme ? `# 比較メディアのテーマ: ${ctx.theme}` : "",
    ctx.basis ? `# 比べる基準（これに関わる事実を優先する）: ${ctx.basis}` : "",
    "",
    clip(body, 30_000),
  ]
    .filter(Boolean)
    .join("\n");

  // 公式サイトからの抜き出しと、検索での補いは独立しているので並べて走らせ、片方の失敗で他方を捨てない
  const [ext, sea] = await Promise.allSettled([
    deps.extract(EXTRACT_SYSTEM, user),
    deps.search ? deps.search(SEARCH_SYSTEM, `「${item.name}」（公式サイト: ${item.url}）について、${ctx.basis || "料金・対応範囲・会社情報・実績"}に関する公開情報を調べてください。`) : Promise.resolve(null),
  ]);

  const lines: string[] = [];
  if (ext.status === "fulfilled") {
    for (const f of ext.value.facts ?? []) {
      const fact = normalizeJapanese(String(f.fact ?? "").trim());
      if (!fact) continue;
      // 出典は読んだページのどれかに限る（AI が作った URL は使わない）
      const want = String(f.source ?? "").replace(/\/+$/, "");
      const src = [...urls].find((u) => u.replace(/\/+$/, "") === want) ?? top.finalUrl;
      lines.push(`・${f.label ? `${String(f.label).slice(0, 10)}：` : ""}${clip(fact, 120)}（出典: ${src}）`);
      if (lines.length >= 15) break;
    }
  } else {
    notes.push(`公式サイトからの抜き出しに失敗しました（${ext.reason instanceof Error ? ext.reason.message : "不明"}）`);
  }

  let searched = false;
  if (sea.status === "fulfilled" && sea.value) {
    const v = sea.value;
    const found = v.text
      .split("\n")
      .map((l) => normalizeJapanese(l.trim()))
      .filter((l) => /^[・\-*]/.test(l) && !/^[・\-*]\s*なし$/.test(l))
      .map((l) => `・${l.replace(/^[・\-*]\s*/, "")}`)
      .slice(0, 8);
    // 検索の根拠（出典）が取れなかった回答は使わない
    if (found.length && v.sources.length) {
      searched = true;
      const titles = [...new Set(v.sources.map((s) => s.title).filter(Boolean))].slice(0, 5).join("・");
      if (lines.length) lines.push("");
      lines.push(`【公式サイト以外の公開情報（Google検索・出典: ${titles}）】`, ...found);
    }
  } else if (sea.status === "rejected") {
    notes.push(`検索での補いに失敗しました（${sea.reason instanceof Error ? sea.reason.message : "不明"}）`);
  }

  if (!lines.length) throw new Error(`「${item.name}」の事実を見つけられませんでした${notes.length ? `（${notes.join(" / ")}）` : ""}`);
  return { text: clip(lines.join("\n"), 3000), pages: pages.length, searched, notes };
}
