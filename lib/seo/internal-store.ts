import type { SupabaseClient } from "@supabase/supabase-js";
import { rowToTask, type InternalTask } from "./internal";

/** 画面用に読む（表が未作成＝マイグレーション前なら空） */
export async function loadInternalTasks(sb: SupabaseClient, projectId: string): Promise<InternalTask[]> {
  const { data } = await sb.from("seo_internal_tasks").select("*").eq("project_id", projectId).order("created_at", { ascending: true }).limit(300);
  return ((data ?? []) as Record<string, unknown>[]).map(rowToTask);
}
