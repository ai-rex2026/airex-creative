/**
 * X API v2（連携した本人のアカウント）：投稿・スレッド・画像/動画のアップロード・リポスト・DM・自分の投稿の数字。
 * どれも人が承認したものだけを送る（AGENTS.md）。
 *
 * 2026-02-23 以降、他人の投稿へ API でリプライ／引用できるのは、相手がこちらをメンション・引用したときだけ。
 * 自分の投稿へのリプライ（スレッド）は送れる。それ以外のリプライは画面から X の投稿画面を開いて人が送る（xIntentUrl）。
 */

const API = "https://api.x.com/2";

export class XApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

type Fetch = typeof fetch;

async function call<T>(f: Fetch, token: string, path: string, init: { method?: string; json?: unknown; form?: FormData } = {}): Promise<T> {
  const res = await f(`${API}${path}`, {
    method: init.method ?? (init.json !== undefined || init.form ? "POST" : "GET"),
    headers: { authorization: `Bearer ${token}`, ...(init.json !== undefined ? { "content-type": "application/json" } : {}) },
    body: init.json !== undefined ? JSON.stringify(init.json) : (init.form ?? undefined),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  let j: { data?: unknown; errors?: { message?: string; detail?: string }[]; detail?: string; title?: string } = {};
  try {
    j = text ? JSON.parse(text) : {};
  } catch {
    /* 本文が JSON でない */
  }
  if (!res.ok) {
    const why = j.errors?.[0]?.message ?? j.errors?.[0]?.detail ?? j.detail ?? j.title ?? `HTTP ${res.status}`;
    if (res.status === 401) throw new XApiError("X の連携が切れています。X を連携し直してください", 401);
    if (res.status === 403) throw new XApiError(`X に拒否されました（${why}）。連携の権限が足りないか、X の規約で API から送れない操作です`, 403);
    if (res.status === 429) throw new XApiError("X の回数制限に達しました。時間をおいてください", 429);
    if (res.status === 402) throw new XApiError("X API のクレジットが足りません（X の開発者コンソールで残高を確認してください）", 402);
    throw new XApiError(`X API がエラーを返しました：${why}`, res.status);
  }
  return j as T;
}

/** 画像・動画を送って media_id を得る（v2 の分割アップロード。画像も同じ手順で送れる） */
export async function xUploadMedia(token: string, file: { bytes: Buffer; mime: string }, f: Fetch = fetch): Promise<string> {
  const isVideo = file.mime.startsWith("video/");
  const init = await call<{ data: { id: string } }>(f, token, "/media/upload/initialize", {
    json: { media_type: file.mime, total_bytes: file.bytes.length, media_category: isVideo ? "tweet_video" : "tweet_image" },
  });
  const id = init.data.id;
  const CHUNK = 4 * 1024 * 1024;
  for (let i = 0, seg = 0; i < file.bytes.length; i += CHUNK, seg++) {
    const fd = new FormData();
    fd.set("segment_index", String(seg));
    fd.set("media", new Blob([new Uint8Array(file.bytes.subarray(i, i + CHUNK))], { type: file.mime }));
    await call(f, token, `/media/upload/${id}/append`, { form: fd });
  }
  const fin = await call<{ data: { id: string; processing_info?: { state: string; check_after_secs?: number } } }>(f, token, `/media/upload/${id}/finalize`, { method: "POST" });
  let info = fin.data.processing_info;
  for (let k = 0; info && info.state !== "succeeded" && k < 20; k++) {
    if (info.state === "failed") throw new XApiError("X で動画の処理に失敗しました", 400);
    await new Promise((r) => setTimeout(r, Math.min(10, info!.check_after_secs ?? 2) * 1000));
    const st = await call<{ data: { processing_info?: { state: string; check_after_secs?: number } } }>(f, token, `/media/upload?command=STATUS&media_id=${id}`);
    info = st.data.processing_info;
  }
  return id;
}

export type XPostInput = { text: string; mediaIds?: string[]; replyTo?: string | null; quoteOf?: string | null };

export async function xCreatePost(token: string, p: XPostInput, f: Fetch = fetch): Promise<string> {
  const body: Record<string, unknown> = { text: p.text };
  if (p.mediaIds?.length) body.media = { media_ids: p.mediaIds };
  if (p.replyTo) body.reply = { in_reply_to_tweet_id: p.replyTo };
  if (p.quoteOf) body.quote_tweet_id = p.quoteOf;
  const r = await call<{ data: { id: string } }>(f, token, "/tweets", { json: body });
  return r.data.id;
}

export async function xRepost(token: string, myUserId: string, tweetId: string, f: Fetch = fetch): Promise<void> {
  await call(f, token, `/users/${myUserId}/retweets`, { json: { tweet_id: tweetId } });
}

export type XDm = { id: string; conversationId: string; senderId: string; text: string; createdAt: string | null };

/** 直近の DM（自分が送ったものも含む）と、送り主の名前 */
export async function xListDms(token: string, max = 50, f: Fetch = fetch): Promise<{ events: XDm[]; users: Record<string, { username: string; name: string }> }> {
  const q = new URLSearchParams({
    "dm_event.fields": "id,text,event_type,created_at,sender_id,dm_conversation_id",
    event_types: "MessageCreate",
    expansions: "sender_id",
    "user.fields": "username,name",
    max_results: String(Math.min(100, Math.max(1, max))),
  });
  const r = await call<{ data?: { id: string; text?: string; created_at?: string; sender_id?: string; dm_conversation_id?: string }[]; includes?: { users?: { id: string; username: string; name: string }[] } }>(f, token, `/dm_events?${q}`);
  const users: Record<string, { username: string; name: string }> = {};
  for (const u of r.includes?.users ?? []) users[u.id] = { username: u.username, name: u.name };
  return {
    events: (r.data ?? []).map((e) => ({ id: e.id, conversationId: e.dm_conversation_id ?? "", senderId: e.sender_id ?? "", text: e.text ?? "", createdAt: e.created_at ?? null })),
    users,
  };
}

export async function xSendDm(token: string, conversationId: string, text: string, f: Fetch = fetch): Promise<string> {
  const r = await call<{ data: { dm_event_id: string } }>(f, token, `/dm_conversations/${encodeURIComponent(conversationId)}/messages`, { json: { text } });
  return r.data.dm_event_id;
}

export type XOwnPost = { id: string; text: string; createdAt: string | null; likes: number; reposts: number; replies: number; quotes: number; impressions: number | null; bookmarks: number | null; conversationId: string | null; inReplyTo: string | null };

/** 自分の直近の投稿の数字（自分のデータの読み取りは安い単価） */
export async function xOwnPosts(token: string, myUserId: string, max = 50, f: Fetch = fetch): Promise<XOwnPost[]> {
  const q = new URLSearchParams({
    "tweet.fields": "public_metrics,created_at,conversation_id,in_reply_to_user_id,referenced_tweets",
    exclude: "retweets",
    max_results: String(Math.min(100, Math.max(5, max))),
  });
  const r = await call<{
    data?: { id: string; text: string; created_at?: string; conversation_id?: string; referenced_tweets?: { type: string; id: string }[]; public_metrics?: Record<string, number> }[];
  }>(f, token, `/users/${myUserId}/tweets?${q}`);
  return (r.data ?? []).map((t) => {
    const m = t.public_metrics ?? {};
    return {
      id: t.id,
      text: t.text,
      createdAt: t.created_at ?? null,
      likes: m.like_count ?? 0,
      reposts: m.retweet_count ?? 0,
      replies: m.reply_count ?? 0,
      quotes: m.quote_count ?? 0,
      impressions: m.impression_count ?? null,
      bookmarks: m.bookmark_count ?? null,
      conversationId: t.conversation_id ?? null,
      inReplyTo: t.referenced_tweets?.find((x) => x.type === "replied_to")?.id ?? null,
    };
  });
}

/** API で送れないリプライ・引用を、人が X の画面から送るための URL（本文入り） */
export function xIntentUrl(p: { text: string; replyTo?: string | null; quoteUrl?: string | null }): string {
  const u = new URL("https://x.com/intent/post");
  u.searchParams.set("text", p.quoteUrl ? `${p.text} ${p.quoteUrl}` : p.text);
  if (p.replyTo) u.searchParams.set("in_reply_to", p.replyTo);
  return u.toString();
}

/** X の文字数（全角は2、半角は1。上限 280 ＝ 全角140字）。URL は 23 として数える */
export function xWeightedLength(text: string): number {
  const urls = text.match(/https?:\/\/\S+/g) ?? [];
  let rest = text;
  for (const u of urls) rest = rest.replace(u, "");
  let n = urls.length * 23;
  for (const ch of Array.from(rest)) {
    const c = ch.codePointAt(0)!;
    n += c <= 0x10ff || (c >= 0x2000 && c <= 0x200d) || (c >= 0x2010 && c <= 0x201f) || (c >= 0x2032 && c <= 0x2037) ? 1 : 2;
  }
  return n;
}
