import { askJson, MODEL_FAST } from "../anthropic";
import { checkGuard } from "../guardrail";
import { normalizeJapanese } from "../meo-ops/japanese";
import { fetchSiteSummary } from "../meo-ops/writer";
import type { GuardVerdict } from "../types";
import { AIO_DRAFT_KINDS, type AioCheck, type AioDraftKind, type AioProject } from "./types";

/**
 * AIO の「何をすべきか」＝ AI に拾われるための下書きを作る。
 * 他社の AIO サービスが売っている施策（自社サイト記事・note・プレスリリース・FAQ/構造化データ・媒体登録）を
 * ここで AI が全部下書きし、人が確認してコピーして使う。
 * どの下書きも生成と同時に法令チェックを通す（AGENTS.md）。数字・実績は与えられたものだけ。
 */

const JA_ONLY_RULE = "- 日本語の文章で通常使う漢字（常用漢字・日本の新字体）だけで書く。中国語の簡体字・繁体字は使わない";

const SETUP_SYSTEM = `あなたは日本の事業者の AI検索対策（AIO/GEO）コンサルタントです。
Webサイトの内容から、AI に「おすすめを教えて」と聞かれたときにこの事業者が候補に挙がるべき「探し方」を考えます。

出力: {"name":"事業者名（サイトの表記のまま。会社形態は省いてよい）","aliases":["サービス名・ブランド名・略称（最大4つ）"],"category":"ユーザーがAIに聞くときの言い方（例：法人向けの経費精算システム、渋谷のパーソナルジム）","area":"地域に依存するなら市区町村名。全国・オンラインなら空文字","industry":"beauty|medical|supplement|finance|general","reason":"そう考えた根拠（60字以内）"}

- category は、見込み客が自分の課題を AI に相談するときの言葉にする（業界用語や自社の商品名にしない）
${JA_ONLY_RULE}`;

export async function suggestProjectFacts(url: string, notes: string): Promise<{ name: string; aliases: string[]; category: string; area: string; industry: AioProject["industry"]; siteSummary: string }> {
  const site = await fetchSiteSummary(url);
  const lines = [`URL: ${url}`, site ? `Webサイトの内容: ${site}` : "（サイトを読めませんでした）", notes.trim() ? `事業者の説明: ${notes.trim().slice(0, 800)}` : ""].filter(Boolean);
  const res = await askJson<{ name?: string; aliases?: unknown; category?: string; area?: string; industry?: string }>(SETUP_SYSTEM, lines.join("\n"), { model: MODEL_FAST, maxTokens: 500, timeoutMs: 40_000 });
  const industries = ["beauty", "medical", "supplement", "finance", "general"] as const;
  const ind = industries.includes(res.industry as (typeof industries)[number]) ? (res.industry as AioProject["industry"]) : "general";
  return {
    name: normalizeJapanese(String(res.name ?? "").trim()).slice(0, 120),
    aliases: (Array.isArray(res.aliases) ? res.aliases : []).map((a) => normalizeJapanese(String(a ?? "").trim())).filter(Boolean).slice(0, 4),
    category: normalizeJapanese(String(res.category ?? "").trim()).slice(0, 100),
    area: normalizeJapanese(String(res.area ?? "").trim()).slice(0, 60),
    industry: ind,
    siteSummary: site,
  };
}

const KIND_INSTRUCTION: Record<AioDraftKind, string> = {
  site_article: `自社サイトに載せる解説記事（2000〜3000字）。
- タイトルは「{探し方}の選び方」「{探し方}で失敗しないための〇つの基準」のように、見込み客の検索語を含める
- 見出し（##）を5〜7個。最初の段落に結論。各見出しの直下に短い要約文を置く（AIが抜き出しやすい）
- 自社の紹介は1節だけ。他社比較で他社を貶めない
- 数字・実績・事例は「事業の前提」にあるものだけ。無ければ書かない（「〇〇」の穴埋めも作らない）
- 最後に「よくある質問」を3問`,
  note_article: `note に出す読み物（1500〜2500字）。
- 一人称（私たち）で、なぜこの事業をしているか・現場で見てきたことを書く
- タイトルは体験や気づきが伝わるもの（宣伝色を出さない）
- 事業者名・サービス名・地域名を本文中に自然に3回以上入れる（AIが固有名詞で拾えるように）
- 数字・実績は「事業の前提」にあるものだけ。無ければ書かない`,
  press_release: `プレスリリース（PR TIMES の体裁。800〜1200字）。
- 1行目はタイトル（何を・誰が・いつ）。次にリード文（3行）。本文は「背景」「内容」「今後」の順
- 末尾に「会社概要」の枠（会社名・所在地・代表・URL。わからない項目は「（記入）」と書く）
- 発表できる事実が「事業の前提」に無ければ、「新サービスの提供開始」ではなく「調査結果」「取り組み」など事実ベースの切り口を選ぶ
- 数字は「事業の前提」にあるものだけ`,
  faq_schema: `サイトに置く FAQ（5問）と、その schema.org FAQPage の JSON-LD。
- 質問は見込み客が AI に聞きそうな言葉で（「{探し方}はいくらかかる？」「〇〇との違いは？」など）
- 回答は各120字以内で、最初の一文で結論
- 本文の構成: まず FAQ を「Q. / A.」で5問 → 空行 → \`\`\`json のコードブロックで FAQPage の JSON-LD（mainEntity に5問）
- 価格・数字は「事業の前提」にあるものだけ。無ければ「要相談」「お問い合わせ」とする`,
  survey_article: `アンケート記事の設計と型。ファクト（調査結果）を先に作り、それを根拠に記事を書く手法。
- 本文の構成: 「1. 調査の設計」（目的・対象・人数の目安・設問8〜10問。選択肢つき）→「2. プレスリリース／記事の型」（タイトル案3つ。本文は結果の数字が入る箇所を【結果：〇〇%】のように空欄にした完成形）→「3. 記事から自社サービスへのつなげ方」（結果→課題→自社の提供価値、の順。断定しない）
- **調査結果の数字を作らない**。必ず空欄にする
- 設問は見込み客の課題が数字で出るものにする（時間・頻度・困りごと・選ぶ基準）`,
  wantedly_story: `Wantedly のストーリー（採用向け。1500〜2500字）。
- 働く人・仕事内容・カルチャーが伝わる記事。一人称または社員インタビュー形式
- タイトルは求職者が検索しそうな言葉（職種・働き方・成長）を含める
- 「事業の前提」にある事実だけを使う。社員名・数字・制度は与えられていなければ【要確認】と書く
- 最後に「こんな人に会いたい」を3つ`,
  job_posting_schema: `採用サイト向けの構造化データと、ファクトの見出し化指示。
- 本文の構成: 「1. 採用ページに置くファクトの見出し（募集要項・制度・働き方を見出し＋箇条書きで）」→「2. JSON-LD」を \`\`\`json のコードブロックで Organization・JobPosting（1職種分の雛形）・FAQPage（採用の質問5問）
- 給与・勤務地・雇用形態など与えられていない項目は "【要記入】" の文字列にする（勝手に埋めない）
- JobPosting は Google の求人構造化データの必須項目（title, description, datePosted, hiringOrganization, jobLocation）を揃える`,
  listing_memo: `AI が根拠にしている媒体への掲載を整理するメモ（箇条書き中心）。
- 「実測で AI が引用した媒体」ごとに、自社が載っているか（own_source_domains にあれば載っている）、載っていなければ登録・掲載の手順を1〜3行で
- Wikipedia は「特筆性（第三者の信頼できる情報源での言及）が要る。自社で書かない」ことを明記する
- Googleビジネスプロフィール・各業界ポータル・比較サイト・ニュース媒体（プレスリリース配信）の順に、やる順番を提案する
- 数字・効果の断定はしない`,
};

