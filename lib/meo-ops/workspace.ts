import type { SupabaseClient } from "@supabase/supabase-js";
import type { MeoScan } from "../meo";
import type { GuardHit } from "../types";
import type { SiteScan } from "../site-scan";
import { buildStoreSnapshot, hostOf, searchCandidatesWithSite } from "./places";
import { writeDaily } from "./daily";
import {
  DEFAULT_AI_REPLY_SETTINGS,
  DEFAULT_NOTIFICATION_SETTINGS,
  EMPTY_PROFILE_DRAFT,
  buildPhotoOverview,
  buildProfileChecklist,
} from "./logic";
import type {
  AiContentSuggestion,
  AiSearchCheck,
  AiSearchSummary,
  AiSourcePlatform,
  MeoAiReplySettings,
  MeoDailyPoint,
  MeoFieldTopic,
  MeoMetric,
  MeoNotificationSettings,
  MeoPost,
  MeoProfileDraft,
  MeoReview,
  MeoStoreSnapshot,
  MeoSuggestion,
  MeoWorkspaceData,
  ReviewReplyStatus,
  StoreCandidate,
} from "./types";

/** ワークスペースが読む分析の列 */
export type MeoAnalysisRow = {
  id: string;
  owner_id: string;
  url: string | null;
  site: SiteScan | null;
  meo: MeoScan | null;
  meo_place_id: string | null;
  meo_place_source: "auto" | "manual" | null;
  meo_store: MeoStoreSnapshot | null;
  meo_store_candidates: StoreCandidate[] | null;
  meo_gbp_location: string | null;
};

export const MEO_ANALYSIS_COLUMNS =
  "id, owner_id, url, site, meo, meo_place_id, meo_place_source, meo_store, meo_store_candidates, meo_gbp_location";

/** 日次グラフの表示日数 */
export const DAILY_TREND_DAYS = 30;
/** AI検索の履歴として持つ件数 */
const AI_CHECK_HISTORY_LIMIT = 20;

// ── 行 → 画面の型 ──────────────────────────────
const arr = <T = Record<string, unknown>>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const strs = (v: unknown): string[] => arr<unknown>(v).filter((x): x is string => typeof x === "string");
const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);
const num = (v: unknown): number | null => (typeof v === "number" ? v : typeof v === "string" && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : null);

function toReplyStatus(v: unknown): ReviewReplyStatus {
  if (v === "replied" || v === "pending" || v === "failed") return v as ReviewReplyStatus;
  if (v === "needs_update") return "needsUpdate";
  return "unreplied";
}

export function rowToReview(r: Record<string, unknown>): MeoReview {
  return {
    id: str(r.id),
    authorName: str(r.author_name),
    rating: num(r.rating) ?? 0,
    text: str(r.text),
    createdAt: str(r.reviewed_at) || str(r.created_at),
    status: toReplyStatus(r.reply_status),
    reply: typeof r.reply === "string" ? r.reply : null,
    repliedAt: typeof r.replied_at === "string" ? r.replied_at : null,
    aioScore: num(r.aio_score),
    errorMessage: typeof r.error_message === "string" ? r.error_message : null,
  };
}

function rowToPost(r: Record<string, unknown>): MeoPost {
  const b = r.action_button as { label?: string; url?: string } | null;
  const status = (r.status === "scheduled" || r.status === "published" ? r.status : "draft") as MeoPost["status"];
  return {
    id: str(r.id),
    title: str(r.title),
    body: str(r.body),
    status,
    scheduledAt: typeof r.scheduled_at === "string" ? r.scheduled_at : null,
    publishedAt: typeof r.published_at === "string" ? r.published_at : null,
    imageUrl: typeof r.image_url === "string" ? r.image_url : null,
    actionButton: b ? { label: b.label ?? "", url: b.url ?? "" } : null,
    aiGenerated: r.ai_generated === true,
    errorMessage: typeof r.error_message === "string" ? r.error_message : null,
  };
}

