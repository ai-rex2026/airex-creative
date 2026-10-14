import type { SupabaseClient } from "@supabase/supabase-js";
import type { SnsPlatform } from "../social-connect/platforms";
import type { GuardVerdict, Industry } from "../types";
import { DEFAULT_SNS_SETTINGS, type SnsPost, type SnsSettings } from "./types";

/** sns_posts / sns_settings の読み書き。本人のセッション（RLS）でも service role でも同じ形で使う */

export const SNS_POST_COLUMNS = "id, topic_id, platform, topic, body, hashtags, guard, status, source, published_via, external_id, error_message, published_at, created_at";

export type SnsPostRow = {
  id: string;
  topic_id: string;
  platform: string;
  topic: string;
  body: string;
  hashtags: unknown;
  guard: unknown;
  status: string;
  source: string;
  published_via: string | null;
  external_id: string | null;
  error_message: string | null;
  published_at: string | null;
  created_at: string;
};

export function rowToPost(r: SnsPostRow): SnsPost {
  return {
    id: r.id,
    topicId: r.topic_id,
    platform: r.platform as SnsPlatform,
    topic: r.topic,
    body: r.body,
    hashtags: Array.isArray(r.hashtags) ? (r.hashtags as unknown[]).map(String) : [],
    guard: (r.guard as GuardVerdict | null) ?? null,
    status: (r.status as SnsPost["status"]) ?? "draft",
    source: r.source === "auto" ? "auto" : "manual",
    publishedVia: (r.published_via as SnsPost["publishedVia"]) ?? null,
    externalId: r.external_id,
    errorMessage: r.error_message,
    publishedAt: r.published_at,
    createdAt: r.created_at,
  };
}

export async function listPosts(sb: SupabaseClient, userId: string, limit = 60): Promise<SnsPost[]> {
  // 媒体ごとの運用（source が ops / ops_auto）の案は、それぞれの運用画面で扱う
  const { data } = await sb.from("sns_posts").select(SNS_POST_COLUMNS).eq("user_id", userId).in("source", ["manual", "auto"]).order("created_at", { ascending: false }).limit(limit);
  return ((data ?? []) as SnsPostRow[]).map(rowToPost);
}

export async function loadSettings(sb: SupabaseClient, userId: string): Promise<SnsSettings> {
  const { data } = await sb.from("sns_settings").select("auto_enabled, auto_weekday, brand_name, brand_url, brand_notes, industry").eq("user_id", userId).maybeSingle();
  if (!data) return DEFAULT_SNS_SETTINGS;
  return {
    autoEnabled: !!data.auto_enabled,
    autoWeekday: Number(data.auto_weekday ?? 1),
    brandName: String(data.brand_name ?? ""),
    brandUrl: String(data.brand_url ?? ""),
    brandNotes: String(data.brand_notes ?? ""),
    industry: (data.industry as Industry) ?? "general",
  };
}

export async function saveSettings(sb: SupabaseClient, userId: string, s: SnsSettings) {
  const { error } = await sb.from("sns_settings").upsert({
    user_id: userId,
    auto_enabled: s.autoEnabled,
    auto_weekday: Math.min(6, Math.max(0, Math.round(s.autoWeekday))),
    brand_name: s.brandName.slice(0, 200),
    brand_url: s.brandUrl.slice(0, 500) || null,
    brand_notes: s.brandNotes.slice(0, 2000),
    industry: s.industry,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`設定を保存できませんでした：${error.message}`);
}

/** 生成した投稿案を保存する（1テーマ＝複数媒体の行を同じ topic_id でまとめる） */
export async function insertDrafts(
  sb: SupabaseClient,
  userId: string,
  topic: string,
  drafts: { platform: SnsPlatform; body: string; hashtags: string[]; guard: GuardVerdict }[],
  source: "manual" | "auto"
): Promise<string> {
  const topicId = crypto.randomUUID();
  const { error } = await sb.from("sns_posts").insert(
    drafts.map((d) => ({ user_id: userId, topic_id: topicId, platform: d.platform, topic: topic.slice(0, 600), body: d.body, hashtags: d.hashtags, guard: d.guard, status: "draft", source }))
  );
  if (error) throw new Error(`投稿案を保存できませんでした：${error.message}`);
  return topicId;
}
