/**
 * Instagram Graph API（Facebook ページに連携したプロアカウント。トークンはページのアクセストークン）。
 * 投稿（画像・カルーセル・リール）・自分の投稿の数字・コメントの返信・DM。どれも人が承認したものだけ送る。
 * 投稿・コメント・DM の権限は Meta のアプリレビューが要る（承認前はアプリの管理者・テスターだけ）。
 */

const G = "https://graph.facebook.com/v21.0";
type Fetch = typeof fetch;

async function call<T>(f: Fetch, token: string, path: string, init: { method?: string; params?: Record<string, string> } = {}): Promise<T> {
  const u = new URL(`${G}${path}`);
  const method = init.method ?? "GET";
  const body = new URLSearchParams({ ...(init.params ?? {}), access_token: token });
  if (method === "GET") for (const [k, v] of body) u.searchParams.set(k, v);
  const res = await f(u.toString(), { method, body: method === "GET" ? undefined : body, signal: AbortSignal.timeout(60_000) });
  const j = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; code?: number; error_subcode?: number } };
  if (!res.ok || j.error) {
    const e = j.error;
    if (e?.code === 10 || e?.code === 200 || e?.code === 190) throw new Error(`Instagram の権限が足りません（${e?.message ?? res.status}）。アプリの権限（審査）と連携を確認してください`);
    throw new Error(`Instagram API がエラーを返しました：${e?.message ?? `HTTP ${res.status}`}`);
  }
  return j;
}

export type IgMedia = { id: string; caption: string; mediaType: string; mediaUrl: string | null; permalink: string; timestamp: string | null; likes: number | null; comments: number | null };

export async function igOwnMedia(token: string, igUserId: string, limit = 30, f: Fetch = fetch): Promise<IgMedia[]> {
  const r = await call<{ data?: { id: string; caption?: string; media_type?: string; media_url?: string; thumbnail_url?: string; permalink?: string; timestamp?: string; like_count?: number; comments_count?: number }[] }>(f, token, `/${igUserId}/media`, {
    params: { fields: "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count", limit: String(limit) },
  });
  return (r.data ?? []).map((m) => ({ id: m.id, caption: m.caption ?? "", mediaType: m.media_type ?? "", mediaUrl: m.media_type === "VIDEO" ? (m.thumbnail_url ?? null) : (m.media_url ?? null), permalink: m.permalink ?? "", timestamp: m.timestamp ?? null, likes: m.like_count ?? null, comments: m.comments_count ?? null }));
}

/** 投稿のコンテナを作る（画像1枚・カルーセルの1枚・リール） */
export async function igCreateContainer(token: string, igUserId: string, p: { imageUrl?: string; videoUrl?: string; caption?: string; carouselItem?: boolean; children?: string[]; reels?: boolean }, f: Fetch = fetch): Promise<string> {
  const params: Record<string, string> = {};
  if (p.children) {
    params.media_type = "CAROUSEL";
    params.children = p.children.join(",");
  } else if (p.videoUrl) {
    params.media_type = "REELS";
    params.video_url = p.videoUrl;
    params.share_to_feed = "true";
  } else if (p.imageUrl) params.image_url = p.imageUrl;
  if (p.carouselItem) params.is_carousel_item = "true";
  if (p.caption && !p.carouselItem) params.caption = p.caption;
  const r = await call<{ id: string }>(f, token, `/${igUserId}/media`, { method: "POST", params });
  return r.id;
}

/** コンテナの処理状況（リールは処理に時間がかかる） */
export async function igContainerStatus(token: string, containerId: string, f: Fetch = fetch): Promise<"FINISHED" | "IN_PROGRESS" | "ERROR" | "EXPIRED" | "PUBLISHED"> {
  const r = await call<{ status_code?: string }>(f, token, `/${containerId}`, { params: { fields: "status_code" } });
  return (r.status_code as "FINISHED") ?? "IN_PROGRESS";
}

