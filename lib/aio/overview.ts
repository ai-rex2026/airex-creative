import type { SupabaseClient } from "@supabase/supabase-js";
import { askJson, MODEL_FAST } from "../anthropic";
import { hasDataForSeo, LANGUAGE_JA, LOCATION_JP, postLive } from "../affiliate/dataforseo";
import { cleanQuery } from "./query";
import type { AioOverview, AioProject } from "./types";

/**
 * Google 検索の「AI による概要」を取る（2026-11-13）。
 * Google に公式 API は無いので DataForSEO の SERP（Google Organic・Live Advanced）の ai_overview を使う。
 * 後から生成される概要も取るため load_async_ai_overview を付ける（無かった回は追加料金が返金される）。
 *
 * - 1回の測定（aio_checks の1行）につき DataForSEO を1回だけ呼ぶ。呼ぶ前に overview_status を
 *   pending → running に条件つきで更新して「取った人だけが呼ぶ」ようにし、二重に課金しない
 * - 失敗しても自動では呼び直さない（課金があるため）。結果は Gemini の測定とは別のカラムにその場で保存する
 * - 概要が出ない検索語・回も多いので、出なかった回は shown=false として残す
 */

const MAX_TEXT = 8000;
const MAX_REFS = 30;
/** DataForSEO の待ち時間の上限（後読み込みの概要を待つぶん、通常の SERP より長め） */
const FETCH_TIMEOUT_MS = 60_000;

export type OverviewFetch = (query: string) => Promise<{ ok: true; items: unknown[] } | { ok: false; error: string }>;
export type OverviewDeps = { fetch: OverviewFetch };

export const defaultOverviewDeps = (): OverviewDeps => ({
  fetch: async (query) => {
    const res = await postLive<{ items?: unknown[] | null }>(
      "/serp/google/organic/live/advanced",
      [{ keyword: query, location_code: LOCATION_JP, language_code: LANGUAGE_JA, device: "desktop", depth: 10, load_async_ai_overview: true }],
      FETCH_TIMEOUT_MS
    );
    if (!res.ok) return res;
    return { ok: true, items: res.result[0]?.items ?? [] };
  },
});

/** 概要を取れる設定か（DataForSEO の認証情報があるか） */
export const canFetchOverview = () => hasDataForSeo();

// ── 解析（純粋関数） ──────────────────────────────