function rowToMetrics(r: Record<string, unknown> | null) {
  if (!r) return { period: null, metrics: [] as MeoMetric[], fieldTopics: [] as MeoFieldTopic[], suggestions: [] as MeoSuggestion[] };
  return {
    period: str(r.period) || null,
    metrics: arr(r.metrics).map((m) => ({
      key: str(m.key),
      label: str(m.label),
      value: num(m.value),
      unit: str(m.unit),
      changeRate: num(m.change_rate),
      higherIsBetter: m.higher_is_better !== false,
    })),
    fieldTopics: arr(r.field_topics).map((t, i) => ({
      id: str(t.id) || `t${i}`,
      label: str(t.label),
      count: num(t.count) ?? 0,
      sentiment: t.sentiment === "negative" ? ("negative" as const) : ("positive" as const),
      quotes: strs(t.quotes),
    })),
    suggestions: arr(r.suggestions).map((s, i) => ({
      id: str(s.id) || `s${i}`,
      title: str(s.title),
      body: str(s.body),
      // 想定外の値を通すとラベル表が undefined になり画面ごと落ちる。既知以外は medium に倒す
      priority: (s.priority === "high" || s.priority === "low" ? s.priority : "medium") as MeoSuggestion["priority"],
      actionPath: typeof s.action_path === "string" ? s.action_path : null,
      actionLabel: typeof s.action_label === "string" ? s.action_label : null,
    })),
  };
}

function rowToDaily(r: Record<string, unknown>): MeoDailyPoint {
  return {
    date: str(r.date),
    meoScore: num(r.meo_score),
    reviewCount: num(r.review_count) ?? 0,
    newReviewCount: num(r.new_review_count),
    averageRating: num(r.average_rating),
  };
}

export function rowToCheck(r: Record<string, unknown>): AiSearchCheck {
  const status = (r.status === "completed" || r.status === "failed" || r.status === "running" ? r.status : "pending") as AiSearchCheck["status"];
  return {
    id: str(r.id),
    engine: r.engine === "gemini" ? "gemini" : "claude",
    model: str(r.model),
    status,
    queryArea: str(r.query_area),
    queryCategory: str(r.query_category),
    prompt: str(r.prompt),
    mentioned: r.mentioned === true,
    rank: num(r.rank),
    listedStores: strs(r.listed_stores),
    citedSources: arr(r.cited_sources).map((s) => ({ url: str(s.url), title: str(s.title), domain: str(s.domain) })),
    ownSourceDomains: strs(r.own_source_domains),
    rawAnswer: str(r.raw_answer),
    searchQueries: strs(r.search_queries),
    searchSuggestionsHtml: str(r.search_suggestions_html),
    errorMessage: typeof r.error_message === "string" ? r.error_message : null,
    executedAt: str(r.created_at),
  };
}

const EMPTY_SUMMARY: AiSearchSummary = {
  totalChecks: 0,
  mentionedChecks: 0,
  history: [],
  sources: [],
  suggestions: [],
  lastCheckedAt: null,
};

function rowToSummary(r: Record<string, unknown> | null): AiSearchSummary {
  if (!r) return EMPTY_SUMMARY;
  const technique = (v: unknown): AiContentSuggestion["technique"] =>
    v === "quotation" ? "quotation" : v === "cite_sources" ? "citeSources" : "statistics";
  const target = (v: unknown): AiContentSuggestion["target"] =>
    v === "gbp_post" ? "gbpPost" : v === "site_schema" ? "siteSchema" : "gbpDescription";
  const status = (v: unknown): AiSourcePlatform["status"] => (v === "listed" ? "listed" : v === "not_found" ? "notFound" : "unknown");
  return {
    totalChecks: num(r.total_checks) ?? 0,
    mentionedChecks: num(r.mentioned_checks) ?? 0,
    history: arr(r.history).map((h) => ({ checkId: str(h.check_id), date: str(h.date), mentioned: h.mentioned === true, rank: num(h.rank) })),
    sources: arr(r.sources).map((s) => ({
      key: str(s.key),
      label: str(s.name),
      usedBy: str(s.referenced_by),
      status: status(s.status),
      citedCount: num(s.citation_count) ?? 0,
      manageUrl: typeof s.register_url === "string" ? s.register_url : null,
    })),
    suggestions: arr(r.suggestions).map((s, i) => ({
      id: str(s.id) || `suggestion-${i}`,
      target: target(s.target),
      technique: technique(s.technique),
      title: str(s.title),
      body: str(s.body),
      sourceNote: str(s.source_note),
      guardHits: arr<GuardHit>(s.guard_hits),
    })),
    lastCheckedAt: typeof r.last_checked_at === "string" ? r.last_checked_at : null,
  };
}

