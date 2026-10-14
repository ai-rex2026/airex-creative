import type { SupabaseClient } from "@supabase/supabase-js";
import { askJson, MODEL_FAST } from "../anthropic";
import { GEMINI_MODEL } from "../gemini";
import { ask, domainOf, findOwnRank, preferredEngine } from "../meo-ops/ai-search";
import { jstPeriodKey } from "../meo-ops/daily";
import { AIO_MONTHLY_LIMIT, type AioProject } from "./types";

/**
 * AIO の「今どうか」＝ AI に実際に聞いて、自社が候補に挙がるかを実測する。
 * エンジン・照合・引用元の扱いは店舗の AI検索（lib/meo-ops/ai-search.ts）と同じものを使い、
 * 「この施策をすれば AI に出る」という因果は主張しない。結果はそのまま見せる。
 */

const ANSWER_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
/** 実測に使ってよい合計時間（関数ごと切られて running のまま残らないよう、手前で自分から失敗させる） */
const MEASURE_BUDGET_MS = 200_000;
const MAX_CITED = 30;

/** AI への質問。店舗と違い、エリアが無い（全国・オンライン）事業も多いので、エリアは任意にする */
export function buildAioPrompt(area: string, category: string): string {
  const where = area.trim() ? `${area.trim()}で` : "";
  return `${where}${category.trim()}を探しています。\nおすすめの会社・サービスを5〜8件、それぞれ選んだ理由と情報源（URL）つきで教えてください。`;
}

/** 手動実測の月次上限。月次の自動計測（source = monthly）は数えない */
export async function quota(sb: SupabaseClient, projectId: string) {
  const period = jstPeriodKey();
  const { count } = await sb.from("aio_checks").select("id", { count: "exact", head: true }).eq("project_id", projectId).eq("period", period).neq("source", "monthly");
  const used = count ?? 0;
  return { period, limit: AIO_MONTHLY_LIMIT, used, remaining: Math.max(0, AIO_MONTHLY_LIMIT - used) };
}

/**
 * 実測を1件受け付ける（sb は service role。aio_checks への書き込みはサーバーだけ）。
 * promptText は AI に投げる文そのもの。promptId は対策プロンプト（aio_prompts）の id（無ければ null＝探し方からの定型文）。
 * source = monthly（月次の自動計測）は手動の上限を消費しない
 */
export async function createCheck(
  sb: SupabaseClient,
  projectId: string,
  promptText: string,
  opts: { promptId?: string | null; source?: "manual" | "monthly" } = {}
) {
  const source = opts.source ?? "manual";
  const q = await quota(sb, projectId);
  if (source === "manual" && q.remaining <= 0) throw new Error(`実測は 1 か月に ${q.limit} 回までです。翌月まではお待ちください。`);
  const engine = preferredEngine();
  const { data, error } = await sb
    .from("aio_checks")
    .insert({ project_id: projectId, prompt_id: opts.promptId ?? null, source, status: "pending", engine, model: engine === "gemini" ? GEMINI_MODEL : ANSWER_MODEL, prompt: promptText, period: q.period })
    .select("id")
    .single();
  if (error || !data) throw new Error("実測を開始できませんでした");
  return { checkId: data.id as string, remaining: source === "manual" ? Math.max(0, q.remaining - 1) : q.remaining };
}

const EXTRACT_SYSTEM = `あなたはAIの回答テキストから、挙げられた会社・サービス・店舗の名前を抽出する処理系です。
次のJSONのみを出力してください（前後に説明を書かない）。

{"entities":[{"name":"回答に書かれた表記のまま","source_urls":["その事業者の根拠として挙げられたURL"]}]}

- entities は回答に出てくる順番のまま並べる（順番が掲載順位になる）
- 事業者として挙げられていないもの（媒体名・エリア名・注意書き・一般名詞）は入れない
- 名前は回答の表記をそのまま使い、要約・翻訳・正規化をしない
- 根拠URLが書かれていないものは source_urls を空配列にする`;

async function extract(answer: string) {
  const data = await askJson<{ entities?: { name?: string; source_urls?: string[] }[] }>(EXTRACT_SYSTEM, `# AIの回答\n${answer}`, { model: MODEL_FAST, maxTokens: 4000, timeoutMs: 60_000 });
  return (data.entities ?? [])
    .slice(0, 20)
    .map((e) => ({
      name: String(e.name ?? "").trim().slice(0, 200),
      sourceUrls: (Array.isArray(e.source_urls) ? e.source_urls : []).filter((u): u is string => typeof u === "string" && !!u).slice(0, 10),
    }))
    .filter((e) => e.name);
}

async function fail(sb: SupabaseClient, checkId: string, message: string) {
  await sb.from("aio_checks").update({ status: "failed", error_message: message.slice(0, 500), completed_at: new Date().toISOString() }).eq("id", checkId);
}

/** 実際に AI へ問い合わせて結果を書き戻す。sb は service role */
export async function runCheck(sb: SupabaseClient, checkId: string, project: Pick<AioProject, "name" | "aliases">): Promise<boolean> {
  const deadline = Date.now() + MEASURE_BUDGET_MS;
  const { data: check } = await sb.from("aio_checks").select("id, status, prompt").eq("id", checkId).maybeSingle();
  if (!check || check.status !== "pending") return false;
  if (!process.env.ANTHROPIC_API_KEY) {
    await fail(sb, checkId, "AI検索の設定が未構成です");
    return false;
  }
  await sb.from("aio_checks").update({ status: "running" }).eq("id", checkId);

  try {
    const answer = await ask(check.prompt as string, deadline);
    const entities = await extract(answer.text);
    const listed = entities.map((e) => e.name);
    const rank = findOwnRank(listed, [project.name, ...project.aliases]);
    const ownDomains = rank ? [...new Set(entities[rank - 1].sourceUrls.map(domainOf).filter(Boolean))] : [];
    await sb
      .from("aio_checks")
      .update({
        status: "completed",
        engine: answer.engine,
        model: answer.model,
        mentioned: rank != null,
        rank,
        listed,
        cited_sources: answer.cited.slice(0, MAX_CITED),
        own_source_domains: ownDomains,
        raw_answer: answer.text.slice(0, 20000),
        search_queries: answer.queries.slice(0, 10),
        error_message: answer.note,
        completed_at: new Date().toISOString(),
        input_tokens: answer.inputTokens,
        output_tokens: answer.outputTokens,
        search_requests: answer.searches,
      })
      .eq("id", checkId);
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await fail(sb, checkId, Date.now() > deadline ? "実測が時間内に終わりませんでした" : `AI呼び出しに失敗しました: ${msg}`);
    return false;
  }
}

/** after() で走らせた実測が関数ごと切られて pending のまま残ったものを、cron が拾い直す */
export async function pendingCheckIds(sb: SupabaseClient, limit = 2): Promise<{ id: string; project_id: string }[]> {
  const stale = new Date(Date.now() - 2 * 60_000).toISOString();
  const { data } = await sb.from("aio_checks").select("id, project_id").eq("status", "pending").lt("created_at", stale).order("created_at", { ascending: true }).limit(limit);
  return (data ?? []) as { id: string; project_id: string }[];
}

/** running のまま長時間残ったもの（関数が途中で切られた）を失敗にして、画面の「確認中」を解く */
export async function expireStuckChecks(sb: SupabaseClient) {
  const stale = new Date(Date.now() - 10 * 60_000).toISOString();
  await sb.from("aio_checks").update({ status: "failed", error_message: "実測が途中で止まりました。もう一度お試しください", completed_at: new Date().toISOString() }).eq("status", "running").lt("created_at", stale);
}
