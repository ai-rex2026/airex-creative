import { askJson } from "../anthropic";
import { checkGuard } from "../guardrail";
import { normalizeJapanese } from "../meo-ops/japanese";
import type { GuardVerdict } from "../types";
import { MAX_INLINE_IMAGES, type AioArticleImage, type AioChannel, type AioChannelKind, type AioMetric } from "./content-types";
import { bodyChars, h2List } from "./md";
import type { AioCheck, AioProject } from "./types";

/**
 * 記事を1本書く（本文・タイトル・メタ・スラッグ・ハッシュタグ・画像の指示）。
 * 既存記事のトンマナ（AioStyle）に合わせ、既存のテーマとは重ならないようにする。
 * 法令チェックは保存の直後に同じ流れで通し（guardArticle）、通るまで公開できない（AGENTS.md）。数字・実績は与えられたものだけ。
 */

export type ArticleBrief = { title?: string; target?: string; outline?: string; note?: string };

export type DraftedArticle = {
  title: string;
  slug: string;
  metaDescription: string;
  keywords: string[];
  target: string;
  bodyMd: string;
  hashtags: string[];
  images: AioArticleImage[];
};

const SYSTEM = `あなたは日本の事業者のオウンドメディア（自社サイトのコラム・note）の編集者兼ライターです。
見込み客の問いに答える記事を、その媒体の既存記事と同じトンマナで書きます。検索エンジンと AI（ChatGPT・Gemini・Perplexity・Google の AI による概要）が引用しやすい構成にします。

守ること:
- 事実を創作しない。与えられていない数字・実績・受賞・顧客名・価格・事例・調査結果を書かない（穴埋めの「〇〇」も作らない）
- 「必ず」「絶対」「No.1」「最高」「業界初」「唯一」など根拠の要る断定・最上級を使わない。効果や成果を約束しない
- 医療・美容・健康食品・金融の効果効能を断定しない。体験談を効果の根拠にしない
- 他社を名指しで比べたり貶めたりしない
- 最初の段落で問いへの答え（結論）を書く。見出し（##）の直下に、その節の要点を1〜2文で置く
- 固有名詞（事業者名・サービス名・地域名）は略さず正確に書く
- 本文は Markdown（## と ### の見出し、箇条書き、太字、表）。記事タイトルは本文に入れない
- 日本語の文章で通常使う漢字（常用漢字・日本の新字体）だけで書く。中国語の簡体字・繁体字を使わない

画像の指示（images）:
- アイキャッチ1枚（role "eyecatch"）と、本文中の画像を最大${MAX_INLINE_IMAGES}枚（role "inline"。afterH2 は何番目の ## の直後に置くか、0 始まり）
- prompt は画像生成 AI への英語の説明。記事の内容に合う場面・物・雰囲気を具体的に書く。文字・看板・ロゴ・画面のスクリーンショット・グラフは描かせない
- 実在の人物・有名人・他社の商品やロゴ、医療・美容の施術前後の比較は描かせない
- alt は日本語の代替テキスト（40字以内。画像の中には入れない）

出力: {"title":"記事タイトル","slug":"英小文字とハイフンだけのURL用スラッグ（5語以内）","metaDescription":"検索結果に出る説明文（110字前後）","keywords":["狙う検索語（3〜6個）"],"target":"この記事が答える問い","body":"本文（Markdown）","hashtags":["note 用のハッシュタグ（#なし。サイト記事なら空）"],"images":[{"role":"eyecatch","afterH2":null,"prompt":"English description","alt":"日本語の代替テキスト"}]}`;

function channelGuide(kind: AioChannelKind, ch: AioChannel | null, project: AioProject): string[] {
  const st = ch?.style;
  const chars = st?.measured.avgChars ? Math.min(6000, Math.max(1500, Math.round(st.measured.avgChars / 100) * 100)) : kind === "note" ? 2000 : 3000;
  const lines = [
    `# 媒体`,
    kind === "note"
      ? "note。一人称（私たち／私）で、現場で見てきたこと・考えを語る読み物。宣伝色を抑え、最後に自社サイトへの案内を1〜2文。ハッシュタグを3〜5個"
      : "自社サイトのコラム（WordPress）。検索語を含むタイトル、見出し5〜7個、最後に「よくある質問」3問とまとめ。自社の紹介・問い合わせへの案内は最後の1節だけ",
    `目安の文字数: ${chars}字前後（既存記事に合わせる）`,
  ];
  if (st) {
    lines.push(
      "",
      "# 既存記事のトンマナ（これに合わせる）",
      `全体: ${st.summary}`,
      `文体: ${st.voice}（です／ます率 ${st.measured.politeRatio}%）`,
      `読者: ${st.reader}`,
      `見出し: ${st.headings}（h2 平均 ${st.measured.avgH2} 個）`,
      `構成: ${st.structure}`,
      `言い回し: ${st.phrases}`,
      st.imagery ? `画像: ${st.imagery}` : "",
      st.topics.length ? `既に書いたテーマ（重ならないようにする）: ${st.topics.join(" / ")}` : ""
    );
  } else if (ch?.strategy) {
    lines.push("", "# 媒体の方針（これから始める）", `コンセプト: ${ch.strategy.concept}`, ch.strategy.categories.length ? `カテゴリ: ${ch.strategy.categories.map((c) => c.name).join(" / ")}` : "");
  }
  if (project.url) lines.push(kind === "note" ? `記事の最後に案内する自社サイト: ${project.url}` : "");
  return lines.filter((l) => l !== "");
}

