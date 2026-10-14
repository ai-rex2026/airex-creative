"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { AIO_PROJECT_COLUMNS, rowToCheck, rowToProject, AIO_CHECK_COLUMNS } from "@/lib/aio/store";
import { buildAioPrompt, createCheck, runCheck } from "@/lib/aio/run";
import { suggestPrompts } from "@/lib/aio/prompts";
import { analyzeGap, planMonth } from "@/lib/aio/gap";
import { jstPeriodKey } from "@/lib/meo-ops/daily";
import { draftAioContent, suggestProjectFacts } from "@/lib/aio/writer";
import { AIO_DRAFT_KINDS, AIO_PROMPT_CATEGORY_LABEL, MAX_ACTIVE_PROMPTS, type AioDraftKind, type AioPlanItem, type AioProject, type AioPromptCategory } from "@/lib/aio/types";
import { AIO_PROMPT_COLUMNS, rowToGap, rowToPrompt } from "@/lib/aio/store";
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
  const created = await createCheck(admin, id, buildAioPrompt(project.area, project.category));
  after(async () => {
    await runCheck(createAdminClient(), created.checkId, { name: project.name, aliases: project.aliases }).catch(() => undefined);
  });
  refresh(id);
  return created;
}

// ── 対策プロンプト（Prompt Design）と月次モニタリング ─────────────────────

/** AI にプロンプト案を20本考えさせる（保存はしない。人が選ぶ） */
export async function suggestAioPromptsAction(id: string) {
  const { sb, project } = await owned(id);
  const { data } = await sb.from("aio_prompts").select("text").eq("project_id", id);
  return suggestPrompts(project, (data ?? []).map((r) => String(r.text)));
}

export async function addAioPromptsAction(id: string, items: { text: string; category: string }[]) {
  const { sb } = await owned(id);
  const { count } = await sb.from("aio_prompts").select("id", { count: "exact", head: true }).eq("project_id", id).eq("active", true);
  const room = MAX_ACTIVE_PROMPTS - (count ?? 0);
  if (room <= 0) throw new Error(`対策プロンプトは ${MAX_ACTIVE_PROMPTS} 本までです。使わないものを外してください`);
  const cats = Object.keys(AIO_PROMPT_CATEGORY_LABEL);
  const rows = items
    .map((i) => ({ project_id: id, text: String(i.text ?? "").trim().slice(0, 120), category: cats.includes(i.category) ? i.category : "recommend", active: true }))
    .filter((r) => r.text)
    .slice(0, room);
  if (!rows.length) throw new Error("追加するプロンプトがありません");
  const { error } = await sb.from("aio_prompts").insert(rows);
  if (error) throw new Error(`追加できませんでした：${error.message}`);
  refresh(id);
  return rows.length;
}

export async function updateAioPromptAction(id: string, promptId: string, patch: { text?: string; category?: AioPromptCategory; active?: boolean }) {
  const { sb } = await owned(id);
  const upd: Record<string, unknown> = {};
  if (patch.text !== undefined) upd.text = patch.text.trim().slice(0, 120);
  if (patch.category !== undefined) upd.category = patch.category;
  if (patch.active !== undefined) upd.active = patch.active;
  const { error } = await sb.from("aio_prompts").update(upd).eq("id", promptId).eq("project_id", id);
  if (error) throw new Error(`保存できませんでした：${error.message}`);
  refresh(id);
}

export async function deleteAioPromptAction(id: string, promptId: string) {
  const { sb } = await owned(id);
  await sb.from("aio_prompts").delete().eq("id", promptId).eq("project_id", id);
  refresh(id);
}

