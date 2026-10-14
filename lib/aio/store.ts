import type { SupabaseClient } from "@supabase/supabase-js";
import type { GuardVerdict, Industry } from "../types";
import type { AioCheck, AioContentPlan, AioDraft, AioDraftKind, AioGapReport, AioPlanItem, AioProject, AioPrompt } from "./types";

/** aio_projects / aio_checks / aio_drafts の行 → 画面の型 */

export const AIO_PROJECT_COLUMNS = "id, name, aliases, url, industry, area, category, notes, site_summary, monitoring_enabled, created_at";
export const AIO_PROMPT_COLUMNS = "id, text, category, active, created_at";
export const AIO_CHECK_COLUMNS = "id, prompt_id, source, status, engine, model, prompt, mentioned, rank, listed, cited_sources, own_source_domains, raw_answer, search_queries, error_message, created_at, completed_at";
export const AIO_DRAFT_COLUMNS = "id, kind, title, body, guard, status, created_at";

const strs = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);

export function rowToProject(r: Record<string, unknown>): AioProject {
  return {
    id: String(r.id),
    name: String(r.name ?? ""),
    aliases: strs(r.aliases),
    url: (r.url as string | null) ?? null,
    industry: (r.industry as Industry) ?? "general",
    area: String(r.area ?? ""),
    category: String(r.category ?? ""),
    notes: String(r.notes ?? ""),
    siteSummary: String(r.site_summary ?? ""),
    monitoringEnabled: !!r.monitoring_enabled,
    createdAt: String(r.created_at),
  };
}

export function rowToPrompt(r: Record<string, unknown>): AioPrompt {
  const cats = ["issue", "recommend", "compare", "track_record", "select", "trust", "recruit"];
  return {
    id: String(r.id),
    text: String(r.text ?? ""),
    category: (cats.includes(String(r.category)) ? String(r.category) : "recommend") as AioPrompt["category"],
    active: r.active !== false,
    createdAt: String(r.created_at),
  };
}

export function rowToCheck(r: Record<string, unknown>): AioCheck {
  return {
    id: String(r.id),
    promptId: (r.prompt_id as string | null) ?? null,
    source: r.source === "monthly" ? "monthly" : "manual",
    status: (r.status as AioCheck["status"]) ?? "pending",
    engine: String(r.engine ?? ""),
    model: String(r.model ?? ""),
    prompt: String(r.prompt ?? ""),
    mentioned: !!r.mentioned,
    rank: typeof r.rank === "number" ? r.rank : null,
    listed: strs(r.listed),
    citedSources: Array.isArray(r.cited_sources) ? (r.cited_sources as AioCheck["citedSources"]) : [],
    ownSourceDomains: strs(r.own_source_domains),
    rawAnswer: String(r.raw_answer ?? ""),
    searchQueries: strs(r.search_queries),
    errorMessage: (r.error_message as string | null) ?? null,
    createdAt: String(r.created_at),
    completedAt: (r.completed_at as string | null) ?? null,
  };
}

export function rowToDraft(r: Record<string, unknown>): AioDraft {
  return {
    id: String(r.id),
    kind: r.kind as AioDraftKind,
    title: String(r.title ?? ""),
    body: String(r.body ?? ""),
    guard: (r.guard as GuardVerdict | null) ?? null,
    status: r.status === "done" ? "done" : "draft",
    createdAt: String(r.created_at),
  };
}

export function rowToGap(r: Record<string, unknown>): AioGapReport {
  const b = (r.body as Record<string, unknown>) ?? {};
  return {
    id: String(r.id),
    period: String(r.period ?? ""),
    summary: String(b.summary ?? ""),
    gaps: Array.isArray(b.gaps) ? (b.gaps as AioGapReport["gaps"]) : [],
    mediaTargets: Array.isArray(b.mediaTargets) ? (b.mediaTargets as AioGapReport["mediaTargets"]) : [],
    createdAt: String(r.created_at),
  };
}

export function rowToPlan(r: Record<string, unknown>): AioContentPlan {
  return { id: String(r.id), month: String(r.month ?? ""), items: Array.isArray(r.items) ? (r.items as AioPlanItem[]) : [], createdAt: String(r.created_at) };
}

export async function listProjects(sb: SupabaseClient, ownerId: string): Promise<AioProject[]> {
  const { data } = await sb.from("aio_projects").select(AIO_PROJECT_COLUMNS).eq("owner_id", ownerId).order("created_at", { ascending: false });
  return ((data ?? []) as Record<string, unknown>[]).map(rowToProject);
}

export async function loadProject(
  sb: SupabaseClient,
  id: string
): Promise<{ project: AioProject; checks: AioCheck[]; drafts: AioDraft[]; prompts: AioPrompt[]; gap: AioGapReport | null; plans: AioContentPlan[] } | null> {
  const { data } = await sb.from("aio_projects").select(AIO_PROJECT_COLUMNS).eq("id", id).maybeSingle();
  if (!data) return null;
  const [{ data: checks }, { data: drafts }, { data: prompts }, { data: gap }, { data: plans }] = await Promise.all([
    // 月次で最大20本×数か月ぶんを集計するので、多めに持つ（raw_answer は長いが集計には使わない）
    sb.from("aio_checks").select(AIO_CHECK_COLUMNS).eq("project_id", id).order("created_at", { ascending: false }).limit(240),
    sb.from("aio_drafts").select(AIO_DRAFT_COLUMNS).eq("project_id", id).order("created_at", { ascending: false }).limit(40),
    sb.from("aio_prompts").select(AIO_PROMPT_COLUMNS).eq("project_id", id).order("created_at", { ascending: true }),
    sb.from("aio_gap_reports").select("id, period, body, created_at").eq("project_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    sb.from("aio_content_plans").select("id, month, items, created_at").eq("project_id", id).order("month", { ascending: false }).limit(3),
  ]);
  return {
    project: rowToProject(data as Record<string, unknown>),
    checks: ((checks ?? []) as Record<string, unknown>[]).map(rowToCheck),
    drafts: ((drafts ?? []) as Record<string, unknown>[]).map(rowToDraft),
    prompts: ((prompts ?? []) as Record<string, unknown>[]).map(rowToPrompt),
    gap: gap ? rowToGap(gap as Record<string, unknown>) : null,
    plans: ((plans ?? []) as Record<string, unknown>[]).map(rowToPlan),
  };
}