export async function igPublish(token: string, igUserId: string, containerId: string, f: Fetch = fetch): Promise<string> {
  const r = await call<{ id: string }>(f, token, `/${igUserId}/media_publish`, { method: "POST", params: { creation_id: containerId } });
  return r.id;
}

export async function igPermalink(token: string, mediaId: string, f: Fetch = fetch): Promise<string | null> {
  const r = await call<{ permalink?: string }>(f, token, `/${mediaId}`, { params: { fields: "permalink" } }).catch(() => ({ permalink: undefined }));
  return r.permalink ?? null;
}

export type IgComment = { id: string; mediaId: string; text: string; username: string; timestamp: string | null; replied: boolean };

/** 自分の投稿についたコメント（返信済みかどうかも） */
export async function igComments(token: string, mediaIds: string[], myUsername: string, f: Fetch = fetch): Promise<IgComment[]> {
  const out: IgComment[] = [];
  for (const id of mediaIds.slice(0, 15)) {
    const r = await call<{ data?: { id: string; text?: string; username?: string; timestamp?: string; replies?: { data?: { username?: string }[] } }[] }>(f, token, `/${id}/comments`, {
      params: { fields: "id,text,username,timestamp,replies{username}", limit: "50" },
    }).catch(() => ({ data: [] }));
    for (const c of r.data ?? []) {
      if ((c.username ?? "").toLowerCase() === myUsername.toLowerCase()) continue;
      out.push({ id: c.id, mediaId: id, text: c.text ?? "", username: c.username ?? "", timestamp: c.timestamp ?? null, replied: (c.replies?.data ?? []).some((x) => (x.username ?? "").toLowerCase() === myUsername.toLowerCase()) });
    }
  }
  return out;
}

export async function igReplyComment(token: string, commentId: string, message: string, f: Fetch = fetch): Promise<string> {
  const r = await call<{ id: string }>(f, token, `/${commentId}/replies`, { method: "POST", params: { message } });
  return r.id;
}

export type IgDm = { id: string; conversationId: string; fromId: string; fromName: string; text: string; createdAt: string | null; fromMe: boolean };

/** DM（ページ経由の Instagram メッセージ） */
export async function igListDms(token: string, pageId: string, igUserId: string, f: Fetch = fetch): Promise<IgDm[]> {
  const r = await call<{ data?: { id: string; messages?: { data?: { id: string; message?: string; created_time?: string; from?: { id?: string; username?: string; name?: string } }[] } }[] }>(f, token, `/${pageId}/conversations`, {
    params: { platform: "instagram", fields: "id,messages.limit(10){id,message,created_time,from}", limit: "25" },
  });
  const out: IgDm[] = [];
  for (const c of r.data ?? []) {
    for (const m of c.messages?.data ?? []) {
      out.push({ id: m.id, conversationId: c.id, fromId: m.from?.id ?? "", fromName: m.from?.username ?? m.from?.name ?? "", text: m.message ?? "", createdAt: m.created_time ?? null, fromMe: m.from?.id === igUserId });
    }
  }
  return out;
}

/** DM を送る（相手の最後のメッセージから24時間以内だけ送れる） */
export async function igSendDm(token: string, pageId: string, recipientId: string, text: string, f: Fetch = fetch): Promise<string> {
  const u = new URL(`${G}/${pageId}/messages`);
  u.searchParams.set("access_token", token);
  const res = await f(u.toString(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ recipient: { id: recipientId }, message: { text }, messaging_type: "RESPONSE" }),
    signal: AbortSignal.timeout(30_000),
  });
  const j = (await res.json().catch(() => ({}))) as { message_id?: string; error?: { message?: string } };
  if (!res.ok || !j.message_id) throw new Error(`Instagram の DM を送れませんでした：${j.error?.message ?? `HTTP ${res.status}`}（相手の最後のメッセージから24時間を過ぎると送れません）`);
  return j.message_id;
}
