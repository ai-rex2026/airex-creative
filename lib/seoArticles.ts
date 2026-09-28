import { askJson } from "./anthropic";
import type { Diagnosis } from "./types";
import type { SiteScan } from "./site-scan";
import type { KeywordPlan } from "./deep";
import { checkGuard } from "./guardrail";
import type { GuardHit } from "./types";

/**
 * SEO記事設計。対策キーワードを土台に、記事の「構成案」だけを作る（本文は書かない）。
 * 画面ではアコーディオン表示にするため、まず見出し構造（H2/H3）と要旨を持たせる。
 */

export type SeoArticleHeading = {
  h2: string;
  /** このH2で何を書くかの要旨（1〜2文） */
  summary: string;
  h3: string[];
};

export type SeoArticlePlan = {
  title: string;
  targetKeyword: string;
  /** 想定読者・検索意図 */
  intent: string;
  metaDescription: string;
  headings: SeoArticleHeading[];
  /** 目安の文字数（実測ではなく見積り） */
  estimatedChars: number;
  /** 法令上の指摘。見出し・要旨の文言も検査する */
  flags?: { text: string; law: string; reason: string; suggestion: string }[];
};

export type SeoArticleSet = {
  articles: SeoArticlePlan[];
  /** 生成に失敗したときの理由。章を空で出す代わりに事実を残す */
  error?: string;
};

async function flag(items: SeoArticlePlan[], industry: Diagnosis["industry"]): Promise<SeoArticlePlan[]> {
  const texts = items.flatMap((a) => [a.title, a.metaDescription, ...a.headings.flatMap((h) => [h.h2, h.summary, ...h.h3])]);
  if (!texts.length) return items;
  let hits: GuardHit[] = [];
  try {
    hits = (await checkGuard(texts, industry)).hits.filter((h) => h.severity !== "low");
  } catch {
    return items; // 検査できなくても記事案は返す
  }
  return items.map((a) => {
    const all = [a.title, a.metaDescription, ...a.headings.flatMap((h) => [h.h2, h.summary, ...h.h3])];
    const own = hits.filter((h) => all.some((t) => t?.includes(h.text)));
    return own.length
      ? { ...a, flags: own.map((h) => ({ text: h.text, law: h.law, reason: h.reason, suggestion: h.suggestion })) }
      : a;
  });
}

/**
 * @param priorityNote 17業種別・優先度マトリックスから作った指示文（lib/industryMatrix.ts）。
 *   業種によってこの章の必須度が変わるため、system instruction の末尾に足す。
 */
export async function generateSeoArticles(
  d: Diagnosis,
  site: SiteScan | null,
  keywords: KeywordPlan | null,
  priorityNote?: string
): Promise<SeoArticleSet> {
  const kw = (keywords?.rows ?? [])
    .slice(0, 12)
    .map((r) => `${r.keyword}（${r.kind}・優先度${r.priority}）`)
    .join(" / ");

  const res = await askJson<{ articles: SeoArticlePlan[] }>(
    `あなたはSEOコンテンツの構成作家です。対策キーワードをもとに、記事の設計案（構成のみ。本文は書かない）を2本作ります。

守ること:
- articles は2件。それぞれ異なる検索意図をカバーする（例：1本目は比較検討層向け、2本目は今すぐ客・地域検索向け）
- title は28〜36文字前後。狙うキーワードを自然に含める
- targetKeyword は渡された対策キーワードから選ぶか、それに近い複合語にする
- intent は「どんな人が何を知りたくて検索し、この記事で何を解決するか」を1文で
- metaDescription は100〜120文字。クリックしたくなる要約。誇大な表現は使わない
- headings は5〜8件のH2。各H2に要旨（summary、1〜2文）と、2〜4件のH3を付ける
- 見出しの並びは「読者の疑問→比較検討→行動（申込・来店・問い合わせ）」の順にする。「まとめ」だけで終わらせない
- **この商材の事実（強み・価格帯・実績・買わない理由への回答）を見出しレベルで反映する。**\
  一般論だけの見出し（例：「〇〇とは」だけで終わる説明記事）にしない
- 効果や結果を断定する表現・最上級表現は使わない（別途、法令チェックにかけます）
- estimatedChars は現実的な目安（2000〜5000字の範囲の数値1つ）
${priorityNote ? `\n${priorityNote}` : ""}`,
    `商材: ${d.product}
ターゲット: ${d.audience}
業種: ${d.industry}
強み: ${d.strengths.join(" / ")}
買わない理由: ${d.objections.join(" / ")}
訴求軸: ${d.angles.map((a) => a.name).join(" / ")}
${site ? `サイトタイトル: ${site.title}` : ""}
${kw ? `対策キーワード候補（この中から優先的に選ぶ）:\n${kw}` : "対策キーワードは未生成。商材とターゲットから直接考える"}

出力:
{"articles":[{"title":"","targetKeyword":"","intent":"","metaDescription":"",
 "headings":[{"h2":"","summary":"","h3":["",""]}],"estimatedChars":3000}]}`,
    { maxTokens: 4000 }
  );

  const articles = res.articles ?? [];
  return { articles: await flag(articles, d.industry) };
}
