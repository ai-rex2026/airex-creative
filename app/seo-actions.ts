"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { AIO_PROJECT_COLUMNS, rowToProject } from "@/lib/aio/store";
import { fromReport, sweep, type InternalDraft, type InternalPriority, type InternalScope, type InternalStatus } from "@/lib/seo/internal";
import { collectSweepInput } from "@/lib/seo/internal-collect";
import type { ReportAio } from "@/lib/report-aio-types";
import type { KeywordPlan } from "@/lib/deep";

/**
 * 内部対策（seo_internal_tasks）の Server Action（2026-10-21 新設）。
 * 洗い出しはサイトの読み取りだけで AI は呼ばない。同じ施策は key で1件にまとめ、利用者が付けた状態は上書きしない。
 */

export type ActionFail = { ok: false; error: string };
const failOf = (e: unknown, fallback: string): ActionFail => ({ ok: false, error: e instanceof Error && e.message ? e.message : fallback });
const now = () => new Date().toISOString();
const refresh = (id: string) => {
  revalidatePath(`/seo/${id}`);
  revalidatePath(`/aio/${id}`);
};

async function owned(projectId: string) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user || user.is_anonymous) throw new Error("ログイン（無料登録）が必要です");
  const { data } = await sb.from("aio_projects").select(AIO_PROJECT_COLUMNS).eq("id", projectId).eq("owner_id", user.id).maybeSingle();
  if (!data) throw new Error("この対象を操作する権限がありません");
  return { sb, userId: user.id, project: rowToProject(data as Record<string, unknown>) };
}

const host = (u: string) => {
  try {
    return new URL(/^https?:\/\//.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/**
 * サイトを読んで内部対策を洗い出す。あわせて、同じドメインの URL レポートがあれば、その指摘も取り込む。
 * 以前サイトの読み取りで出した施策が、今回の読み取りで解消していれば「済み」にする
 */
export async function sweepInternalAction(projectId: string): Promise<{ ok: true; added: number; resolved: number; notes: string[] } | ActionFail> {
  try {
    const { sb, userId, project } = await owned(projectId);
    if (!project.url) throw new Error("対象の URL が未設定です。「対象の設定」で自社サイトの URL を入れてください");
    const input = await collectSweepInput(project.url);
    const drafts: InternalDraft[] = sweep(input);

    // 同じドメインの、いちばん新しい完成済みの URL レポート
    const h = host(project.url);
    const { data: reps } = await sb.from("analyses").select("url, keywords, aio, status").eq("owner_id", userId).eq("status", "done").order("created_at", { ascending: false }).limit(30);
    const rep = ((reps ?? []) as { url: string | null; keywords: KeywordPlan | null; aio?: ReportAio | null }[]).find((r) => r.url && host(r.url) === h);
    if (rep) drafts.push(...fromReport({ technical: rep.keywords?.technical ?? [], aioMeasures: rep.aio?.measures ?? [] }));

    const { data: existing } = await sb.from("seo_internal_tasks").select("id, key, status, source").eq("project_id", projectId);
    const have = new Map(((existing ?? []) as { id: string; key: string; status: string; source: string }[]).map((r) => [r.key, r]));
    const fresh = drafts.filter((d) => !have.has(d.key));
    if (fresh.length) {
      const { error } = await sb.from("seo_internal_tasks").insert(fresh.map((d) => ({ project_id: projectId, ...d, status: "todo" })));
      if (error) throw new Error(`保存できませんでした：${error.message}`);
    }
    // サイトの読み取りで出した施策のうち、今回は出なかった（＝解消した）もの。読み取りに失敗したときは判定しない
    let resolved = 0;
    if (input.site) {
      const nowKeys = new Set(drafts.map((d) => d.key));
      const gone = [...have.values()].filter((r) => r.source === "scan" && r.status !== "done" && r.status !== "skip" && !nowKeys.has(r.key));
      for (const r of gone) {
        await sb.from("seo_internal_tasks").update({ status: "done", note: `サイトの読み取りで解消を確認（${now().slice(0, 10)}）`, updated_at: now() }).eq("id", r.id);
        resolved++;
      }
    }
    refresh(projectId);
    return { ok: true, added: fresh.length, resolved, notes: [...input.notes, ...(rep ? [] : ["同じドメインの URL レポートが無いため、レポートからの取り込みはしていません"])] };
  } catch (e) {
    return failOf(e, "洗い出せませんでした");
  }
}

const SCOPES: InternalScope[] = ["seo", "aio", "both"];
const STATUSES: InternalStatus[] = ["todo", "doing", "done", "skip"];
const PRIORITIES: InternalPriority[] = ["高", "中", "低"];

export async function addInternalTaskAction(projectId: string, input: { title: string; detail: string; scope: InternalScope; priority: InternalPriority }): Promise<{ ok: true } | ActionFail> {
  try {
    const { sb } = await owned(projectId);
    const title = input.title.trim().slice(0, 120);
    if (!title) throw new Error("施策の名前を入れてください");
    const { error } = await sb.from("seo_internal_tasks").insert({
      project_id: projectId,
      key: `manual:${Date.now().toString(36)}`,
      title,
      detail: input.detail.trim().slice(0, 1000),
      scope: SCOPES.includes(input.scope) ? input.scope : "both",
      priority: PRIORITIES.includes(input.priority) ? input.priority : "中",
      source: "manual",
      measured: false,
      status: "todo",
    });
    if (error) throw new Error(`保存できませんでした：${error.message}`);
    refresh(projectId);
    return { ok: true };
  } catch (e) {
    return failOf(e, "追加できませんでした");
  }
}

export async function updateInternalTaskAction(
  projectId: string,
  taskId: string,
  patch: Partial<{ status: InternalStatus; note: string; scope: InternalScope; priority: InternalPriority }>
): Promise<{ ok: true } | ActionFail> {
  try {
    const { sb } = await owned(projectId);
    const row: Record<string, unknown> = { updated_at: now() };
    if (patch.status && STATUSES.includes(patch.status)) row.status = patch.status;
    if (patch.scope && SCOPES.includes(patch.scope)) row.scope = patch.scope;
    if (patch.priority && PRIORITIES.includes(patch.priority)) row.priority = patch.priority;
    if (typeof patch.note === "string") row.note = patch.note.slice(0, 1000);
    const { error } = await sb.from("seo_internal_tasks").update(row).eq("id", taskId).eq("project_id", projectId);
    if (error) throw new Error(`保存できませんでした：${error.message}`);
    refresh(projectId);
    return { ok: true };
  } catch (e) {
    return failOf(e, "保存できませんでした");
  }
}

export async function deleteInternalTaskAction(projectId: string, taskId: string): Promise<{ ok: true } | ActionFail> {
  try {
    const { sb } = await owned(projectId);
    await sb.from("seo_internal_tasks").delete().eq("id", taskId).eq("project_id", projectId);
    refresh(projectId);
    return { ok: true };
  } catch (e) {
    return failOf(e, "削除できませんでした");
  }
}
