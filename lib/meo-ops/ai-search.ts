import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askJson, MODEL_FAST } from "../anthropic";
import { checkGuardDict } from "../guardrail";
import type { Industry } from "../types";
import { jstDateKey, jstPeriodKey } from "./daily";
import { buildAiSearchPrompt, guessAreaFromAddress } from "./logic";
import type { MeoStoreSnapshot } from "./types";

/**
 * AI検索での見え方の実測（本体 app/services/ai_search/* の移植）。
 *
 * 「この施策をすればAIに出る」という因果は主張せず、実際にAIへ問い合わせた結果だけを残す。
 * 本体は Gemini を既定にして Claude を代替にしているが、この環境には Gemini のキーが無いので
 * Claude（Messages API ＋ Anthropic の web 検索）で実測する。どの AI で測ったかは1件ごとに残す。
 */

/** 1か月（JST）に実行できる回数。1回ごとに web 検索つきの AI 呼び出しが走って実費が出る */
export const AI_SEARCH_MONTHLY_LIMIT = 5;
/** 集計に使う直近の件数 */
const MAX_HISTORY = 24;
const MAX_CITED_SOURCES = 30;

const ANSWER_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
/** 検索回数の上限。ここを緩めると入力トークン（＝費用）がそのまま跳ねる */
const MAX_SEARCHES = 3;
/** pause_turn で続きを投げる回数の上限 */
const MAX_TURNS = 4;
/** 実測に使ってよい合計時間。関数ごと切られて running のまま残らないよう、手前で自分から失敗させる */
const MEASURE_BUDGET_MS = 200_000;

// ── 媒体マスタと掲載状況（sources.py） ─────────────────
type SourceDef = { key: string; name: string; referencedBy: string; domains: string[]; registerUrl: string | null };

/** 日本のローカル検索で AI の引用元になりやすい媒体。対応は観測に基づく目安 */
const SOURCES: SourceDef[] = [
  { key: "gbp", name: "Googleビジネスプロフィール", referencedBy: "Google AI Overviews・AI Mode", domains: ["google.com", "google.co.jp", "g.co", "goo.gl"], registerUrl: "https://business.google.com/" },
  { key: "hotpepper", name: "ホットペッパー", referencedBy: "ChatGPT・Perplexity", domains: ["hotpepper.jp"], registerUrl: "https://www.hotpepper.jp/" },
  { key: "ekiten", name: "エキテン", referencedBy: "ChatGPT・Perplexity", domains: ["ekiten.jp"], registerUrl: "https://www.ekiten.jp/" },
  { key: "bing_places", name: "Bing Places", referencedBy: "ChatGPT・Copilot", domains: ["bing.com", "bingplaces.com"], registerUrl: "https://www.bingplaces.com/" },
  { key: "apple_business", name: "Apple Business Connect", referencedBy: "Apple Maps・Siri", domains: ["apple.com"], registerUrl: "https://businessconnect.apple.com/" },
  { key: "tabelog", name: "食べログ", referencedBy: "ChatGPT・Perplexity", domains: ["tabelog.com"], registerUrl: "https://owner.tabelog.com/" },
  { key: "retty", name: "Retty", referencedBy: "ChatGPT", domains: ["retty.me"], registerUrl: null },
  { key: "yahoo_loco", name: "Yahoo!ロコ", referencedBy: "Yahoo!検索", domains: ["loco.yahoo.co.jp"], registerUrl: null },
];

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function findSource(domain: string): SourceDef | null {
  if (!domain) return null;
  return SOURCES.find((s) => s.domains.some((d) => domain === d || domain.endsWith(`.${d}`))) ?? null;
}

/**
 * 引用実績から媒体ごとの掲載状況を組み立てる。
 * 自店舗の根拠として引用 → 掲載あり／引用はされたが自店の根拠ではない → 掲載を確認できず／一度も引用なし → 未確認
 */
