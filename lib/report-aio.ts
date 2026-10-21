import { askJson } from "./anthropic";
import { GEMINI_MODEL, hasGemini } from "./gemini";
import { askGemini, domainOf, findOwnRank } from "./meo-ops/ai-search";
import { guessAreaFromAddress } from "./meo-ops/logic";
import { normalizeJapanese } from "./meo-ops/japanese";
import type { Diagnosis } from "./types";
import type { SiteScan } from "./site-scan";
import type { MeoScan } from "./meo";
import { scoreAio, type AioMeasure, type AioPromptResult, type ReportAio } from "./report-aio-types";

export { scoreAio, type AioMeasure, type AioPromptResult, type ReportAio };

/**
 * URLレポートの「AIO（AI検索での見え方）」（2026-10-21 新設）。
 *
 * 店舗の AI検索（lib/meo-ops/ai-search.ts）と同じやり方で、見込み客が打ちそうな問いを実際に
 * Gemini（Google検索つき）へ投げ、回答に自社の会社名・サービス名が候補として出るか、自社サイトが
 * 引用元に入るかを測る。順位の判定は AI にさせず findOwnRank で機械的に行う。
 * 「この施策をすればAIに出る」という因果は主張しない（実測の結果と、引用されやすくするための一般的な施策だけを出す）。
 *
 * 工程は3段階で、それぞれ終わった時点で保存する（lib/analysis.ts）。済んだ段階・測り終えた問いはやり直さない。
 *   1. 問いを作る（AI 1回。安いモデル）
 *   2. 問いごとに Gemini で実測（Promise.allSettled。1問終わるたびに保存）
 *   3. 結果から施策を書く（AI 1回）
 * Gemini が使えないときは測らない（Claude の web 検索は費用が約10倍のため、レポートでは使わない）。
 */

export const AIO_PROMPT_COUNT = 3;
const MEASURE_BUDGET_MS = 170_000;
const MAX_CITED = 20;

export function aioSkipped(reason: string): ReportAio {
  return { stage: "done", createdAt: new Date().toISOString(), skipped: reason, engine: "gemini", ownNames: [], ownDomain: "", prompts: [] };
}

/** 自社として照合する名前。ブランド名・読み・サイトの事業所名・Googleマップの店名 */
export function ownNamesOf(d: Diagnosis, site: SiteScan | null, meo: MeoScan | null): string[] {
  const names = [d.brand?.name, d.brand?.kana, site?.bizName, meo?.self?.name].map((x) => String(x ?? "").trim()).filter(Boolean);
  return [...new Set(names)].slice(0, 6);
}

const PROMPT_SYSTEM = `あなたは日本の企業の AI検索対策（AIO/GEO）コンサルタントです。
見込み客が ChatGPT や Gemini に実際に入力しそうな「問い」を3本作ります。
AI に推薦されるかは「どんな問いに答えられるか」で決まるので、問いには自社名・サービス名を入れず、見込み客の目的・課題の言葉で書きます。

- recommend（おすすめ型）:「〇〇でおすすめの会社（サービス）を教えて」
- issue（課題型）:「〇〇に困っている。解決できるサービスは？」
- select（選定・比較型）:「〇〇を選ぶならどこがいい？比較したい」
- 地域に依存する事業（店舗・来店型・地域の業者）なら地域名を入れる。全国向けなら入れない
- 実際に人が打ちそうな自然な日本語の一文（20〜50字）。業界の一般的な呼び方を使う
- 3本それぞれ切り口（用途・対象者・予算など）を変える

出力: {"prompts":[{"kind":"recommend","text":"問い"},{"kind":"issue","text":"問い"},{"kind":"select","text":"問い"}]}`;

