import type { SupabaseClient } from "@supabase/supabase-js";
import { discoverUrls, readPage, type LinkCollectDeps } from "./collect";
import { passes, type Judge } from "./judge";
import { anchorCandidates, bestSentences, buildIndex, pickCandidates, type PageDoc } from "./text";

/**
 * 内部リンク分析の工程（2026-10-27）。AGENTS.md の方針に沿って、
 * ・1件ごとに結果をその場で保存する（まとめて最後に1回にしない）
 * ・並列は Promise.allSettled で、失敗が成功を握りつぶさないようにする
 * ・保存済みの記事・判定済みの組は、再実行で飛ばす（有料の AI 呼び出しを繰り返さない）
 * 外部の読み取りと AI は引数で差し替えられる（有料 API を呼ばずに検証するため）
 */

const now = () => new Date().toISOString();
/** 1プロジェクトで AI に判定させる組の上限 */
export const MAX_PAIRS = 200;
export const FETCH_BATCH = 8;
export const JUDGE_BATCH = 6;

export type PageRow = { url: string; title: string; h1: string; headings: string[]; body: string; links: string[]; fetched_at: string | null; error: string };

// ── 1. 記事を集める ─────────────────────

/** サイトマップから記事の URL を集め、まだ無いものを「未読」として登録する。済みの記事は触らない */
export async function startCollect(sb: SupabaseClient, projectId: string, siteUrl: string, deps: Pick<LinkCollectDeps, "text" | "html">) {
  const { urls, notes } = await discoverUrls(siteUrl, deps);
  const { data: have } = await sb.from("seo_link_pages").select("url").eq("project_id", projectId);
  const known = new Set(((have ?? []) as { url: string }[]).map((r) => r.url));
  const fresh = urls.filter((u) => !known.has(u));
  if (fresh.length) {
    const { error } = await sb.from("seo_link_pages").insert(fresh.map((url) => ({ project_id: projectId, url })));
    if (error) throw new Error(`保存できませんでした：${error.message}`);
  }
  return { found: urls.length, added: fresh.length, notes };
}

/** 未読の記事を数件ずつ読んで、1件ごとに保存する。失敗した記事は理由を残して、次回は飛ばす（読み直しは別操作） */
export async function collectBatch(sb: SupabaseClient, projectId: string, deps: Pick<LinkCollectDeps, "html">, batch = FETCH_BATCH) {
  const { data: todo } = await sb.from("seo_link_pages").select("url").eq("project_id", projectId).is("fetched_at", null).eq("error", "").order("created_at").limit(batch);
  const urls = ((todo ?? []) as { url: string }[]).map((r) => r.url);
  let done = 0;
  let failed = 0;
  await Promise.allSettled(
    urls.map(async (url) => {
      try {
        const p = await readPage(url, deps);
        const { error } = await sb.from("seo_link_pages").update({ title: p.title, h1: p.h1, headings: p.headings, body: p.body, links: p.links, fetched_at: now(), error: "" }).eq("project_id", projectId).eq("url", url);
        if (error) throw new Error(error.message);
        done++;
      } catch (e) {
        failed++;
        await sb.from("seo_link_pages").update({ error: (e instanceof Error ? e.message : "読めませんでした").slice(0, 200) }).eq("project_id", projectId).eq("url", url);
      }
    })
  );
  const { count } = await sb.from("seo_link_pages").select("id", { count: "exact", head: true }).eq("project_id", projectId).is("fetched_at", null).eq("error", "");
  return { done, failed, remaining: count ?? 0 };
}

/** 失敗した記事をもう一度読む対象に戻す */
export async function retryFailedPages(sb: SupabaseClient, projectId: string) {
  await sb.from("seo_link_pages").update({ error: "" }).eq("project_id", projectId).is("fetched_at", null).neq("error", "");
}

// ── 2. 候補を絞る（AI は使わない） ─────────────────────

export async function loadDocs(sb: SupabaseClient, projectId: string): Promise<PageDoc[]> {
  const { data } = await sb.from("seo_link_pages").select("url, title, h1, headings, body, links").eq("project_id", projectId).not("fetched_at", "is", null).limit(200);
  return ((data ?? []) as { url: string; title: string; h1: string; headings: string[]; body: string; links: string[] }[])
    .filter((d) => d.body.length >= 80)
    .map((d) => ({ url: d.url, title: d.title, h1: d.h1, headings: d.headings ?? [], body: d.body, links: d.links ?? [] }));
}