function toAiReply(v: unknown): MeoAiReplySettings {
  const o = (v ?? {}) as Record<string, unknown>;
  const tone = (o.tone === "friendly" || o.tone === "formal" ? o.tone : DEFAULT_AI_REPLY_SETTINGS.tone) as MeoAiReplySettings["tone"];
  return {
    keywords: strs(o.keywords),
    tone,
    styleInstruction: str(o.style_instruction),
    ngWords: strs(o.ng_words),
    signature: str(o.signature),
  };
}

function toNotifications(v: unknown): MeoNotificationSettings {
  const o = (v ?? {}) as Record<string, unknown>;
  return {
    newReview: typeof o.new_review === "boolean" ? o.new_review : DEFAULT_NOTIFICATION_SETTINGS.newReview,
    editedReview: typeof o.edited_review === "boolean" ? o.edited_review : DEFAULT_NOTIFICATION_SETTINGS.editedReview,
    monthlyReport: typeof o.monthly_report === "boolean" ? o.monthly_report : DEFAULT_NOTIFICATION_SETTINGS.monthlyReport,
  };
}

function toProfile(v: unknown): MeoProfileDraft {
  const o = (v ?? {}) as Record<string, unknown>;
  if (!v) return EMPTY_PROFILE_DRAFT;
  const attrs = (o.attributes ?? {}) as Record<string, unknown>;
  return {
    description: str(o.description),
    paymentMethods: strs(o.payment_methods),
    attributes: Object.fromEntries(Object.entries(attrs).map(([k, val]) => [k, val === true])),
    storeName: str(o.store_name),
    phoneNumber: str(o.phone_number),
    address: str(o.address),
    websiteUrl: str(o.website_url),
  };
}

// ── 店舗の自動特定 ──────────────────────────────
/**
 * 初めて開いたときに一度だけ、どの店舗の運用画面かを決める。
 *
 * 分析時の MEO 実測（サイトのドメインと一致したプロフィール）が1件だけならそれを使う。
 * チェーン店は本社ドメインひとつに支店がぶら下がり URL からは判別できないので、
 * 機械が決め打ちせず候補を保存して人に選ばせる（別商圏のデータを毎日記録し続けないため）。
 */
export async function autoIdentifyStore(admin: SupabaseClient, a: MeoAnalysisRow): Promise<MeoAnalysisRow> {
  if (a.meo_place_id || a.meo_store_candidates) return a;

  const ourHost = hostOf(a.url) || hostOf(a.site?.finalUrl);
  const self = a.meo?.self ?? null;
  const siteName = a.site?.bizName || (a.site?.title ?? "").split(/[|｜\-–—:：]/).map((s) => s.trim()).filter(Boolean).pop() || "";
  const query = self ? `${self.name} ${self.address}`.trim() : [siteName, a.site?.bizAddress ?? ""].join(" ").trim();

  let candidates: (StoreCandidate & { website: string | null })[] = [];
  if (query) candidates = await searchCandidatesWithSite(query).catch(() => []);
  const matched = ourHost ? candidates.filter((c) => hostOf(c.website) === ourHost) : [];
  const single = (a.meo?.stores.length ?? 0) <= 1 && matched.length === 1 ? matched[0] : null;

  if (single) {
    const snapshot = await buildStoreSnapshot(single.place_id);
    if (snapshot) {
      const patch = { meo_place_id: single.place_id, meo_place_source: "auto" as const, meo_store: snapshot, meo_store_candidates: [] };
      await admin.from("analyses").update(patch).eq("id", a.id);
      await writeDaily(admin, a.id, snapshot).catch(() => undefined);
      return { ...a, ...patch };
    }
  }

  // ドメインが一致した店舗を優先して並べる（一致が無ければ検索結果そのまま）
  const list = (matched.length ? matched : candidates).map(({ place_id, name, address }) => ({ place_id, name, address }));
  await admin.from("analyses").update({ meo_store_candidates: list }).eq("id", a.id);
  return { ...a, meo_store_candidates: list };
}