const NOISE = /[\s\-‐‑–—ー・\/／|｜()（）[\]「」『』"'’、。．,.!！?？&＆*#_`>]/g;
const LEGAL = /株式会社|\(株\)|有限会社|\(有\)|合同会社|\(合\)|\(同\)/g;
const norm = (s: string) => s.normalize("NFKC").replace(LEGAL, "").replace(NOISE, "").toLowerCase();
const cleanDomain = (d: string) => d.toLowerCase().replace(/^www\./, "");

function domainFrom(url: string, fallback: unknown): string {
  const d = String(fallback ?? "").trim();
  if (d) return cleanDomain(d);
  try {
    return cleanDomain(new URL(url).hostname);
  } catch {
    return "";
  }
}

/** 本文に自社名（名前・別名）が出たか。2文字未満の名前は誤検知が多いので見ない */
export function mentionsOwn(text: string, names: string[]): boolean {
  const t = norm(text);
  return names.some((n) => {
    const k = norm(n);
    return k.length >= 2 && t.includes(k);
  });
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

/** ai_overview の中の references を、入れ子（要素・表）も含めて集める */
function collectRefs(node: unknown, out: Map<string, { url: string; domain: string; title: string }>, depth = 0) {
  if (depth > 4 || out.size >= MAX_REFS) return;
  if (Array.isArray(node)) {
    for (const n of node) collectRefs(n, out, depth + 1);
    return;
  }
  if (!isObj(node)) return;
  if (Array.isArray(node.references)) {
    for (const r of node.references) {
      if (!isObj(r)) continue;
      const url = String(r.url ?? "").trim();
      if (!url || out.has(url)) continue;
      out.set(url, { url: url.slice(0, 500), domain: domainFrom(url, r.domain), title: String(r.title ?? r.source ?? "").slice(0, 200) });
      if (out.size >= MAX_REFS) return;
    }
  }
  if (Array.isArray(node.items)) collectRefs(node.items, out, depth + 1);
}

/** SERP の items から「AI による概要」を取り出す（見つからなければ shown=false） */
export function parseOverview(items: unknown[], own: { names: string[]; domains: string[] }): Omit<AioOverview, "fetchedAt"> {
  const ai = items.find((i) => isObj(i) && i.type === "ai_overview") as Obj | undefined;
  if (!ai) return { shown: false, async: false, text: "", references: [], mentioned: false, ownCited: false };
  let text = typeof ai.markdown === "string" ? ai.markdown : "";
  if (!text && Array.isArray(ai.items)) {
    text = ai.items
      .filter(isObj)
      .map((e) => String(e.markdown ?? e.text ?? "").trim())
      .filter(Boolean)
      .join("\n\n");
  }
  const refs = new Map<string, { url: string; domain: string; title: string }>();
  collectRefs(ai, refs);
  const references = [...refs.values()];
  const ownD = own.domains.map(cleanDomain).filter(Boolean);
  const ownCited = references.some((r) => !!r.domain && ownD.some((o) => r.domain === o || r.domain.endsWith(`.${o}`)));
  return {
    shown: !!text.trim() || references.length > 0,
    async: ai.asynchronous_ai_overview === true,
    text: text.slice(0, MAX_TEXT),
    references,
    mentioned: !!text && mentionsOwn(text, own.names),
    ownCited,
  };
}

// ── 実行 ──────────────────────────────

/**
 * 1件の測定について概要を取って保存する（sb は service role）。
 * pending のものだけを running に切り替えてから呼ぶので、同時に走っても DataForSEO は1回しか呼ばれない
 */
export async function runOverview(
  sb: SupabaseClient,
  checkId: string,
  project: Pick<AioProject, "name" | "aliases" | "url">,
  deps: OverviewDeps = defaultOverviewDeps()
): Promise<boolean> {
  const { data: claimed } = await sb
    .from("aio_checks")
    .update({ overview_status: "running" })
    .eq("id", checkId)
    .eq("overview_status", "pending")
    .select("id, overview_query")
    .maybeSingle();
  if (!claimed) return false;
  const query = String(claimed.overview_query ?? "").trim();
  const fetchedAt = new Date().toISOString();
  const failWith = async (error: string) => {
    const overview: AioOverview = { shown: false, async: false, text: "", references: [], mentioned: false, ownCited: false, fetchedAt, error: error.slice(0, 300) };
    await sb.from("aio_checks").update({ overview_status: "failed", overview }).eq("id", checkId);
    return false;
  };
  if (!query) return failWith("検索語がありません");
  let res: Awaited<ReturnType<OverviewFetch>>;
  try {
    res = await deps.fetch(query);
  } catch (e) {
    return failWith(e instanceof Error ? e.message : String(e));
  }
  if (!res.ok) return failWith(res.error);
  let domains: string[] = [];
  try {
    domains = project.url ? [new URL(project.url).hostname] : [];
  } catch {
    domains = [];
  }
  const parsed = parseOverview(res.items, { names: [project.name, ...project.aliases].filter((n) => n.trim()), domains });
  const { error } = await sb.from("aio_checks").update({ overview_status: "done", overview: { ...parsed, fetchedAt } }).eq("id", checkId);
  return !error;
}

/** 応答後の処理が切られて pending のまま残った概要を、cron が拾う */
export async function pendingOverviewIds(sb: SupabaseClient, limit = 4): Promise<{ id: string; project_id: string }[]> {
  const stale = new Date(Date.now() - 3 * 60_000).toISOString();
  const { data } = await sb.from("aio_checks").select("id, project_id").eq("overview_status", "pending").lt("created_at", stale).order("created_at", { ascending: true }).limit(limit);
  return (data ?? []) as { id: string; project_id: string }[];
}

/** running のまま残ったもの（関数が途中で切られた）は失敗にする。課金済みかもしれないので呼び直さない */
export async function expireStuckOverviews(sb: SupabaseClient) {
  const stale = new Date(Date.now() - 15 * 60_000).toISOString();
  const { data } = await sb.from("aio_checks").select("id").eq("overview_status", "running").lt("created_at", stale).limit(50);
  for (const r of data ?? []) {
    const overview: AioOverview = { shown: false, async: false, text: "", references: [], mentioned: false, ownCited: false, fetchedAt: new Date().toISOString(), error: "取得が途中で止まりました" };
    await sb.from("aio_checks").update({ overview_status: "failed", overview }).eq("id", r.id).eq("overview_status", "running");
  }
}

// ── 検索語 ──────────────────────────────

const QUERY_SYSTEM = `あなたは SEO の担当者です。見込み客が AI に投げる「問い（質問文）」を、同じ人が Google で検索するときの「検索語」に言い換えます。
- 2〜4語をスペースで区切る（例：「渋谷で口コミの良い美容室を教えて」→「渋谷 美容室 おすすめ」）
- 地域・業種・目的・比較相手など、問いの要点を残す。問いにない語を足さない
- 社名が入った問いは社名を残す（例：「〇〇社の評判は？」→「〇〇 評判」）
- 全角30字以内
出力: {"queries":[{"i":0,"q":"検索語"}]}`;

export type QueryAsk = (system: string, user: string) => Promise<unknown>;
const defaultQueryAsk: QueryAsk = (s, u) => askJson(s, u, { model: MODEL_FAST, maxTokens: 1500, timeoutMs: 60_000 });

export { cleanQuery };

/** 問いのリストを検索語に言い換える（AI 1回）。言い換えられなかったものは入れない */
export async function toSearchQueries(texts: string[], ask: QueryAsk = defaultQueryAsk): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (!texts.length) return out;
  const raw = (await ask(QUERY_SYSTEM, texts.map((t, i) => `${i}: ${t}`).join("\n"))) as { queries?: { i?: unknown; q?: unknown }[] };
  for (const r of Array.isArray(raw?.queries) ? raw.queries : []) {
    const i = Number(r?.i);
    const q = cleanQuery(r?.q);
    if (Number.isInteger(i) && i >= 0 && i < texts.length && q) out.set(i, q);
  }
  return out;
}

/**
 * 検索語が空のプロンプトにだけ検索語を付けて、1本ずつ保存する（AI 1回。全部付いていれば呼ばない）。
 * 戻り値は prompt id → 検索語（既にあったものも含む）
 */
export async function ensureSearchQueries(
  sb: SupabaseClient,
  projectId: string,
  prompts: { id: string; text: string; searchQuery: string }[],
  ask: QueryAsk = defaultQueryAsk
): Promise<Map<string, string>> {
  const map = new Map(prompts.filter((p) => p.searchQuery.trim()).map((p) => [p.id, p.searchQuery.trim()]));
  const missing = prompts.filter((p) => !p.searchQuery.trim());
  if (!missing.length) return map;
  const got = await toSearchQueries(missing.map((p) => p.text), ask);
  for (const [i, q] of got) {
    const p = missing[i];
    const { error } = await sb.from("aio_prompts").update({ search_query: q }).eq("id", p.id).eq("project_id", projectId).eq("search_query", "");
    if (!error) map.set(p.id, q);
  }
  return map;
}
