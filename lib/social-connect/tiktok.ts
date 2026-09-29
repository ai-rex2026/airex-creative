/**
 * TikTok 公式API（Login Kit / Display API v2）。連携した本人のアカウントの、
 * プロフィールと直近の動画ごとのエンゲージメント指標を読む。
 * 読み取りのみ（user.info.basic,user.info.stats,video.list。video.publish は要求しない）。
 *
 * TikTok API は成功判定が error.code === "ok" で来る（空/未設定ではない）ので、必ずこれを見る。
 */

export type TikTokProfile = {
  openId: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  followerCount: number | null;
  followingCount: number | null;
  likesCount: number | null;
  videoCount: number | null;
};

export type TikTokVideo = {
  id: string;
  title: string | null;
  coverImageUrl: string | null;
  createTime: number | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  shareCount: number | null;
};

type TikTokError = { code?: string; message?: string };

function checkOk(j: { error?: TikTokError }, label: string) {
  if (j.error && j.error.code !== "ok") {
    throw new Error(`${label}：${j.error.message ?? j.error.code}`);
  }
}

export async function fetchTikTokProfile(accessToken: string): Promise<TikTokProfile> {
  const fields = [
    "open_id",
    "avatar_url",
    "display_name",
    "username",
    "follower_count",
    "following_count",
    "likes_count",
    "video_count",
  ].join(",");
  const res = await fetch(`https://open.tiktokapis.com/v2/user/info/?fields=${fields}`, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`TikTok のプロフィール取得に失敗しました（HTTP ${res.status}）`);
  checkOk(j, "TikTok のプロフィール取得に失敗しました");
  const u = j.data?.user ?? {};
  return {
    openId: u.open_id,
    username: u.username ?? null,
    displayName: u.display_name ?? null,
    avatarUrl: u.avatar_url ?? null,
    followerCount: typeof u.follower_count === "number" ? u.follower_count : null,
    followingCount: typeof u.following_count === "number" ? u.following_count : null,
    likesCount: typeof u.likes_count === "number" ? u.likes_count : null,
    videoCount: typeof u.video_count === "number" ? u.video_count : null,
  };
}

/** 直近の動画を、再生・いいね・コメント・シェア数つきで取る */
export async function fetchTikTokVideos(accessToken: string, maxCount = 10): Promise<TikTokVideo[]> {
  const fields = ["id", "title", "cover_image_url", "create_time", "view_count", "like_count", "comment_count", "share_count"].join(",");
  const res = await fetch(`https://open.tiktokapis.com/v2/video/list/?fields=${fields}`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ max_count: Math.min(Math.max(maxCount, 1), 20) }),
    signal: AbortSignal.timeout(15000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`TikTok の動画一覧取得に失敗しました（HTTP ${res.status}）`);
  checkOk(j, "TikTok の動画一覧取得に失敗しました");
  const videos = Array.isArray(j.data?.videos) ? j.data.videos : [];
  return videos.map((v: Record<string, unknown>) => ({
    id: v.id as string,
    title: (v.title as string | undefined) ?? null,
    coverImageUrl: (v.cover_image_url as string | undefined) ?? null,
    createTime: typeof v.create_time === "number" ? v.create_time : null,
    viewCount: typeof v.view_count === "number" ? v.view_count : null,
    likeCount: typeof v.like_count === "number" ? v.like_count : null,
    commentCount: typeof v.comment_count === "number" ? v.comment_count : null,
    shareCount: typeof v.share_count === "number" ? v.share_count : null,
  }));
}