/** 診断結果から実測に使う問いを作る（AI 1回） */
export async function buildAioPrompts(d: Diagnosis, site: SiteScan | null, meo: MeoScan | null): Promise<ReportAio> {
  if (!hasGemini()) return aioSkipped("AI検索の実測に使う Gemini が設定されていないため、測っていません");
  const area = guessAreaFromAddress(meo?.self?.address ?? site?.bizAddress ?? null);
  const user = [
    `何を売っているか: ${d.product}`,
    `誰に売るか: ${d.audience}`,
    `業種: ${d.industry}`,
    d.strengths?.length ? `強み: ${d.strengths.slice(0, 4).join("／")}` : "",
    area ? `所在地の市区町村: ${area}` : "",
    site?.title ? `サイトのタイトル: ${site.title}` : "",
    `（自社名「${d.brand?.name ?? ""}」は問いに入れない）`,
  ].filter(Boolean).join("\n");
  const res = await askJson<{ prompts?: { kind?: string; text?: string }[] }>(PROMPT_SYSTEM, user, { maxTokens: 800, timeoutMs: 60_000 });
  const own = ownNamesOf(d, site, meo);
  const kinds: AioPromptResult["kind"][] = ["recommend", "issue", "select"];
  const prompts: AioPromptResult[] = [];
  for (const p of res.prompts ?? []) {
    let text = normalizeJapanese(String(p.text ?? "").trim()).slice(0, 120);
    // 問いに自社名が入っていると「出て当然」になるので外す
    if (!text || own.some((n) => n.length >= 2 && text.includes(n))) continue;
    if (prompts.some((x) => x.text === text)) continue;
    const kind = kinds.includes(p.kind as AioPromptResult["kind"]) ? (p.kind as AioPromptResult["kind"]) : "recommend";
    // 候補と情報源を挙げてもらう形にそろえる（店舗のAI検索と同じ）
    if (!/URL|情報源/.test(text)) text = `${text}${/[。？?！!]$/.test(text) ? "" : "？"}候補を5〜8件、情報源（URL）つきで教えてください。`;
    prompts.push({ text, kind, status: "pending" });
    if (prompts.length >= AIO_PROMPT_COUNT) break;
  }
  if (!prompts.length) throw new Error("AIOの問いを作れませんでした");
  return {
    stage: "prompts",
    createdAt: new Date().toISOString(),
    skipped: null,
    engine: "gemini",
    ownNames: own,
    ownDomain: site?.finalUrl ? domainOf(site.finalUrl) : domainOf(d.url),
    prompts,
  };
}

const EXTRACT_SYSTEM = `あなたはAIの回答テキストから、候補として挙げられた会社・サービス・店舗の名前を抽出する処理系です。
- 回答に出てくる順番のまま並べる（順番が掲載順位になる）
- 候補として挙げられていないもの（媒体名・比較サイト名・注意書き・一般名詞）は入れない
- 名前は回答の表記をそのまま使い、要約・翻訳・正規化をしない
出力: {"names":["名前"]}`;

async function extractNames(answer: string): Promise<string[]> {
  const r = await askJson<{ names?: unknown[] }>(EXTRACT_SYSTEM, `# AIの回答\n${answer.slice(0, 12000)}`, { maxTokens: 1500, timeoutMs: 60_000 });
  return (r.names ?? []).map((n) => String(n ?? "").trim().slice(0, 200)).filter(Boolean).slice(0, 20);
}

const isOwnDomain = (domain: string, own: string) => !!own && !!domain && (domain === own || domain.endsWith(`.${own}`) || own.endsWith(`.${domain}`));

/** 問い1本を Gemini で実測する。失敗しても例外にせず error として返す */
export async function measureAioPrompt(p: AioPromptResult, aio: Pick<ReportAio, "ownNames" | "ownDomain">, deadline: number): Promise<AioPromptResult> {
  try {
    const r = await askGemini(p.text, deadline);
    const listed = await extractNames(r.text);
    const cited = r.cited.slice(0, MAX_CITED);
    return {
      ...p,
      status: "ok",
      error: undefined,
      listed,
      rank: findOwnRank(listed, aio.ownNames),
      cited,
      ownCited: cited.some((c) => isOwnDomain(c.domain, aio.ownDomain)),
      queries: r.queries.slice(0, 10),
      answer: r.text.slice(0, 6000),
      model: r.model || GEMINI_MODEL,
      at: new Date().toISOString(),
    };
  } catch (e) {
    return { ...p, status: "error", error: (e instanceof Error ? e.message : String(e)).slice(0, 300), at: new Date().toISOString() };
  }
}

/** 実測の予算。呼び出し元の残り時間を超えない */
export function aioDeadline(outer: number): number {
  return Math.min(outer - 20_000, Date.now() + MEASURE_BUDGET_MS);
}

/** 引用元として多く使われたドメイン（自社以外） */
export function topCitedDomains(aio: ReportAio, limit = 8): { domain: string; count: number }[] {
  const m = new Map<string, number>();
  for (const p of aio.prompts) for (const c of p.cited ?? []) if (c.domain && !isOwnDomain(c.domain, aio.ownDomain)) m.set(c.domain, (m.get(c.domain) ?? 0) + 1);
  return [...m.entries()].map(([domain, count]) => ({ domain, count })).sort((a, b) => b.count - a.count).slice(0, limit);
}

