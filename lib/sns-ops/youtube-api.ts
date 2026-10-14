/**
 * YouTube Data API v3（連携した本人のチャンネル）：動画のアップロード・自分の動画の数字・コメントの返信。
 * 伸びているチャンネルの分析は公開データ（API キー）で読む。
 * Google の確認（検証）前のアプリでアップロードした動画は非公開に固定される。
 */

const Y = "https://www.googleapis.com/youtube/v3";
type Fetch = typeof fetch;

async function yget<T>(f: Fetch, url: string, token?: string): Promise<T> {
  const res = await f(url, { headers: token ? { authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(30_000) });
  const j = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(`YouTube API がエラーを返しました：${j.error?.message ?? `HTTP ${res.status}`}`);
  return j;
}

export type YtVideo = { id: string; title: string; description: string; publishedAt: string | null; views: number | null; likes: number | null; comments: number | null; durationSec: number | null; channelTitle: string; thumbnail: string | null };

export function isoDurationSec(d: string | undefined): number | null {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(d ?? "");
  if (!m) return null;
  return Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0);
}

async function videosByIds(f: Fetch, ids: string[], auth: { token?: string; key?: string }): Promise<YtVideo[]> {
  if (!ids.length) return [];
  const u = new URL(`${Y}/videos`);
  u.searchParams.set("part", "snippet,statistics,contentDetails");
  u.searchParams.set("id", ids.slice(0, 50).join(","));
  if (auth.key) u.searchParams.set("key", auth.key);
  const r = await yget<{ items?: { id: string; snippet?: { title?: string; description?: string; publishedAt?: string; channelTitle?: string; thumbnails?: { medium?: { url?: string } } }; statistics?: Record<string, string>; contentDetails?: { duration?: string } }[] }>(f, u.toString(), auth.token);
  const n = (v?: string) => (v === undefined ? null : Number(v));
  return (r.items ?? []).map((v) => ({
    id: v.id,
    title: v.snippet?.title ?? "",
    description: v.snippet?.description ?? "",
    publishedAt: v.snippet?.publishedAt ?? null,
    views: n(v.statistics?.viewCount),
    likes: n(v.statistics?.likeCount),
    comments: n(v.statistics?.commentCount),
    durationSec: isoDurationSec(v.contentDetails?.duration),
    channelTitle: v.snippet?.channelTitle ?? "",
    thumbnail: v.snippet?.thumbnails?.medium?.url ?? null,
  }));
}

/** 自分のチャンネルの直近の動画（アップロードの再生リストから） */
export async function ytOwnVideos(token: string, uploadsPlaylistId: string, max = 30, f: Fetch = fetch): Promise<YtVideo[]> {
  const u = new URL(`${Y}/playlistItems`);
  u.searchParams.set("part", "contentDetails");
  u.searchParams.set("playlistId", uploadsPlaylistId);
  u.searchParams.set("maxResults", String(Math.min(50, max)));
  const r = await yget<{ items?: { contentDetails?: { videoId?: string } }[] }>(f, u.toString(), token);
  return videosByIds(f, (r.items ?? []).map((i) => i.contentDetails?.videoId).filter((x): x is string => !!x), { token });
}

/** 伸びているチャンネル（公開データ）：@ハンドル／チャンネル ID から直近の動画 */
export async function ytChannelVideos(key: string, handleOrId: string, max = 15, f: Fetch = fetch): Promise<YtVideo[]> {
  const h = handleOrId.trim().replace(/^https?:\/\/(www\.)?youtube\.com\//, "").split(/[/?]/)[0];
  const u = new URL(`${Y}/channels`);
  u.searchParams.set("part", "contentDetails");
  if (/^UC[\w-]{20,}$/.test(h)) u.searchParams.set("id", h);
  else u.searchParams.set("forHandle", h.startsWith("@") ? h : `@${h}`);
  u.searchParams.set("key", key);
  const c = await yget<{ items?: { contentDetails?: { relatedPlaylists?: { uploads?: string } } }[] }>(f, u.toString());
  const up = c.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!up) return [];
  const p = new URL(`${Y}/playlistItems`);
  p.searchParams.set("part", "contentDetails");
  p.searchParams.set("playlistId", up);
  p.searchParams.set("maxResults", String(Math.min(50, max)));
  p.searchParams.set("key", key);
  const r = await yget<{ items?: { contentDetails?: { videoId?: string } }[] }>(f, p.toString());
  return videosByIds(f, (r.items ?? []).map((i) => i.contentDetails?.videoId).filter((x): x is string => !!x), { key });
}

