import type { SupabaseClient } from "@supabase/supabase-js";

export type LinkPageView = { url: string; title: string; links: string[]; fetched: boolean; error: string };
export type LinkSuggestionView = {
  id: string;
  from: string;
  to: string;
  similarity: number;
  probability: number | null;
  confidence: number | null;
  sentence: string;
  anchor: string;
  role: string;
  reason: string;
  judge: string;
  status: "pending" | "suggested" | "rejected" | "accepted" | "dismissed";
};

/** 画面用に読む（表が未作成＝マイグレーション前なら空） */
export async function loadLinkData(sb: SupabaseClient, projectId: string): Promise<{ pages: LinkPageView[]; suggestions: LinkSuggestionView[] }> {
  const [{ data: p }, { data: s }] = await Promise.all([
    sb.from("seo_link_pages").select("url, title, h1, links, fetched_at, error").eq("project_id", projectId).order("created_at").limit(200),
    sb.from("seo_link_suggestions").select("id, from_url, to_url, similarity, probability, confidence, sentence, anchor, role, reason, judge, status").eq("project_id", projectId).order("similarity", { ascending: false }).limit(400),
  ]);
  return {
    pages: ((p ?? []) as { url: string; title: string; h1: string; links: string[]; fetched_at: string | null; error: string }[]).map((r) => ({ url: r.url, title: r.title || r.h1 || r.url, links: r.links ?? [], fetched: !!r.fetched_at, error: r.error })),
    suggestions: ((s ?? []) as Record<string, unknown>[]).map((r) => ({
      id: r.id as string,
      from: r.from_url as string,
      to: r.to_url as string,
      similarity: Number(r.similarity ?? 0),
      probability: r.probability == null ? null : Number(r.probability),
      confidence: r.confidence == null ? null : Number(r.confidence),
      sentence: String(r.sentence ?? ""),
      anchor: String(r.anchor ?? ""),
      role: String(r.role ?? ""),
      reason: String(r.reason ?? ""),
      judge: String(r.judge ?? ""),
      status: r.status as LinkSuggestionView["status"],
    })),
  };
}
