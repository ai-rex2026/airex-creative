import type { SupabaseClient } from "@supabase/supabase-js";
import { rowToKeyword, type SeoKeyword } from "./keywords";

/** 画面用に読む（表が未作成＝マイグレーション前なら空） */
export async function loadKeywords(sb: SupabaseClient, projectId: string): Promise<SeoKeyword[]> {
  const { data } = await sb.from("seo_keywords").select("*").eq("project_id", projectId).limit(500);
  return ((data ?? []) as Record<string, unknown>[]).map(rowToKeyword);
}
