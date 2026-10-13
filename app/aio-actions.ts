"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { AIO_PROJECT_COLUMNS, rowToCheck, rowToProject, AIO_CHECK_COLUMNS } from "@/lib/aio/store";
import { createCheck, runCheck } from "@/lib/aio/run";
import { draftAioContent, suggestProjectFacts } from "@/lib/aio/writer";
import { AIO_DRAFT_KINDS, type AioDraftKind, type AioProject } from "@/lib/aio/types";
import { fetchSiteSummary } from "@/lib/meo-ops/writer";
import type { Industry } from "@/lib/types";

/**
 * AIO（AI検索対策）の Server Action。
 * 対象（aio_projects）と下書き（aio_drafts）は本人のセッション（RLS）で読み書きし、
 * 実測（aio_checks）はサーバー（service role）だけが書く（店舗の AI検索と同じ分担）。
 */

async function me() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) throw new Error("ログインが必要です");
  if (user.is_anonymous) throw new Error("AIO を使うには、先に無料登録してください");
  return { sb, user };
}

async function owned(id: string): Promise<{ sb: Awaited<ReturnType<typeof createClient>>; project: AioProject }> {
  const { sb, user } = await me();
  const { data } = await sb.from("aio_projects").select(AIO_PROJECT_COLUMNS).eq("id", id).eq("owner_id", user.id).maybeSingle();
  if (!data) throw new Error("この対象を操作する権限がありません");
  return { sb, project: rowToProject(data as Record<string, unknown>) };
}

const INDUSTRIES: Industry[] = ["beauty", "medical", "supplement", "finance", "general"];
const refresh = (id?: string) => {
  revalidatePath("/aio");
  if (id) revalidatePath(`/aio/${id}`);
};

export type AioProjectInput = {
  name: string;
  aliases: string[];
  url: string;
  industry: Industry;
  area: string;
  category: string;
  notes: string;
};

/** URL から、事業者名・探し方・エリアの候補を AI に考えさせる（登録フォームの補助。保存はしない） */
export async function suggestAioProjectAction(url: string, notes: string) {
  await me();
  const u = url.trim();
  if (!/^https?:\/\//.test(u)) throw new Error("URL は https:// から入力してください");
  const r = await suggestProjectFacts(u, notes);
  return { name: r.name, aliases: r.aliases, category: r.category, area: r.area, industry: r.industry };
}

export async function createAioProjectAction(input: AioProjectInput): Promise<string> {
  const { sb, user } = await me();
  const name = input.name.trim();
  const category = input.category.trim();
  if (!name) throw new Error("事業者名を入力してください");
  if (!category) throw new Error("AIに聞くときの探し方を入力してください");
  const url = input.url.trim();
  const siteSummary = url ? await fetchSiteSummary(url) : "";
  const { data, error } = await sb
    .from("aio_projects")
    .insert({
      owner_id: user.id,
      name: name.slice(0, 120),
      aliases: input.aliases.map((a) => a.trim()).filter(Boolean).slice(0, 6),
      url: url || null,
      industry: INDUSTRIES.includes(input.industry) ? input.industry : "general",
      area: input.area.trim().slice(0, 60),
      category: category.slice(0, 100),
      notes: input.notes.trim().slice(0, 2000),
      site_summary: siteSummary,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`登録できませんでした：${error?.message ?? ""}`);
  refresh();
  return data.id as string;
}

export async function updateAioProjectAction(id: string, input: AioProjectInput) {
  const { sb } = await owned(id);
  const { error } = await sb
    .from("aio_projects")
    .update({
      name: input.name.trim().slice(0, 120),
      aliases: input.aliases.map((a) => a.trim()).filter(Boolean).slice(0, 6),
      url: input.url.trim() || null,
      industry: INDUSTRIES.includes(input.industry) ? input.industry : "general",
      area: input.area.trim().slice(0, 60),
      category: input.category.trim().slice(0, 100),
      notes: input.notes.trim().slice(0, 2000),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(`保存できませんでした：${error.message}`);
  refresh(id);
}

export async function deleteAioProjectAction(id: string) {
  const { sb } = await owned(id);
  await sb.from("aio_projects").delete().eq("id", id);
  refresh();
}

/** 「今どうか」を実測する。応答後に after() で走らせ、画面は数秒おきに読み直す */
export async function runAioCheckAction(id: string) {
  const { project } = await owned(id);
  if (!project.category) throw new Error("AIに聞くときの探し方を設定してください");
  const admin = createAdminClient();
  const created = await createCheck(admin, id, project.area, project.category);
  after(async () => {
    await runCheck(createAdminClient(), created.checkId, { name: project.name, aliases: project.aliases }).catch(() => undefined);
  });
  refresh(id);
  return created;
}

/** 実行中のチェックの状態だけを読む（ポーリング用） */
export async function aioCheckStatusAction(id: string, checkId: string) {
  const { sb } = await owned(id);
  const { data } = await sb.from("aio_checks").select("status").eq("project_id", id).eq("id", checkId).maybeSingle();
  return (data?.status as string | undefined) ?? null;
}

/** 「何をすべきか」の下書きを1種類作る */
export async function generateAioDraftAction(id: string, kind: AioDraftKind): Promise<string> {
  const { sb, project } = await owned(id);
  if (!AIO_DRAFT_KINDS.some((k) => k.kind === kind)) throw new Error("未対応の下書きです");
  const { data: latestRow } = await sb.from("aio_checks").select(AIO_CHECK_COLUMNS).eq("project_id", id).eq("status", "completed").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const latest = latestRow ? rowToCheck(latestRow as Record<string, unknown>) : null;
  const d = await draftAioContent(kind, project, latest);
  const { data, error } = await sb.from("aio_drafts").insert({ project_id: id, kind, title: d.title, body: d.body, guard: d.guard, status: "draft" }).select("id").single();
  if (error || !data) throw new Error(`下書きを保存できませんでした：${error?.message ?? ""}`);
  refresh(id);
  return data.id as string;
}

export async function markAioDraftDoneAction(id: string, draftId: string, done: boolean) {
  const { sb } = await owned(id);
  await sb.from("aio_drafts").update({ status: done ? "done" : "draft", updated_at: new Date().toISOString() }).eq("id", draftId).eq("project_id", id);
  refresh(id);
}

export async function deleteAioDraftAction(id: string, draftId: string) {
  const { sb } = await owned(id);
  await sb.from("aio_drafts").delete().eq("id", draftId).eq("project_id", id);
  refresh(id);
}
