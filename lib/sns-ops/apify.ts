import type { SupabaseClient } from "@supabase/supabase-js";
import { jstDay } from "./day";

/**
 * SNS運用で「伸びているアカウント・話題の投稿」を集めるための Apify 呼び出し。
 *
 * AGENTS.md：回数に上限がある有料 API は、実際の fetch の直前の1箇所で予算を確かめる。
 * ここでは claim_sns_apify_call（1ユーザー1日の上限）を必ず通す。上限に達したら呼ばない。
 * RPC 自体が失敗したときも呼ばない（数え損ねて無制限に呼ぶより、取れない方を選ぶ）。
 */

export const SNS_APIFY_DAILY_MAX = 6;
/** 1回で受け取る最大件数（Apify は件数で課金される） */
export const SNS_APIFY_MAX_ITEMS = 60;

export type ApifyRunner = (actorId: string, input: object) => Promise<Record<string, unknown>[]>;

export function apifyRunner(admin: SupabaseClient, userId: string, f: typeof fetch = fetch): ApifyRunner {
  return async (actorId, input) => {
    const token = process.env.APIFY_API_TOKEN;
    if (!token) throw new Error("Apify の API トークンが未設定です");
    const { data, error } = await admin.rpc("claim_sns_apify_call", { p_user: userId, p_day: jstDay(), p_max: SNS_APIFY_DAILY_MAX });
    if (error || data !== true) throw new Error(`今日の収集の上限（${SNS_APIFY_DAILY_MAX}回）に達したため、取得していません`);
    const res = await f(`https://api.apify.com/v2/acts/${actorId.replace("/", "~")}/run-sync-get-dataset-items?token=${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`Apify の呼び出しに失敗しました（HTTP ${res.status}）`);
    return (await res.json()) as Record<string, unknown>[];
  };
}

export type ObservedX = {
  externalId: string;
  author: string;
  authorName: string;
  authorFollowers: number | null;
  text: string;
  url: string;
  media: { type: string; url: string }[];
  likes: number | null;
  reposts: number | null;
  replies: number | null;
  quotes: number | null;
  views: number | null;
  bookmarks: number | null;
  isReply: boolean;
  conversationId: string | null;
  postedAt: string | null;
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** apidojo/twitter-scraper-lite の1件 → 共通の形（項目名の揺れを吸収する） */
export function toObservedX(raw: Record<string, unknown>): ObservedX | null {
  const id = str(raw.id) || str(raw.id_str) || str(raw.tweetId);
  if (!id) return null;
  const author = (raw.author as Record<string, unknown>) ?? {};
  const handle = str(author.userName) || str(author.username) || str(author.screen_name);
  const ents = ((raw.extendedEntities as Record<string, unknown>)?.media ?? (raw.entities as Record<string, unknown>)?.media ?? raw.media ?? []) as Record<string, unknown>[];
  const media = (Array.isArray(ents) ? ents : [])
    .map((m) => ({ type: str(m.type) || "photo", url: str(m.media_url_https) || str(m.url) }))
    .filter((m) => /^https:\/\//.test(m.url))
    .slice(0, 4);
  const created = str(raw.createdAt) || str(raw.created_at);
  const t = created ? new Date(created) : null;
  return {
    externalId: id,
    author: handle,
    authorName: str(author.name),
    authorFollowers: num(author.followers) ?? num(author.followers_count),
    text: str(raw.text) || str(raw.fullText) || str(raw.full_text),
    url: str(raw.url) || str(raw.twitterUrl) || (handle ? `https://x.com/${handle}/status/${id}` : `https://x.com/i/status/${id}`),
    media,
    likes: num(raw.likeCount) ?? num(raw.favorite_count),
    reposts: num(raw.retweetCount) ?? num(raw.retweet_count),
    replies: num(raw.replyCount) ?? num(raw.reply_count),
    quotes: num(raw.quoteCount) ?? num(raw.quote_count),
    views: num(raw.viewCount) ?? num(raw.views),
    bookmarks: num(raw.bookmarkCount),
    isReply: raw.isReply === true || !!str(raw.inReplyToId) || !!str(raw.in_reply_to_status_id_str),
    conversationId: str(raw.conversationId) || null,
    postedAt: t && !Number.isNaN(t.getTime()) ? t.toISOString() : null,
  };
}

const X_ACTOR = () => process.env.APIFY_ACTOR_X || "apidojo/twitter-scraper-lite";

/** 伸びているアカウントの直近の投稿 */
export async function fetchBenchPosts(run: ApifyRunner, handles: string[], perAccount = 10): Promise<ObservedX[]> {
  const hs = handles.map((h) => h.replace(/^@/, "").trim()).filter((h) => /^[A-Za-z0-9_]{1,15}$/.test(h)).slice(0, 10);
  if (!hs.length) return [];
  const items = await run(X_ACTOR(), { twitterHandles: hs, maxItems: Math.min(SNS_APIFY_MAX_ITEMS, hs.length * perAccount), sort: "Latest" });
  return items.map(toObservedX).filter((x): x is ObservedX => !!x);
}

/** 話題の投稿（キーワードで、反応の多いものだけ）。リプライ・リポストの相手を選ぶ材料 */
export async function searchHotPosts(run: ApifyRunner, keywords: string[], minFaves = 50): Promise<ObservedX[]> {
  const ks = keywords.map((k) => k.trim()).filter(Boolean).slice(0, 5);
  if (!ks.length) return [];
  const items = await run(X_ACTOR(), {
    searchTerms: ks.map((k) => `${k} lang:ja min_faves:${minFaves} -filter:replies`),
    maxItems: SNS_APIFY_MAX_ITEMS,
    sort: "Top",
  });
  return items.map(toObservedX).filter((x): x is ObservedX => !!x);
}

const iso = (v: unknown) => {
  if (typeof v === "number") return new Date(v > 1e12 ? v : v * 1000).toISOString();
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** Instagram：伸びているアカウントの直近の投稿（プロフィールの latestPosts） */
export async function fetchInstagramBench(run: ApifyRunner, handles: string[]): Promise<ObservedX[]> {
  const hs = handles.map((h) => h.replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//, "").split(/[/?]/)[0].trim()).filter((h) => /^[A-Za-z0-9._]{1,30}$/.test(h)).slice(0, 10);
  if (!hs.length) return [];
  const items = await run(process.env.APIFY_ACTOR_INSTAGRAM || "apify/instagram-profile-scraper", { usernames: hs });
  const out: ObservedX[] = [];
  for (const prof of items) {
    const handle = str(prof.username);
    const followers = num(prof.followersCount);
    for (const p of (Array.isArray(prof.latestPosts) ? prof.latestPosts : []) as Record<string, unknown>[]) {
      const id = str(p.id) || str(p.shortCode);
      if (!id) continue;
      out.push({
        externalId: id,
        author: handle,
        authorName: str(prof.fullName),
        authorFollowers: followers,
        text: str(p.caption),
        url: str(p.url) || (str(p.shortCode) ? `https://www.instagram.com/p/${str(p.shortCode)}/` : ""),
        media: str(p.displayUrl) ? [{ type: str(p.type).toLowerCase() || "image", url: str(p.displayUrl) }] : [],
        likes: num(p.likesCount),
        reposts: null,
        replies: num(p.commentsCount),
        quotes: null,
        views: num(p.videoViewCount) ?? num(p.videoPlayCount),
        bookmarks: null,
        isReply: false,
        conversationId: null,
        postedAt: iso(p.timestamp),
      });
    }
  }
  return out;
}

/** TikTok：伸びているアカウントの直近の動画 */
export async function fetchTiktokBench(run: ApifyRunner, handles: string[], perAccount = 8): Promise<ObservedX[]> {
  const hs = handles.map((h) => h.replace(/^@/, "").replace(/^https?:\/\/(www\.)?tiktok\.com\/@?/, "").split(/[/?]/)[0].trim()).filter((h) => /^[A-Za-z0-9._]{1,30}$/.test(h)).slice(0, 8);
  if (!hs.length) return [];
  const items = await run(process.env.APIFY_ACTOR_TIKTOK || "clockworks/tiktok-profile-scraper", { profiles: hs, resultsPerPage: perAccount, commentsPerPost: 0 });
  return items
    .map((v): ObservedX | null => {
      const id = str(v.id);
      if (!id) return null;
      const a = (v.authorMeta as Record<string, unknown>) ?? {};
      return {
        externalId: id,
        author: str(a.name),
        authorName: str(a.nickName),
        authorFollowers: num(a.fans),
        text: str(v.text),
        url: str(v.webVideoUrl),
        media: [],
        likes: num(v.diggCount),
        reposts: num(v.shareCount),
        replies: num(v.commentCount),
        quotes: null,
        views: num(v.playCount),
        bookmarks: num(v.collectCount),
        isReply: false,
        conversationId: null,
        postedAt: iso(v.createTimeISO) ?? iso(v.createTime),
      };
    })
    .filter((x): x is ObservedX => !!x);
}
