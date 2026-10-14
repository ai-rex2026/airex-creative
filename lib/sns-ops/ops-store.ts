import type { SupabaseClient } from "@supabase/supabase-js";
import type { GuardVerdict } from "../types";
import type { ObservedX } from "./apify";
import { DEFAULT_X_CONFIG, engagementRate, type InboxMessage, type ObservedPost, type OpsPost, type PatternReport, type XOpsConfig } from "./ops-types";
import type { SnsPlatform } from "../social-connect/platforms";

/** 運用（sns_posts の拡張列・sns_observed_posts・sns_patterns・sns_inbox・sns_ops_settings）の読み書き */

export const OPS_POST_COLUMNS =
  "id, platform, kind, topic, body, thread, hashtags, media, pattern, reason, target, guard, status, source, published_via, external_id, external_ids, scheduled_at, approved_at, published_at, error_message, metrics, created_at";
export const OBSERVED_COLUMNS = "id, source, external_id, author, author_name, author_followers, text, url, media, likes, reposts, replies, quotes, views, bookmarks, mentions_me, posted_at";

const strs = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);

export function rowToOpsPost(r: Record<string, unknown>): OpsPost {
  const ext = strs(r.external_ids);
  return {
    id: String(r.id),
    platform: String(r.platform) as SnsPlatform,
    kind: (["post", "reply", "quote", "repost", "dm"].includes(String(r.kind)) ? r.kind : "post") as OpsPost["kind"],
    topic: String(r.topic ?? ""),
    body: String(r.body ?? ""),
    thread: strs(r.thread),
    hashtags: strs(r.hashtags),
    media: Array.isArray(r.media) ? (r.media as OpsPost["media"]) : [],
    pattern: String(r.pattern ?? ""),
    reason: String(r.reason ?? ""),
    target: (r.target as OpsPost["target"]) ?? null,
    guard: (r.guard as GuardVerdict | null) ?? null,
    status: (["draft", "approved", "published", "skipped", "failed"].includes(String(r.status)) ? r.status : "draft") as OpsPost["status"],
    source: r.source === "auto" ? "auto" : "manual",
    publishedVia: (r.published_via as string | null) ?? null,
    externalIds: ext.length ? ext : r.external_id ? [String(r.external_id)] : [],
    scheduledAt: (r.scheduled_at as string | null) ?? null,
    approvedAt: (r.approved_at as string | null) ?? null,
    publishedAt: (r.published_at as string | null) ?? null,
    errorMessage: (r.error_message as string | null) ?? null,
    metrics: (r.metrics as OpsPost["metrics"]) ?? null,
    createdAt: String(r.created_at),
  };
}

export function rowToObserved(r: Record<string, unknown>): ObservedPost {
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const p = {
    id: String(r.id),
    source: (r.source as ObservedPost["source"]) ?? "bench",
    externalId: String(r.external_id),
    author: String(r.author ?? ""),
    authorName: String(r.author_name ?? ""),
    authorFollowers: n(r.author_followers),
    text: String(r.text ?? ""),
    url: String(r.url ?? ""),
    media: Array.isArray(r.media) ? (r.media as ObservedPost["media"]) : [],
    likes: n(r.likes),
    reposts: n(r.reposts),
    replies: n(r.replies),
    quotes: n(r.quotes),
    views: n(r.views),
    bookmarks: n(r.bookmarks),
    mentionsMe: r.mentions_me === true,
    postedAt: (r.posted_at as string | null) ?? null,
    rate: null as number | null,
  };
  p.rate = engagementRate(p);
  return p;
}

export function rowToPatternReport(r: Record<string, unknown>): PatternReport {
  const b = (r.body as Record<string, unknown>) ?? {};
  return {
    id: String(r.id),
    summary: String(b.summary ?? ""),
    patterns: Array.isArray(b.patterns) ? (b.patterns as PatternReport["patterns"]) : [],
    ownLearnings: Array.isArray(b.ownLearnings) ? (b.ownLearnings as PatternReport["ownLearnings"]) : [],
    createdAt: String(r.created_at),
  };
}

export function rowToInbox(r: Record<string, unknown>): InboxMessage {
  return {
    id: String(r.id),
    externalId: String(r.external_id),
    conversationId: String(r.conversation_id ?? ""),
    senderId: String(r.sender_id ?? ""),
    senderName: String(r.sender_name ?? ""),
    fromMe: r.from_me === true,
    text: String(r.text ?? ""),
    sentAt: (r.sent_at as string | null) ?? null,
  };
}

export async function loadXConfig(sb: SupabaseClient, userId: string): Promise<{ enabled: boolean; config: XOpsConfig }> {
  const { data } = await sb.from("sns_ops_settings").select("enabled, config").eq("user_id", userId).eq("platform", "x").maybeSingle();
  const c = ((data?.config as Partial<XOpsConfig>) ?? {}) as Partial<XOpsConfig>;
  return {
    enabled: data?.enabled === true,
    config: {
      benchHandles: strs(c.benchHandles),
      keywords: strs(c.keywords),
      dailyDrafts: typeof c.dailyDrafts === "number" ? Math.max(0, Math.min(10, c.dailyDrafts)) : DEFAULT_X_CONFIG.dailyDrafts,
      dailyEngage: typeof c.dailyEngage === "number" ? Math.max(0, Math.min(10, c.dailyEngage)) : DEFAULT_X_CONFIG.dailyEngage,
      rules: typeof c.rules === "string" ? c.rules : "",
    },
  };
}

/** 集めた投稿を保存する（同じ投稿は数字だけ新しくする） */
export async function saveObserved(sb: SupabaseClient, userId: string, source: "bench" | "search" | "own", items: ObservedX[], myHandle: string | null) {
  if (!items.length) return 0;
  const me = (myHandle ?? "").toLowerCase();
  const rows = items.map((x) => ({
    user_id: userId,
    platform: "x",
    source,
    external_id: x.externalId,
    author: x.author,
    author_name: x.authorName,
    author_followers: x.authorFollowers,
    text: x.text.slice(0, 2000),
    url: x.url.slice(0, 400),
    media: x.media,
    likes: x.likes,
    reposts: x.reposts,
    replies: x.replies,
    quotes: x.quotes,
    views: x.views,
    bookmarks: x.bookmarks,
    is_reply: x.isReply,
    conversation_id: x.conversationId,
    mentions_me: !!me && x.text.toLowerCase().includes(`@${me}`),
    posted_at: x.postedAt,
    fetched_at: new Date().toISOString(),
  }));
  const { error } = await sb.from("sns_observed_posts").upsert(rows, { onConflict: "user_id,platform,external_id" });
  if (error) throw new Error(`集めた投稿を保存できませんでした：${error.message}`);
  return rows.length;
}