const DRAFT_SYSTEM = `あなたは日本の事業者の AI検索対策（AIO/GEO）の編集者です。
AI（ChatGPT・Gemini・Perplexity・Google AI Overviews）が回答の根拠として引用しやすい文章を作ります。

全体のルール:
- 事実を創作しない。与えられていない数字・実績・受賞・顧客名・価格を書かない
- 「必ず」「絶対」「No.1」「最高」「業界初」「唯一」など、根拠の要る断定・最上級の表現は使わない
- 医療・美容・健康食品・金融に関わる効果効能の断定をしない
- 固有名詞（事業者名・サービス名・地域名）は略さず正確に書く
- 文章は Markdown。本文だけを body に入れる（前置き・解説を付けない）
${JA_ONLY_RULE}

出力: {"title":"タイトル","body":"本文（Markdown）"}`;

export async function draftAioContent(
  kind: AioDraftKind,
  project: AioProject,
  latest: AioCheck | null,
  brief?: { title: string; target: string; outline: string } | null
): Promise<{ title: string; body: string; guard: GuardVerdict }> {
  const def = AIO_DRAFT_KINDS.find((k) => k.kind === kind);
  if (!def) throw new Error("未対応の下書きです");
  const seen = latest
    ? [
        `AIの回答に自社が挙がったか: ${latest.mentioned ? `挙がった（${latest.rank}番目）` : "挙がらなかった"}`,
        latest.listed.length ? `AIが挙げた事業者（順番どおり）: ${latest.listed.slice(0, 10).join(" / ")}` : "",
        latest.citedSources.length ? `AIが根拠にした媒体: ${[...new Set(latest.citedSources.map((c) => c.domain).filter(Boolean))].slice(0, 15).join(", ")}` : "",
        latest.ownSourceDomains.length ? `自社の根拠として引用された媒体: ${latest.ownSourceDomains.join(", ")}` : "",
      ].filter(Boolean)
    : ["（まだ実測していない）"];

  const lines = [
    "# 作るもの",
    `${def.label}: ${KIND_INSTRUCTION[kind].replace(/\{探し方\}/g, project.category || "サービス")}`,
    "",
    "# 事業の前提",
    `事業者名: ${project.name}`,
    project.aliases.length ? `サービス名・別名: ${project.aliases.join(", ")}` : "",
    project.url ? `URL: ${project.url}` : "",
    `AIに聞くときの探し方: ${project.area ? `${project.area}で` : ""}${project.category}`,
    project.notes ? `事業内容・強み（事業者の説明）: ${project.notes.slice(0, 1500)}` : "",
    project.siteSummary ? `Webサイトの見出し: ${project.siteSummary}` : "",
    "",
    "# いまの見え方（実測）",
    ...seen,
    ...(brief ? ["", "# 月次計画で決めた内容（これに沿って書く）", `タイトル: ${brief.title}`, `答える問い: ${brief.target}`, `構成: ${brief.outline}`] : []),
  ].filter((l) => l !== "");

  const res = await askJson<{ title?: string; body?: string }>(DRAFT_SYSTEM, lines.join("\n"), { maxTokens: 6000, timeoutMs: 150_000 });
  const title = normalizeJapanese(String(res.title ?? "").trim()).slice(0, 200) || def.label;
  const body = normalizeJapanese(String(res.body ?? "").trim());
  if (!body) throw new Error("下書きを作れませんでした。事業内容を入れてもう一度お試しください");
  // 長文は辞書＋AI の両方で見る（生成と同時）。JSON-LD のコードはそのまま通す
  const guard = await checkGuard([body.slice(0, 6000)], project.industry);
  return { title, body, guard };
}
