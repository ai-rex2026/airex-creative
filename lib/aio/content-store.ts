import type { SupabaseClient } from "@supabase/supabase-js";
import type { GuardVerdict } from "../types";
import type { AioArticle, AioArticleImage, AioChannel, AioChannelKind, AioContentReview, AioMetric, AioWpInfo } from "./content-types";

/** aio_channels / aio_articles / aio_article_metrics / aio_content_reviews の行 → 画面の型 */

export const CHANNEL_COLUMNS = "id, kind, source_url, has_source, style, samples, analyzed_at, strategy, analytics";
export const ARTICLE_COLUMNS =
  "id, channel, title, slug, meta_description, keywords, target, body_md, hashtags, images, guard, status, wp_post_id, published_url, published_at, error_message, created_at";
export const METRIC_COLUMNS = "id, channel, article_id, url, title, source, period_from, period_to, views, clicks, impressions, position, engagement_sec, likes, comments, queries, created_at";

const strs = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
const numOrNull = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

export function rowToChannel(r: Record<string, unknown>): AioChannel {
  return {
    id: String(r.id),
    kind: r.kind === "note" ? "note" : "site",
    sourceUrl: (r.source_url as string | null) ?? null,
    hasSource: r.has_source !== false,
    style: (r.style as AioChannel["style"]) ?? null,
    samples: Array.isArray(r.samples) ? (r.samples as AioChannel["samples"]) : [],
    analyzedAt: (r.analyzed_at as string | null) ?? null,
    strategy: (r.strategy as AioChannel["strategy"]) ?? null,
    analytics: (r.analytics as AioChannel["analytics"]) ?? null,
  };
}

export function rowToArticle(r: Record<string, unknown>): AioArticle {
  return {
    id: String(r.id),
    channel: r.channel === "note" ? "note" : "site",
    title: String(r.title ?? ""),
    slug: String(r.slug ?? ""),
    metaDescription: String(r.meta_description ?? ""),
    keywords: strs(r.keywords),
    target: String(r.target ?? ""),
    bodyMd: String(r.body_md ?? ""),
    hashtags: strs(r.hashtags),
    images: Array.isArray(r.images) ? (r.images as AioArticleImage[]) : [],
    guard: (r.guard as GuardVerdict | null) ?? null,
    status: r.status === "published" ? "published" : "draft",
    wpPostId: numOrNull(r.wp_post_id),
    publishedUrl: (r.published_url as string | null) ?? null,
    publishedAt: (r.published_at as string | null) ?? null,
    errorMessage: (r.error_message as string | null) ?? null,
    createdAt: String(r.created_at),
  };
}

export function rowToMetric(r: Record<string, unknown>): AioMetric {
  return {
    id: String(r.id),
    channel: r.channel === "note" ? "note" : "site",
    articleId: (r.article_id as string | null) ?? null,
    url: String(r.url ?? ""),
    title: String(r.title ?? ""),
    source: (r.source as AioMetric["source"]) ?? "gsc",
    periodFrom: (r.period_from as string | null) ?? null,
    periodTo: (r.period_to as string | null) ?? null,
    views: numOrNull(r.views),
    clicks: numOrNull(r.clicks),
    impressions: numOrNull(r.impressions),
    position: numOrNull(r.position),
    engagementSec: numOrNull(r.engagement_sec),
    likes: numOrNull(r.likes),
    comments: numOrNull(r.comments),
    queries: Array.isArray(r.queries) ? (r.queries as AioMetric["queries"]) : [],
    createdAt: String(r.created_at),
  };
}

export function rowToReview(r: Record<string, unknown>): AioContentReview {
  const b = (r.body as Record<string, unknown>) ?? {};
  return {
    id: String(r.id),
    channel: r.channel === "note" ? "note" : "site",
    summary: String(b.summary ?? ""),
    working: Array.isArray(b.working) ? (b.working as AioContentReview["working"]) : [],
    fixes: Array.isArray(b.fixes) ? (b.fixes as AioContentReview["fixes"]) : [],
    next: Array.isArray(b.next) ? (b.next as AioContentReview["next"]) : [],
    createdAt: String(r.created_at),
  };
}

export type ContentData = {
  channels: Partial<Record<AioChannelKind, AioChannel>>;
  articles: AioArticle[];
  metrics: AioMetric[];
  reviews: Partial<Record<AioChannelKind, AioContentReview>>;
  wp: AioWpInfo | null;
};

/** 画面用にまとめて読む。sb は本人のセッション、admin は WordPress の接続（秘密を除いた列）と画像の署名に使う */
export async function loadContent(sb: SupabaseClient, admin: SupabaseClient, projectId: string): Promise<ContentData> {
  const [{ data: chs }, { data: arts }, { data: mets }, { data: revs }, { data: wp }] = await Promise.all([
    sb.from("aio_channels").select(CHANNEL_COLUMNS).eq("project_id", projectId),
    sb.from("aio_articles").select(ARTICLE_COLUMNS).eq("project_id", projectId).order("created_at", { ascending: false }).limit(60),
    sb.from("aio_article_metrics").select(METRIC_COLUMNS).eq("project_id", projectId).order("created_at", { ascending: false }).limit(400),
    sb.from("aio_content_reviews").select("id, channel, body, created_at").eq("project_id", projectId).order("created_at", { ascending: false }).limit(6),
    admin.from("aio_wp_connections").select("base_url, wp_user, site_name, category_id, verified_at").eq("project_id", projectId).maybeSingle(),
  ]);
  const channels: ContentData["channels"] = {};
  for (const r of (chs ?? []) as Record<string, unknown>[]) {
    const c = rowToChannel(r);
    channels[c.kind] = c;
  }
  const reviews: ContentData["reviews"] = {};
  for (const r of (revs ?? []) as Record<string, unknown>[]) {
    const v = rowToReview(r);
    if (!reviews[v.channel]) reviews[v.channel] = v;
  }
  return {
    channels,
    articles: ((arts ?? []) as Record<string, unknown>[]).map(rowToArticle),
    metrics: ((mets ?? []) as Record<string, unknown>[]).map(rowToMetric),
    reviews,
    wp: wp
      ? { baseUrl: String(wp.base_url), wpUser: String(wp.wp_user), siteName: String(wp.site_name ?? ""), categoryId: (wp.category_id as number | null) ?? null, verifiedAt: (wp.verified_at as string | null) ?? null }
      : null,
  };
}