function buildCoverage(citedDomains: string[], ownDomains: string[]) {
  const ownKeys = new Set(ownDomains.map((d) => findSource(d)?.key).filter(Boolean) as string[]);
  const counts = new Map<string, number>();
  for (const d of citedDomains) {
    const s = findSource(d);
    if (s) counts.set(s.key, (counts.get(s.key) ?? 0) + 1);
  }
  const statusOrder = { listed: 0, not_found: 1, unknown: 2 } as const;
  return SOURCES.map((s, i) => {
    const count = counts.get(s.key) ?? 0;
    const status: keyof typeof statusOrder = ownKeys.has(s.key) ? "listed" : count > 0 ? "not_found" : "unknown";
    return { key: s.key, name: s.name, referenced_by: s.referencedBy, citation_count: count, status, register_url: s.registerUrl, order: i };
  })
    .sort((a, b) => statusOrder[a.status] - statusOrder[b.status] || b.citation_count - a.citation_count || a.order - b.order)
    .map(({ order: _o, ...rest }) => rest);
}

// ── 自店舗の判定（matching.py） ─────────────────────
const NOISE = /[\s\-‐‑–—ー・\/／|｜()（）[\]「」『』"'’、。．,.!！?？&＆]/g;
/** 部分一致で自店舗とみなす最小の長さ。短い一般語は別店舗にも含まれるため */
const MIN_PARTIAL = 5;

function normalizeName(name: string): string {
  return name.normalize("NFKC").replace(NOISE, "").toLowerCase();
}

/** 自店舗が何番目に挙がったか（1始まり）。挙がっていなければ null。AI には判定させない */
export function findOwnRank(listed: string[], ownNames: string[]): number | null {
  const own = ownNames.filter((n) => n.trim()).map(normalizeName).filter(Boolean);
  if (!own.length) return null;
  for (let i = 0; i < listed.length; i++) {
    const l = normalizeName(listed[i]);
    if (!l) continue;
    const hit = own.some((o) => l === o || (Math.min(l.length, o.length) >= MIN_PARTIAL && (l.includes(o) || o.includes(l))));
    if (hit) return i + 1;
  }
  return null;
}

// ── プロンプト（prompt.py） ─────────────────────────
const EXTRACT_SYSTEM = `あなたはAIの回答テキストから店舗名を抽出する処理系です。
次のJSONのみを出力してください（前後に説明を書かない）。

{
  "stores": [
    {
      "name": "店舗名（回答に書かれた表記のまま）",
      "source_urls": ["その店舗の根拠として挙げられたURL"]
    }
  ]
}

- stores は回答に出てくる順番のまま並べる（順番が掲載順位になる）
- 店舗として挙げられていないもの（媒体名・エリア名・注意書き）は入れない
- 名前は回答の表記をそのまま使い、要約・翻訳・正規化をしない
- 根拠URLが書かれていない店舗は source_urls を空配列にする`;

const SUGGEST_SYSTEM = `あなたは日本の店舗のAI検索対策（AIO/GEO）コンサルタントです。
AIに引用されやすい文面を作ります。次のJSONのみを出力してください（前後に説明を書かない）。

{
  "suggestions": [
    {
      "technique": "statistics|quotation|cite_sources",
      "target": "gbp_description|gbp_post|site_schema",
      "title": "何をするかの見出し（40字以内）",
      "body": "そのまま貼れる本文（300字以内）",
      "source_note": "本文で使った数字の出所（100字以内）"
    }
  ]
}

- suggestions はちょうど3件。technique は statistics / quotation / cite_sources を1件ずつ使う
- **数字は与えられたデータにあるものだけを使う。無い数字を書かない**
- quotation はクチコミの一文をそのまま引用する（言い換えない）。引用が無ければ数字の提示に切り替える
- site_schema の body は schema.org の JSON-LD を1行で書く
- source_note には「Googleビジネスプロフィールのクチコミ218件」のように出所と件数を書く
- 「No.1」「必ず」「最高」など、根拠の要る最上級・断定の表現は使わない`;

// ── 月次上限と既定値 ──────────────────────────────
export async function quota(sb: SupabaseClient, analysisId: string) {
  const period = jstPeriodKey();
  const { count } = await sb
    .from("ai_search_checks")
    .select("id", { count: "exact", head: true })
    .eq("analysis_id", analysisId)
    .eq("period", period);
  const used = count ?? 0;
  return { period, limit: AI_SEARCH_MONTHLY_LIMIT, used, remaining: Math.max(0, AI_SEARCH_MONTHLY_LIMIT - used) };
}

export function defaultQuery(store: MeoStoreSnapshot | null, fallbackAddress: string | null) {
  return {
    area: guessAreaFromAddress(store?.address ?? fallbackAddress),
    category: store?.category ?? "",
  };
}

export async function createCheck(sb: SupabaseClient, analysisId: string, area: string, category: string) {
  const q = await quota(sb, analysisId);
  if (q.remaining <= 0) throw new Error(`AI検索は 1 か月に ${q.limit} 回までです。翌月まではお待ちください。`);
  const { data, error } = await sb
    .from("ai_search_checks")
    .insert({
      analysis_id: analysisId,
      status: "pending",
      engine: "claude",
      model: ANSWER_MODEL,
      query_area: area,
      query_category: category,
      prompt: buildAiSearchPrompt(area, category),
      period: q.period,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error("AI検索の実行を開始できませんでした");
  return { checkId: data.id as string, remaining: Math.max(0, q.remaining - 1) };
}

// ── 実測（claude_searcher.py） ──────────────────────
type Block = { type: string; [k: string]: unknown };

function client() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

/** 定型の質問を web 検索つきで投げ、回答全文・引用元・検索語を返す */
async function ask(question: string, deadline: number) {
  const messages: { role: "user" | "assistant"; content: unknown }[] = [
    { role: "user", content: [{ type: "text", text: question, cache_control: { type: "ephemeral" } }] },
  ];
  const blocks: Block[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let searches = 0;
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const left = deadline - Date.now();
    if (left < 10_000) break;
    const res = (await client().messages.create(
      {
        model: ANSWER_MODEL,
        max_tokens: 8000,
        tools: [
          {
            type: "web_search_20250305",
            name: "web_search",
            max_uses: MAX_SEARCHES,
            // 日本のローカル検索として測るため、検索の文脈を日本に寄せる
            user_location: { type: "approximate", country: "JP", timezone: "Asia/Tokyo" },
          },
        ],
        messages,
      } as unknown as Anthropic.Messages.MessageCreateParamsNonStreaming,
      { timeout: Math.min(left, 150_000), maxRetries: 0 }
    )) as unknown as {
      content: Block[];
      stop_reason: string | null;
      usage: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number; server_tool_use?: { web_search_requests?: number } };
    };
    blocks.push(...res.content);
    inputTokens += (res.usage.input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0) + (res.usage.cache_read_input_tokens ?? 0);
    outputTokens += res.usage.output_tokens ?? 0;
    searches += res.usage.server_tool_use?.web_search_requests ?? 0;
    if (res.stop_reason !== "pause_turn") break;
    // 続きを投げる。末尾に cache_control を置き、検索結果本文を往復のたびに払い直さない
    const resume = res.content.map((b) => ({ ...b }));
    for (let i = resume.length - 1; i >= 0; i--) {
      if (["text", "server_tool_use", "web_search_tool_result"].includes(resume[i].type)) {
        resume[i].cache_control = { type: "ephemeral" };
        break;
      }
    }
    messages.push({ role: "assistant", content: resume });
  }

  // 検索が全滅した回答は「AIが検索した結果」ではなく素の知識なので実測に使わない
  const results = blocks.filter((b) => b.type === "web_search_tool_result");
  if (results.length && results.every((r) => !Array.isArray(r.content))) {
    const codes = results.map((r) => String((r.content as { error_code?: string } | null)?.error_code ?? "")).join(", ");
    throw new Error(`web検索に失敗しました（${codes}）`);
  }

  const texts = blocks.filter((b) => b.type === "text").map((b) => String(b.text ?? "").trim()).filter(Boolean);
  const text = texts.join("\n").trim();
  if (!text) throw new Error("AI応答に本文が含まれていません");

  // 実際に回答の根拠として使われた URL だけを残す（検索結果そのものではなく本文の引用注釈から取る）
  const cited: { url: string; title: string; domain: string }[] = [];
  const seen = new Set<string>();
  for (const b of blocks) {
    if (b.type !== "text") continue;
    for (const c of (b.citations as { url?: string; title?: string }[] | null) ?? []) {
      const url = c.url ?? "";
      if (!url || seen.has(url)) continue;
      seen.add(url);
      cited.push({ url: url.slice(0, 2000), title: String(c.title ?? "").slice(0, 300), domain: domainOf(url) });
    }
  }
  const queries: string[] = [];
  for (const b of blocks) {
    if (b.type !== "server_tool_use" || b.name !== "web_search") continue;
    const q = (b.input as { query?: string } | null)?.query;
    if (q && !queries.includes(q)) queries.push(q);
  }
  return { text, cited, queries, inputTokens, outputTokens, searches };
}

/** 回答テキストから、挙がった店舗と根拠URLを機械的に取り出す（自店舗名は渡さない） */
async function extract(answer: string) {
  const data = await askJson<{ stores?: { name?: string; source_urls?: string[] }[] }>(
    EXTRACT_SYSTEM,
    `# AIの回答\n${answer}`,
    { model: MODEL_FAST, maxTokens: 4000, timeoutMs: 60_000 }
  );
  return (data.stores ?? [])
    .slice(0, 20)
    .map((s) => ({
      name: String(s.name ?? "").trim().slice(0, 200),
      sourceUrls: (Array.isArray(s.source_urls) ? s.source_urls : []).filter((u): u is string => typeof u === "string" && !!u).slice(0, 10),
    }))
    .filter((s) => s.name);
}

async function fail(sb: SupabaseClient, checkId: string, message: string) {
  await sb
    .from("ai_search_checks")
    .update({ status: "failed", error_message: message.slice(0, 500), completed_at: new Date().toISOString() })
    .eq("id", checkId);
}

type RunContext = {
  store: MeoStoreSnapshot | null;
  ownNames: string[];
  industry: Industry;
};

/**
 * AI へ実際に問い合わせ、結果をチェックへ書き戻す。sb は service role（画面の本人ではなくサーバーが書く）。
 */
export async function runCheck(sb: SupabaseClient, checkId: string, ctx: RunContext): Promise<boolean> {
  const deadline = Date.now() + MEASURE_BUDGET_MS;
  const { data: check } = await sb.from("ai_search_checks").select("*").eq("id", checkId).maybeSingle();
  if (!check || check.status !== "pending") return false;
  if (!process.env.ANTHROPIC_API_KEY) {
    await fail(sb, checkId, "AI検索の設定が未構成です");
    return false;
  }
  await sb.from("ai_search_checks").update({ status: "running" }).eq("id", checkId);

  try {
    const answer = await ask(check.prompt as string, deadline);
    const stores = await extract(answer.text);
    const listed = stores.map((s) => s.name);
    const rank = findOwnRank(listed, ctx.ownNames);
    const ownDomains = rank ? [...new Set(stores[rank - 1].sourceUrls.map(domainOf).filter(Boolean))] : [];

    await sb
      .from("ai_search_checks")
      .update({
        status: "completed",
        engine: "claude",
        model: ANSWER_MODEL,
        mentioned: rank != null,
        rank,
        listed_stores: listed,
        cited_sources: answer.cited.slice(0, MAX_CITED_SOURCES),
        own_source_domains: ownDomains,
        raw_answer: answer.text.slice(0, 20000),
        search_queries: answer.queries.slice(0, 10),
        search_suggestions_html: "",
        error_message: null,
        completed_at: new Date().toISOString(),
        input_tokens: answer.inputTokens,
        output_tokens: answer.outputTokens,
        search_requests: answer.searches,
      })
      .eq("id", checkId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await fail(sb, checkId, Date.now() > deadline ? "AI検索が時間内に終わりませんでした" : `AI呼び出しに失敗しました: ${msg}`);
    return false;
  }

  // 集計の失敗で実測結果を失わせない
  await rebuildSummary(sb, check.analysis_id as string, ctx, deadline).catch(() => undefined);
  return true;
}

/** 出現率・参照元カバレッジ・改善提案を作り直す */
async function rebuildSummary(sb: SupabaseClient, analysisId: string, ctx: RunContext, deadline: number) {
  const { data } = await sb
    .from("ai_search_checks")
    .select("*")
    .eq("analysis_id", analysisId)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(MAX_HISTORY);
  const checks = data ?? [];
  const history = [...checks].reverse().map((c) => ({
    check_id: c.id,
    date: jstDateKey(new Date((c.completed_at as string) ?? (c.created_at as string))),
    mentioned: c.mentioned === true,
    rank: c.rank ?? null,
  }));
  const cited = checks.flatMap((c) => ((c.cited_sources as { domain?: string }[]) ?? []).map((s) => s.domain ?? ""));
  const own = checks.flatMap((c) => (c.own_source_domains as string[]) ?? []);

  const { data: prev } = await sb.from("ai_search_summary").select("suggestions").eq("analysis_id", analysisId).maybeSingle();
  let suggestions = (prev?.suggestions as unknown[]) ?? [];

  // 提案は時間が残っているときだけ作り直す（作れなければ前回の提案を残す。空にしない）
  if (deadline - Date.now() > 40_000) {
    try {
      const { data: reviews } = await sb
        .from("meo_reviews")
        .select("rating, text, reviewed_at")
        .eq("analysis_id", analysisId)
        .neq("text", "")
        .order("reviewed_at", { ascending: false })
        .limit(5);
      const lines = factLines(ctx.store, ctx.ownNames[0] ?? "", checks, reviews ?? []);
      const res = await askJson<{ suggestions?: Record<string, unknown>[] }>(SUGGEST_SYSTEM, ["# 店舗の実データ", ...lines].join("\n"), {
        maxTokens: 3000,
        timeoutMs: Math.max(20_000, deadline - Date.now() - 5_000),
      });
      const parsed = (res.suggestions ?? [])
        .slice(0, 3)
        .map((s, i) => {
          const title = String(s.title ?? "").trim().slice(0, 200);
          const body = String(s.body ?? "").trim().slice(0, 1500);
          const technique = ["statistics", "quotation", "cite_sources"].includes(String(s.technique)) ? String(s.technique) : "statistics";
          const target = ["gbp_description", "gbp_post", "site_schema"].includes(String(s.target)) ? String(s.target) : "gbp_description";
          return {
            id: `s${i + 1}`,
            technique,
            target,
            title,
            body,
            source_note: String(s.source_note ?? "").trim().slice(0, 300),
            // 生成と同時に法令チェックを通す（AGENTS.md）。そのまま貼れる文面なので辞書で必ず見る
            guard_hits: checkGuardDict([title, body], ctx.industry),
          };
        })
        .filter((s) => s.title && s.body);
      if (parsed.length) suggestions = parsed;
    } catch {
      // 提案の失敗で集計全体を止めない
    }
  }

  const latest = checks[0];
  await sb.from("ai_search_summary").upsert({
    analysis_id: analysisId,
    total_checks: checks.length,
    mentioned_checks: checks.filter((c) => c.mentioned).length,
    history,
    sources: buildCoverage(cited, own),
    suggestions,
    last_checked_at: latest ? ((latest.completed_at as string) ?? null) : null,
    updated_at: new Date().toISOString(),
  });
}

/** 提案生成に渡す事実の一覧。ここに無い数字は書かせない */
function factLines(
  store: MeoStoreSnapshot | null,
  fallbackName: string,
  checks: Record<string, unknown>[],
  reviews: { rating: number; text: string; reviewed_at: string | null }[]
): string[] {
  const lines = [`店舗名: ${store?.name || fallbackName}`];
  if (store?.address) lines.push(`住所: ${store.address}`);
  if (store?.category) lines.push(`業種: ${store.category}`);
  if (store?.rating != null && store.reviewCount != null) {
    lines.push(`Googleのクチコミ: ${store.reviewCount}件・平均${store.rating}（自動取得）`);
  }
  for (const r of reviews) {
    const date = r.reviewed_at ? jstDateKey(new Date(r.reviewed_at)) : "日付不明";
    lines.push(`クチコミ（★${r.rating}・${date}）: 「${String(r.text).slice(0, 200)}」`);
  }
  if (checks.length) {
    const mentioned = checks.filter((c) => c.mentioned).length;
    lines.push(`AI検索の実測: 直近${checks.length}回中${mentioned}回で候補に挙がった`);
    const latest = checks[0];
    lines.push(`最新の質問: 「${latest.query_area} ${latest.query_category}」` + (latest.rank ? `／${latest.rank}番目に掲載` : "／掲載なし"));
  }
  return lines;
}

/** 止まったままの pending を拾い直す（cron の安全網）。作成から2分以上経ったものだけ */
export async function pendingCheckIds(sb: SupabaseClient, limit = 2): Promise<{ id: string; analysis_id: string }[]> {
  const before = new Date(Date.now() - 120_000).toISOString();
  const { data } = await sb
    .from("ai_search_checks")
    .select("id, analysis_id")
    .eq("status", "pending")
    .lt("created_at", before)
    .order("created_at", { ascending: true })
    .limit(limit);
  return (data ?? []) as { id: string; analysis_id: string }[];
}
