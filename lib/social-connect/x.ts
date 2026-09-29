/**
 * X（旧Twitter）公式API（v2）。連携した本人のアカウントの、プロフィールと
 * 直近の投稿ごとのエンゲージメント指標を読む。読み取りのみ（tweet.read users.read offline.access）。
 */

export type XProfile = {
  id: string;
  username: string;
  name: string;
  followers: number | null;
  following: number | null;
  tweetCount: number | null;
  profileImageUrl: string | null;
};

export type XPost = {
  id: string;
  text: string;
  createdAt: string | null;
  likes: number | null;
  retweets: number | null;
  replies: number | null;
  impressions: number | null;
};

type XUserResponse = {
  data?: {
    id: string;
    username: string;
    name: string;
    profile_image_url?: string;
    public_metrics?: { followers_count?: number; following_count?: number; tweet_count?: number };
  };
  errors?: { message?: string }[];
  title?: string;
};

export async function fetchXProfile(accessToken: string): Promise<XProfile> {
  const u = new URL("https://api.twitter.com/2/users/me");
  u.searchParams.set("user.fields", "public_metrics,profile_image_url");
  const res = await fetch(u, { headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15000) });
  const j = (await res.json().catch(() => ({}))) as XUserResponse;
  if (!res.ok || !j.data) {
    throw new Error(`X のプロフィール取得に失敗しました：${j.errors?.[0]?.message ?? j.title ?? `HTTP ${res.status}`}`);
  }
  const d = j.data;
  const m = d.public_metrics ?? {};
  return {
    id: d.id,
    username: d.username,
    name: d.name,
    followers: typeof m.followers_count === "number" ? m.followers_count : null,
    following: typeof m.following_count === "number" ? m.following_count : null,
    tweetCount: typeof m.tweet_count === "number" ? m.tweet_count : null,
    profileImageUrl: d.profile_image_url ?? null,
  };
}

type XTweetsResponse = {
  data?: {
    id: string;
    text: string;
    created_at?: string;
    public_metrics?: { like_count?: number; retweet_count?: number; reply_count?: number; impression_count?: number };
  }[];
  errors?: { message?: string }[];
  title?: string;
};

/** 直近の投稿（リポスト・返信は除く）を、いいね・リポスト・返信・インプレッション数つきで取る */
export async function fetchXRecentPosts(accessToken: string, userId: string, max = 10): Promise<XPost[]> {
  const u = new URL(`https://api.twitter.com/2/users/${userId}/tweets`);
  u.searchParams.set("tweet.fields", "public_metrics,created_at");
  u.searchParams.set("exclude", "retweets,replies");
  u.searchParams.set("max_results", String(Math.min(Math.max(max, 5), 100)));
  const res = await fetch(u, { headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15000) });
  const j = (await res.json().catch(() => ({}))) as XTweetsResponse;
  if (!res.ok) {
    throw new Error(`X の投稿取得に失敗しました：${j.errors?.[0]?.message ?? j.title ?? `HTTP ${res.status}`}`);
  }
  return (j.data ?? []).map((t) => {
    const m = t.public_metrics ?? {};
    return {
      id: t.id,
      text: t.text,
      createdAt: t.created_at ?? null,
      likes: typeof m.like_count === "number" ? m.like_count : null,
      retweets: typeof m.retweet_count === "number" ? m.retweet_count : null,
      replies: typeof m.reply_count === "number" ? m.reply_count : null,
      impressions: typeof m.impression_count === "number" ? m.impression_count : null,
    };
  });
}