export async function draftArticle(
  kind: AioChannelKind,
  project: AioProject,
  ch: AioChannel | null,
  ctx: { brief?: ArticleBrief | null; recentTitles: string[]; latestCheck: AioCheck | null; queries: AioMetric["queries"] }
): Promise<DraftedArticle> {
  const b = ctx.brief ?? {};
  const lines = [
    "# 事業の前提",
    `事業者名: ${project.name}`,
    project.aliases.length ? `サービス名・別名: ${project.aliases.join(", ")}` : "",
    project.url ? `URL: ${project.url}` : "",
    `見込み客の探し方: ${project.area ? `${project.area}で` : ""}${project.category}`,
    project.notes ? `事業内容・強み（事業者の説明）: ${project.notes.slice(0, 1500)}` : "",
    project.siteSummary ? `Webサイトの見出し: ${project.siteSummary}` : "",
    "",
    ...channelGuide(kind, ch, project),
    ctx.recentTitles.length ? `\nこの画面で最近作った記事（重ならないようにする）: ${ctx.recentTitles.slice(0, 15).join(" / ")}` : "",
    ctx.queries.length ? `\n検索で実際に表示されている語（Search Console）: ${ctx.queries.slice(0, 15).map((q) => `${q.query}（表示${q.impressions}・順位${q.position}）`).join(" / ")}` : "",
    ctx.latestCheck ? `\nAI に聞いたときに挙がった事業者: ${ctx.latestCheck.listed.slice(0, 8).join(" / ") || "（なし）"}。自社は${ctx.latestCheck.mentioned ? `${ctx.latestCheck.rank}番目` : "挙がらなかった"}` : "",
    "",
    "# 今回の記事",
    b.title ? `タイトル案: ${b.title}` : "タイトル: 媒体のトンマナと見込み客の問いから決める",
    b.target ? `答える問い・狙う語: ${b.target}` : "",
    b.outline ? `構成の指示: ${b.outline}` : "",
    b.note ? `書き手からの指示: ${b.note}` : "",
  ].filter((l) => l !== "");

  const res = await askJson<{
    title?: string;
    slug?: string;
    metaDescription?: string;
    keywords?: unknown[];
    target?: string;
    body?: string;
    hashtags?: unknown[];
    images?: { role?: string; afterH2?: number | null; prompt?: string; alt?: string }[];
  }>(SYSTEM, lines.join("\n"), { maxTokens: 10000, timeoutMs: 170_000 });

  const n = (v: unknown, max: number) => normalizeJapanese(String(v ?? "").trim()).slice(0, max);
  const bodyMd = normalizeJapanese(String(res.body ?? "").trim()).replace(/^#\s+.+\n+/, "");
  if (bodyChars(bodyMd) < 500) throw new Error("記事を書けませんでした。事業内容（対象の設定）を足してもう一度お試しください");
  const title = n(res.title, 120) || b.title || "（無題）";
  const h2n = h2List(bodyMd).length;

  // 画像は、アイキャッチ1枚＋本文中最大2枚に整える（AI の出力の数・位置をそのまま信じない）
  const raw = Array.isArray(res.images) ? res.images : [];
  const eye = raw.find((i) => i?.role === "eyecatch" && i.prompt) ?? raw.find((i) => i?.prompt);
  const inl = raw.filter((i) => i !== eye && i?.prompt).slice(0, MAX_INLINE_IMAGES);
  const usedAt = new Set<number>();
  const images: AioArticleImage[] = [];
  if (eye) images.push({ key: "eyecatch", role: "eyecatch", afterH2: null, prompt: String(eye.prompt).slice(0, 800), alt: n(eye.alt, 60) || title.slice(0, 40), path: null });
  inl.forEach((i, k) => {
    let at = typeof i.afterH2 === "number" && i.afterH2 >= 0 && i.afterH2 < h2n ? Math.floor(i.afterH2) : Math.min(h2n - 1, k * 2 + 1);
    while (usedAt.has(at) && at < h2n - 1) at++;
    if (at < 0 || usedAt.has(at)) return;
    usedAt.add(at);
    images.push({ key: `inline${k + 1}`, role: "inline", afterH2: at, prompt: String(i.prompt).slice(0, 800), alt: n(i.alt, 60), path: null });
  });

  const slug = String(res.slug ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  const metaDescription = n(res.metaDescription, 160);
  return {
    title,
    slug,
    metaDescription,
    keywords: (Array.isArray(res.keywords) ? res.keywords : []).map((k) => n(k, 40)).filter(Boolean).slice(0, 6),
    target: n(res.target, 120) || b.target || "",
    bodyMd,
    hashtags: kind === "note" ? (Array.isArray(res.hashtags) ? res.hashtags : []).map((h) => n(h, 30).replace(/^#/, "")).filter(Boolean).slice(0, 5) : [],
    images,
  };
}

/** 法令チェック（記事を保存した直後に、画像づくりと同じ工程で必ず通す。通るまで公開できない） */
export function guardArticle(a: { title: string; metaDescription: string; bodyMd: string }, industry: AioProject["industry"]): Promise<GuardVerdict> {
  return checkGuard([a.title, a.metaDescription, a.bodyMd.slice(0, 9000)], industry);
}