const MEASURE_SYSTEM = `あなたは日本の企業の AI検索対策（AIO/GEO/LLMO）コンサルタントです。
実際に Gemini（Google検索つき）へ見込み客の問いを投げた結果を見て、所見と「AIに候補として挙げられ・引用されやすくする施策」を書きます。

施策の考え方（当てはまるものだけ使う）:
- AIは検索結果の上位ページや比較・まとめ記事を引用して答える。引用元に多いサイト（比較サイト・業界メディア・ポータル）への掲載や情報更新を狙う
- 問いにそのまま答える自社ページ（〇〇とは／選び方／料金／よくある質問）を作り、冒頭に結論を短く書く
- 数字（実績件数・創業年・対応エリア・料金）を出所つきで載せる。第三者の評価や事例を引用の形で載せる
- 会社名・サービス名・所在地・連絡先の表記を、自社サイト・Googleビジネスプロフィール・SNS・外部掲載でそろえる
- schema.org の構造化データ（Organization・LocalBusiness・Service・FAQPage など）を入れる
- プレスリリース・取材・寄稿など、第三者のサイトで社名とサービス内容が言及される機会を作る

ルール:
- 与えたデータ（実測結果・サイトの状態）に無い事実や数字を作らない。自社がやっていない前提で断定しない
- 「必ず表示される」「No.1」「確実に」など、効果や順位を約束する表現を使わない。AIの回答は問いや時期で変わる前提で書く
- findings は2〜4件（実測で分かったこと。候補に出た／出ない、引用元の傾向）
- measures は3〜5件。impact は 大/中/小。steps は2〜4個の具体的な手順
- 日本語の文章で通常使う漢字だけで書く

出力: {"findings":["所見"],"measures":[{"title":"施策（40字以内）","why":"なぜ効くと考えるか（実測結果のどこから言えるか。120字以内）","steps":["手順"],"impact":"大"}]}`;

/** 実測結果から所見と施策を書く（AI 1回）。失敗しても実測結果は残す */
export async function analyzeAio(aio: ReportAio, d: Diagnosis, site: SiteScan | null): Promise<ReportAio> {
  const { score, basis } = scoreAio(aio);
  const ok = aio.prompts.filter((p) => p.status === "ok");
  if (!ok.length) return { ...aio, stage: "done", score, basis, findings: [], measures: [] };
  const lines = [
    `# 自社`,
    `名前: ${aio.ownNames.join("／")}`,
    `サイト: ${aio.ownDomain}`,
    `何を売っているか: ${d.product}`,
    `誰に売るか: ${d.audience}`,
    `# サイトの状態（読み取り結果）`,
    `構造化データ（JSON-LD）: ${site ? (site.structuredData ? "あり" : "なし") : "不明"}`,
    `サイトマップ: ${site ? (site.sitemapXml ? "あり" : "なし") : "不明"}`,
    `# 実測（Gemini・Google検索つき）`,
    ...ok.map((p, i) =>
      [
        `## 問い${i + 1}: ${p.text}`,
        `候補に挙がった名前: ${(p.listed ?? []).join("、") || "（抽出できず）"}`,
        `自社: ${p.rank != null ? `${p.rank}番目に挙がった` : "挙がらなかった"}／自社サイトの引用: ${p.ownCited ? "あり" : "なし"}`,
        `引用元: ${(p.cited ?? []).map((c) => c.domain).filter(Boolean).slice(0, 10).join("、") || "なし"}`,
      ].join("\n")
    ),
    `# 引用元に多いサイト（自社以外）`,
    topCitedDomains(aio).map((x) => `${x.domain}（${x.count}回）`).join("、") || "なし",
  ];
  try {
    const r = await askJson<{ findings?: unknown[]; measures?: { title?: string; why?: string; steps?: unknown[]; impact?: string }[] }>(
      MEASURE_SYSTEM,
      lines.join("\n"),
      { maxTokens: 3000, timeoutMs: 120_000 }
    );
    const ng = /必ず|確実に|No\.?1|ナンバーワン|絶対/;
    const findings = (r.findings ?? []).map((f) => normalizeJapanese(String(f ?? "").trim())).filter((f) => f && !ng.test(f)).slice(0, 4);
    const measures: AioMeasure[] = (r.measures ?? [])
      .map((m) => ({
        title: normalizeJapanese(String(m.title ?? "").trim()).slice(0, 80),
        why: normalizeJapanese(String(m.why ?? "").trim()).slice(0, 240),
        steps: (Array.isArray(m.steps) ? m.steps : []).map((s) => normalizeJapanese(String(s ?? "").trim())).filter(Boolean).slice(0, 4),
        impact: (["大", "中", "小"].includes(String(m.impact)) ? m.impact : "中") as AioMeasure["impact"],
      }))
      .filter((m) => m.title && !ng.test(`${m.title}${m.why}`))
      .slice(0, 5);
    return { ...aio, stage: "done", score, basis, findings, measures, analysisError: null };
  } catch (e) {
    return { ...aio, stage: "done", score, basis, findings: [], measures: [], analysisError: (e instanceof Error ? e.message : String(e)).slice(0, 300) };
  }
}
