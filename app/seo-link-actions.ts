"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { AIO_PROJECT_COLUMNS, rowToProject } from "@/lib/aio/store";
import { fetchHtml, publicFetch } from "@/lib/aio/net";
import type { LinkCollectDeps } from "@/lib/seo/links/collect";
import { buildCandidates, collectBatch, judgeBatch, retryFailedPages, startCollect } from "@/lib/seo/links/run";
import { claudeJudge } from "@/lib/seo/links/claude-judge";

/**
 * 内部リンク分析の Server Action（2026-10-27）。1回の呼び出しは数件だけ処理して返し、画面が繰り返し呼ぶ
 * （1回で全部やると実行時間の上限を超え、保存できないまま切られるため）。リンクの設置は人が行う（自動で本文を書き換えない）
 */

type Fail = { ok: false; error: string };
const failOf = (e: unknown, fallback: string): Fail => ({ ok: false, error: e instanceof Error && e.message ? e.message : fallback });
const refresh = (id: string) => revalidatePath(`/seo/${id}`);

async function owned(projectId: string) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user || user.is_anonymous) throw new Error("ログイン（無料登録）が必要です");
  const { data } = await sb.from("aio_projects").select(AIO_PROJECT_COLUMNS).eq("id", projectId).eq("owner_id", user.id).maybeSingle();
  if (!data) throw new Error("この対象を操作する権限がありません");
  return { sb, project: rowToProject(data as Record<string, unknown>) };
}

const DEPS: LinkCollectDeps = {
  text: async (url) => {
    const res = await publicFetch(url, { timeoutMs: 10_000 });
    return res.ok ? (await res.text()).slice(0, 500_000) : null;
  },
  html: (url) => fetchHtml(url, { browserUa: true, timeoutMs: 12_000 }),
};

/** 1. サイトマップから記事の URL を集める */
export async function startLinkCollectAction(projectId: string): Promise<{ ok: true; found: number; added: number; notes: string[] } | Fail> {
  try {
    const { sb, project } = await owned(projectId);
    if (!project.url) throw new Error("対象の URL が未設定です。「対象の設定」で自社サイトの URL を入れてください");
    const r = await startCollect(sb, projectId, project.url, DEPS);
    refresh(projectId);
    return { ok: true, ...r };
  } catch (e) {
    return failOf(e, "記事を集められませんでした");
  }
}

/** 2. 未読の記事を数件読む（画面が、残りが 0 になるまで繰り返す） */
export async function collectLinkBatchAction(projectId: string): Promise<{ ok: true; done: number; failed: number; remaining: number } | Fail> {
  try {
    const { sb } = await owned(projectId);
    const r = await collectBatch(sb, projectId, DEPS);
    refresh(projectId);
    return { ok: true, ...r };
  } catch (e) {
    return failOf(e, "記事を読めませんでした");
  }
}

export async function retryLinkPagesAction(projectId: string): Promise<{ ok: true } | Fail> {
  try {
    const { sb } = await owned(projectId);
    await retryFailedPages(sb, projectId);
    refresh(projectId);
    return { ok: true };
  } catch (e) {
    return failOf(e, "やり直せませんでした");
  }
}

/** 3. 読んだ記事から、類似度の高い組を候補にする（AI は使わない） */
export async function buildLinkCandidatesAction(projectId: string): Promise<{ ok: true; docs: number; added: number; pending: number } | Fail> {
  try {
    const { sb } = await owned(projectId);
    const r = await buildCandidates(sb, projectId);
    refresh(projectId);
    return { ok: true, ...r };
  } catch (e) {
    return failOf(e, "候補を作れませんでした");
  }
}

/** 4. 未判定の組を数件判定する（AI を使う。画面が、残りが 0 になるまで繰り返す） */
export async function judgeLinkBatchAction(projectId: string): Promise<{ ok: true; judged: number; adopted: number; failed: number; remaining: number; error: string } | Fail> {
  try {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("AI の設定（ANTHROPIC_API_KEY）がありません");
    const { sb } = await owned(projectId);
    const r = await judgeBatch(sb, projectId, claudeJudge);
    refresh(projectId);
    return { ok: true, ...r };
  } catch (e) {
    return failOf(e, "判定できませんでした");
  }
}

/** 提案への対応を記録する（リンクを入れたら「入れた」、見送るなら「見送り」。本文は書き換えない） */
export async function setLinkSuggestionAction(projectId: string, id: string, status: "suggested" | "accepted" | "dismissed"): Promise<{ ok: true } | Fail> {
  try {
    const { sb } = await owned(projectId);
    const { error } = await sb.from("seo_link_suggestions").update({ status, updated_at: new Date().toISOString() }).eq("id", id).eq("project_id", projectId).in("status", ["suggested", "accepted", "dismissed"]);
    if (error) throw new Error(error.message);
    refresh(projectId);
    return { ok: true };
  } catch (e) {
    return failOf(e, "記録できませんでした");
  }
}