/** 動画をアップロードする（再開可能アップロードの1回目で URL をもらい、本体を1回で送る） */
export async function ytStartUpload(token: string, p: { title: string; description: string; tags: string[]; privacy: string; size: number }, f: Fetch = fetch): Promise<string> {
  const res = await f("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=UTF-8", "x-upload-content-type": "video/mp4", "x-upload-content-length": String(p.size) },
    body: JSON.stringify({
      snippet: { title: p.title.slice(0, 100), description: p.description.slice(0, 5000), tags: p.tags.slice(0, 15), categoryId: "22", defaultLanguage: "ja" },
      status: { privacyStatus: p.privacy, selfDeclaredMadeForKids: false, containsSyntheticMedia: true },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`YouTube へのアップロードを始められませんでした：${(await res.text()).slice(0, 200)}`);
  const loc = res.headers.get("location");
  if (!loc) throw new Error("YouTube からアップロード先が返りませんでした");
  return loc;
}

export async function ytPutVideo(uploadUrl: string, token: string, bytes: Buffer, f: Fetch = fetch): Promise<string> {
  const res = await f(uploadUrl, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": "video/mp4", "content-length": String(bytes.length) },
    body: new Uint8Array(bytes),
    signal: AbortSignal.timeout(280_000),
  });
  const j = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
  if (!res.ok || !j.id) throw new Error(`YouTube へ動画を送れませんでした：${j.error?.message ?? `HTTP ${res.status}`}`);
  return j.id;
}

export type YtComment = { id: string; videoId: string; text: string; author: string; publishedAt: string | null; replied: boolean };

/** 自分のチャンネルの動画についた最近のコメント */
export async function ytComments(token: string, channelId: string, f: Fetch = fetch): Promise<YtComment[]> {
  const u = new URL(`${Y}/commentThreads`);
  u.searchParams.set("part", "snippet,replies");
  u.searchParams.set("allThreadsRelatedToChannelId", channelId);
  u.searchParams.set("order", "time");
  u.searchParams.set("maxResults", "50");
  const r = await yget<{ items?: { id: string; snippet?: { videoId?: string; topLevelComment?: { snippet?: { textOriginal?: string; authorDisplayName?: string; publishedAt?: string; authorChannelId?: { value?: string } } } }; replies?: { comments?: { snippet?: { authorChannelId?: { value?: string } } }[] } }[] }>(f, u.toString(), token);
  return (r.items ?? [])
    .filter((t) => t.snippet?.topLevelComment?.snippet?.authorChannelId?.value !== channelId)
    .map((t) => ({
      id: t.id,
      videoId: t.snippet?.videoId ?? "",
      text: t.snippet?.topLevelComment?.snippet?.textOriginal ?? "",
      author: t.snippet?.topLevelComment?.snippet?.authorDisplayName ?? "",
      publishedAt: t.snippet?.topLevelComment?.snippet?.publishedAt ?? null,
      replied: (t.replies?.comments ?? []).some((c) => c.snippet?.authorChannelId?.value === channelId),
    }));
}

export async function ytReply(token: string, parentId: string, text: string, f: Fetch = fetch): Promise<string> {
  const res = await f(`${Y}/comments?part=snippet`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ snippet: { parentId, textOriginal: text } }),
    signal: AbortSignal.timeout(30_000),
  });
  const j = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
  if (!res.ok || !j.id) throw new Error(`YouTube のコメントに返信できませんでした：${j.error?.message ?? `HTTP ${res.status}`}`);
  return j.id;
}
