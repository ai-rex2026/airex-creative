/** YouTube Data API v3：連携した本人のチャンネル */

export type YoutubeChannel = {
  id: string;
  title: string;
  handle: string | null;
  subscribers: number | null;
  videoCount: number | null;
  viewCount: number | null;
  thumbnail: string | null;
  /** アップロードした動画の再生リスト（動画一覧の取得に使う） */
  uploadsPlaylistId: string | null;
};

export async function fetchYoutubeChannel(accessToken: string): Promise<YoutubeChannel> {
  const u = new URL("https://www.googleapis.com/youtube/v3/channels");
  u.searchParams.set("part", "snippet,statistics,contentDetails");
  u.searchParams.set("mine", "true");
  const res = await fetch(u, { headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15000) });
  const j = (await res.json().catch(() => ({}))) as {
    items?: {
      id: string;
      snippet?: { title?: string; customUrl?: string; thumbnails?: { default?: { url?: string } } };
      statistics?: { subscriberCount?: string; videoCount?: string; viewCount?: string; hiddenSubscriberCount?: boolean };
      contentDetails?: { relatedPlaylists?: { uploads?: string } };
    }[];
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(`YouTube のチャンネル取得に失敗しました：${j.error?.message ?? `HTTP ${res.status}`}`);
  const c = j.items?.[0];
  if (!c) throw new Error("このGoogleアカウントには YouTube チャンネルがありません。先に YouTube でチャンネルを作成してください");
  const n = (v?: string) => (v === undefined ? null : Number(v));
  return {
    id: c.id,
    title: c.snippet?.title ?? "",
    handle: c.snippet?.customUrl ?? null,
    subscribers: c.statistics?.hiddenSubscriberCount ? null : n(c.statistics?.subscriberCount),
    videoCount: n(c.statistics?.videoCount),
    viewCount: n(c.statistics?.viewCount),
    thumbnail: c.snippet?.thumbnails?.default?.url ?? null,
    uploadsPlaylistId: c.contentDetails?.relatedPlaylists?.uploads ?? null,
  };
}