/** 類似度の高い組を、まだ登録していないものだけ「未判定」で登録する。判定済みの組は残す */
export async function buildCandidates(sb: SupabaseClient, projectId: string) {
  const docs = await loadDocs(sb, projectId);
  if (docs.length < 2) return { docs: docs.length, added: 0, pending: 0 };
  const { data: have } = await sb.from("seo_link_suggestions").select("from_url, to_url").eq("project_id", projectId);
  const known = new Set(((have ?? []) as { from_url: string; to_url: string }[]).map((r) => `${r.from_url}\n${r.to_url}`));
  const room = Math.max(0, MAX_PAIRS - known.size);
  const cands = pickCandidates(docs)
    .filter((c) => !known.has(`${c.from}\n${c.to}`))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, room);
  if (cands.length) {
    const { error } = await sb.from("seo_link_suggestions").insert(cands.map((c) => ({ project_id: projectId, from_url: c.from, to_url: c.to, similarity: c.similarity, status: "pending" })));
    if (error) throw new Error(`保存できませんでした：${error.message}`);
  }
  const { count } = await sb.from("seo_link_suggestions").select("id", { count: "exact", head: true }).eq("project_id", projectId).eq("status", "pending");
  return { docs: docs.length, added: cands.length, pending: count ?? 0 };
}

// ── 3. 判定する ─────────────────────

/** 未判定の組を数件ずつ判定し、1組ごとに保存する。失敗した組は未判定のまま残す（次回やり直す） */
export async function judgeBatch(sb: SupabaseClient, projectId: string, judge: Judge, batch = JUDGE_BATCH) {
  const { data: todo } = await sb.from("seo_link_suggestions").select("id, from_url, to_url").eq("project_id", projectId).eq("status", "pending").order("similarity", { ascending: false }).limit(batch);
  const rows = (todo ?? []) as { id: string; from_url: string; to_url: string }[];
  if (rows.length === 0) return { judged: 0, adopted: 0, failed: 0, remaining: 0, error: "" };

  const docs = await loadDocs(sb, projectId);
  const byUrl = new Map(docs.map((d) => [d.url, d]));
  const ix = buildIndex(docs);
  let judged = 0;
  let adopted = 0;
  let failed = 0;
  let lastError = "";

  await Promise.allSettled(
    rows.map(async (r) => {
      const from = byUrl.get(r.from_url);
      const to = byUrl.get(r.to_url);
      try {
        if (!from || !to) throw new Error("記事を読めていません");
        const sentences = bestSentences(from, to, ix, 3);
        const usable = sentences.filter((s) => anchorCandidates(s, to).length > 0);
        if (usable.length === 0) {
          // リンクを入れられる文が見つからない：AI を呼ばずに見送り（費用をかけない）
          await sb.from("seo_link_suggestions").update({ status: "rejected", decision: false, reason: "リンクを入れられる自然な文が本文に見つかりませんでした", judge: "rule", updated_at: now() }).eq("id", r.id);
          judged++;
          return;
        }
        const a = await judge.judge({ fromUrl: from.url, fromTitle: from.title || from.h1, toUrl: to.url, toTitle: to.title || to.h1, toHeadings: to.headings, sentences: usable });
        const ok = passes(a);
        const { error } = await sb
          .from("seo_link_suggestions")
          .update({
            decision: a.link,
            probability: a.probability,
            confidence: a.confidence,
            sentence: usable[a.sentenceIndex] ?? "",
            anchor: a.anchor,
            role: a.role,
            reason: a.reason,
            judge: judge.name,
            status: ok ? "suggested" : "rejected",
            updated_at: now(),
          })
          .eq("id", r.id);
        if (error) throw new Error(error.message);
        judged++;
        if (ok) adopted++;
      } catch (e) {
        failed++;
        lastError = e instanceof Error ? e.message : "判定できませんでした";
      }
    })
  );
  const { count } = await sb.from("seo_link_suggestions").select("id", { count: "exact", head: true }).eq("project_id", projectId).eq("status", "pending");
  return { judged, adopted, failed, remaining: count ?? 0, error: lastError };
}