// ── 読み込み ─────────────────────────────────
/**
 * ワークスペース一式を読む。sb は本人のセッション（RLS で本人の分析だけが見える）。
 */
export async function loadWorkspace(
  sb: SupabaseClient,
  a: MeoAnalysisRow,
  gbpConnected: boolean
): Promise<MeoWorkspaceData> {
  const [reviews, posts, metrics, daily, settings, checks, summary] = await Promise.all([
    sb.from("meo_reviews").select("*").eq("analysis_id", a.id).order("reviewed_at", { ascending: false }).limit(500),
    sb.from("meo_posts").select("*").eq("analysis_id", a.id).order("created_at", { ascending: false }).limit(200),
    sb.from("meo_metrics").select("*").eq("analysis_id", a.id).order("period", { ascending: false }).limit(1).maybeSingle(),
    sb.from("meo_daily").select("*").eq("analysis_id", a.id).order("date", { ascending: false }).limit(DAILY_TREND_DAYS),
    sb.from("meo_settings").select("*").eq("analysis_id", a.id).maybeSingle(),
    sb.from("ai_search_checks").select("*").eq("analysis_id", a.id).order("created_at", { ascending: false }).limit(AI_CHECK_HISTORY_LIMIT),
    sb.from("ai_search_summary").select("*").eq("analysis_id", a.id).maybeSingle(),
  ]);

  const reviewList = (reviews.data ?? []).map((r) => rowToReview(r));
  const ins = rowToMetrics(metrics.data ?? null);
  const profileDraft = toProfile(settings.data?.profile);
  const store = a.meo_store;
  const siteTitle = a.site?.title ?? null;
  const name = store?.name ? (siteTitle ? `${store.name} | ${siteTitle}` : store.name) : (a.meo?.self?.name ?? (a.url ?? "").replace(/^https?:\/\//, "").replace(/\/$/, ""));

  return {
    store: {
      id: a.id,
      name,
      address: store?.address ?? a.meo?.self?.address ?? null,
      category: store?.category ?? null,
      phoneNumber: store?.phoneNumber ?? null,
      websiteUrl: store?.websiteUrl ?? a.url,
      gbpStatus: a.meo_gbp_location && gbpConnected ? "connected" : store ? "disconnected" : "unclaimed",
      meoScore: store?.meoScore ?? null,
      rating: store?.rating ?? null,
      reviewCount: store?.reviewCount ?? null,
      ratingRank: store?.ratingRank ?? null,
      competitorCount: store?.competitors.length ?? 0,
      // 同期のタイミングはクチコミの取り込み日時で代用する
      lastSyncedAt: reviewList[0]?.createdAt ?? null,
    },
    checklist: buildProfileChecklist(store, profileDraft),
    reviews: reviewList,
    posts: (posts.data ?? []).map((r) => rowToPost(r)),
    metrics: ins.metrics,
    metricsPeriod: ins.period,
    daily: (daily.data ?? []).map((r) => rowToDaily(r)).reverse(),
    gbpLocationName: a.meo_gbp_location,
    gbpConnected,
    ownPlaceId: a.meo_place_id,
    ownPlaceIdSource: a.meo_place_source,
    storeCandidates: a.meo_store_candidates ?? [],
    photos: buildPhotoOverview(store),
    fieldTopics: ins.fieldTopics,
    suggestions: ins.suggestions,
    aiReplySettings: toAiReply(settings.data?.ai_reply),
    notificationSettings: toNotifications(settings.data?.notifications),
    profileDraft,
    aiSearch: {
      checks: (checks.data ?? []).map((r) => rowToCheck(r)),
      summary: rowToSummary(summary.data ?? null),
    },
  };
}