export async function setAioMonitoringAction(id: string, enabled: boolean) {
  const { sb } = await owned(id);
  const { error } = await sb.from("aio_projects").update({ monitoring_enabled: enabled, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(`保存できませんでした：${error.message}`);
  refresh(id);
}

/**
 * 有効な対策プロンプトを全部いま実測する（手動の月次上限を消費。足りない分は受け付けない）。
 * 受け付けた分は pending で並び、最初の2件だけ応答後に走らせ、残りは /api/cron/aio-pending が10分おきに拾う
 */
export async function runAioPromptsNowAction(id: string): Promise<{ accepted: number; skipped: number; remaining: number }> {
  const { sb, project } = await owned(id);
  const { data } = await sb.from("aio_prompts").select(AIO_PROMPT_COLUMNS).eq("project_id", id).eq("active", true).order("created_at", { ascending: true });
  const prompts = ((data ?? []) as Record<string, unknown>[]).map(rowToPrompt);
  if (!prompts.length) throw new Error("対策プロンプトを先に登録してください");
  const admin = createAdminClient();
  const ids: string[] = [];
  let remaining = 0;
  let skipped = 0;
  for (const p of prompts) {
    try {
      const c = await createCheck(admin, id, p.text, { promptId: p.id, source: "manual" });
      ids.push(c.checkId);
      remaining = c.remaining;
    } catch {
      skipped++;
    }
  }
  if (!ids.length) throw new Error("今月の実測の上限に達しています。翌月まではお待ちください");
  after(async () => {
    for (const cid of ids.slice(0, 2)) {
      await runCheck(createAdminClient(), cid, { name: project.name, aliases: project.aliases }).catch(() => undefined);
    }
  });
  refresh(id);
  return { accepted: ids.length, skipped, remaining };
}

/** 実行中のチェックの状態だけを読む（ポーリング用） */
export async function aioCheckStatusAction(id: string, checkId: string) {
  const { sb } = await owned(id);
  const { data } = await sb.from("aio_checks").select("status").eq("project_id", id).eq("id", checkId).maybeSingle();
  return (data?.status as string | undefined) ?? null;
}

/** 「何をすべきか」の下書きを1種類作る。plan を渡すと月次計画の項目（タイトル・構成）に沿って書き、計画側に下書きを紐付ける */
export async function generateAioDraftAction(id: string, kind: AioDraftKind, plan?: { planId: string; itemId: string }): Promise<string> {
  const { sb, project } = await owned(id);
  if (!AIO_DRAFT_KINDS.some((k) => k.kind === kind)) throw new Error("未対応の下書きです");
  const { data: latestRow } = await sb.from("aio_checks").select(AIO_CHECK_COLUMNS).eq("project_id", id).eq("status", "completed").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const latest = latestRow ? rowToCheck(latestRow as Record<string, unknown>) : null;

  let brief: { title: string; target: string; outline: string } | null = null;
  let items: AioPlanItem[] = [];
  if (plan) {
    const { data: p } = await sb.from("aio_content_plans").select("items").eq("id", plan.planId).eq("project_id", id).maybeSingle();
    items = Array.isArray(p?.items) ? (p!.items as AioPlanItem[]) : [];
    const it = items.find((i) => i.id === plan.itemId);
    if (!it) throw new Error("計画の項目が見つかりません");
    brief = { title: it.title, target: it.target, outline: it.outline };
  }

  const d = await draftAioContent(kind, project, latest, brief);
  const { data, error } = await sb.from("aio_drafts").insert({ project_id: id, kind, title: d.title, body: d.body, guard: d.guard, status: "draft" }).select("id").single();
  if (error || !data) throw new Error(`下書きを保存できませんでした：${error?.message ?? ""}`);
  if (plan) {
    const next = items.map((i) => (i.id === plan.itemId ? { ...i, status: "drafted" as const, draftId: data.id as string } : i));
    await sb.from("aio_content_plans").update({ items: next, updated_at: new Date().toISOString() }).eq("id", plan.planId).eq("project_id", id);
  }
  refresh(id);
  return data.id as string;
}

// ── ギャップ分析と月次コンテンツ計画 ─────────────────────

export async function analyzeAioGapAction(id: string) {
  const { sb, project } = await owned(id);
  const [{ data: prompts }, { data: checks }] = await Promise.all([
    sb.from("aio_prompts").select(AIO_PROMPT_COLUMNS).eq("project_id", id),
    sb.from("aio_checks").select(AIO_CHECK_COLUMNS).eq("project_id", id).order("created_at", { ascending: false }).limit(120),
  ]);
  const ps = ((prompts ?? []) as Record<string, unknown>[]).map(rowToPrompt);
  const cs = ((checks ?? []) as Record<string, unknown>[]).map(rowToCheck);
  const r = await analyzeGap(project, ps, cs);
  const { error } = await sb.from("aio_gap_reports").insert({ project_id: id, period: jstPeriodKey(), body: r });
  if (error) throw new Error(`保存できませんでした：${error.message}`);
  refresh(id);
}

/** 来月（または指定月）のコンテンツ計画を作る。同じ月があれば置き換える */
export async function planAioMonthAction(id: string, month?: string) {
  const { sb, project } = await owned(id);
  const target = month && /^\d{4}-\d{2}$/.test(month) ? month : nextMonth();
  const [{ data: prompts }, { data: checks }, { data: gap }] = await Promise.all([
    sb.from("aio_prompts").select(AIO_PROMPT_COLUMNS).eq("project_id", id),
    sb.from("aio_checks").select(AIO_CHECK_COLUMNS).eq("project_id", id).order("created_at", { ascending: false }).limit(120),
    sb.from("aio_gap_reports").select("id, period, body, created_at").eq("project_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const items = await planMonth(
    project,
    ((prompts ?? []) as Record<string, unknown>[]).map(rowToPrompt),
    ((checks ?? []) as Record<string, unknown>[]).map(rowToCheck),
    gap ? rowToGap(gap as Record<string, unknown>) : null,
    target
  );
  const { error } = await sb.from("aio_content_plans").upsert({ project_id: id, month: target, items, updated_at: new Date().toISOString() }, { onConflict: "project_id,month" });
  if (error) throw new Error(`保存できませんでした：${error.message}`);
  refresh(id);
  return target;
}

export async function updateAioPlanItemAction(id: string, planId: string, itemId: string, patch: Partial<Pick<AioPlanItem, "status" | "title" | "week">>) {
  const { sb } = await owned(id);
  const { data: p } = await sb.from("aio_content_plans").select("items").eq("id", planId).eq("project_id", id).maybeSingle();
  const items = Array.isArray(p?.items) ? (p!.items as AioPlanItem[]) : [];
  const next = items.map((i) => (i.id === itemId ? { ...i, ...patch } : i));
  await sb.from("aio_content_plans").update({ items: next, updated_at: new Date().toISOString() }).eq("id", planId).eq("project_id", id);
  refresh(id);
}

export async function removeAioPlanItemAction(id: string, planId: string, itemId: string) {
  const { sb } = await owned(id);
  const { data: p } = await sb.from("aio_content_plans").select("items").eq("id", planId).eq("project_id", id).maybeSingle();
  const items = Array.isArray(p?.items) ? (p!.items as AioPlanItem[]) : [];
  await sb.from("aio_content_plans").update({ items: items.filter((i) => i.id !== itemId), updated_at: new Date().toISOString() }).eq("id", planId).eq("project_id", id);
  refresh(id);
}

function nextMonth(): string {
  const cur = jstPeriodKey();
  const [y, m] = cur.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
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
