import type { SupabaseClient } from "@supabase/supabase-js";
import { downloadImage } from "../aio/images";
import { getSnsCredentials } from "../social-connect/tokens";
import { fetchTikTokVideos } from "../social-connect/tiktok";
import { apifyRunner, fetchInstagramBench, fetchTiktokBench, type ObservedX } from "./apify";
import { jstDay } from "./day";
import { igComments, igCreateContainer, igContainerStatus, igListDms, igOwnMedia, igPermalink, igPublish, igReplyComment, igSendDm } from "./ig";
import { analyzeMediaPatterns, draftCommentReplies, draftIgPosts, type MediaPlatform } from "./media-brain";
import { MATERIAL_COLUMNS, MEDIA_BUCKET, rowToMaterial } from "./materials";
import { OBSERVED_COLUMNS, OPS_POST_COLUMNS, rowToInbox, rowToObserved, rowToOpsPost, rowToPatternReport, saveObserved } from "./ops-store";
import type { OpsMedia, OpsPost } from "./ops-types";
import { loadSettings } from "./store";
import { createVideoDraft } from "./video-run";
import { draftDmReplies } from "./x-brain";
import { DEFAULT_X_CONFIG } from "./ops-types";
import { ytChannelVideos, ytComments, ytOwnVideos, ytReply } from "./youtube-api";
import { stepImages } from "./x-run";

/**
 * Instagram・TikTok・YouTube の運用の工程（集める → 自分の結果 → 型 → 案 → コメント・DM の返信案）。
 * X 運用と同じく、工程ごとにその場で保存し、毎日の自動では済んだ工程を繰り返さない。
 * 送るのは人が承認したものだけ（sendApprovedMedia）。
 */

export type MediaOpsConfig = { benchHandles: string[]; dailyIdeas: number; voice: string; longMinutes: number; rules: string };
export const DEFAULT_MEDIA_CONFIG: MediaOpsConfig = { benchHandles: [], dailyIdeas: 1, voice: "Kore", longMinutes: 12, rules: "" };

/** 画面の媒体 → 連携（sns_connections）・投稿案（sns_posts.platform）の名前 */
const CONN = { instagram: "meta", tiktok: "tiktok", youtube: "youtube" } as const;

export async function loadMediaConfig(sb: SupabaseClient, userId: string, platform: MediaPlatform): Promise<{ enabled: boolean; config: MediaOpsConfig }> {
  const { data } = await sb.from("sns_ops_settings").select("enabled, config").eq("user_id", userId).eq("platform", platform).maybeSingle();
  const c = (data?.config as Partial<MediaOpsConfig>) ?? {};
  return {
    enabled: data?.enabled === true,
    config: {
      benchHandles: Array.isArray(c.benchHandles) ? c.benchHandles.map(String) : [],
      dailyIdeas: typeof c.dailyIdeas === "number" ? Math.max(0, Math.min(5, c.dailyIdeas)) : DEFAULT_MEDIA_CONFIG.dailyIdeas,
      voice: typeof c.voice === "string" ? c.voice : DEFAULT_MEDIA_CONFIG.voice,
      longMinutes: typeof c.longMinutes === "number" ? Math.max(10, Math.min(20, c.longMinutes)) : DEFAULT_MEDIA_CONFIG.longMinutes,
      rules: typeof c.rules === "string" ? c.rules : "",
    },
  };
}

// ── 集める ─────────────────────

export async function mediaCollect(sb: SupabaseClient, admin: SupabaseClient, userId: string, platform: MediaPlatform): Promise<string> {
  const { config } = await loadMediaConfig(sb, userId, platform);
  if (!config.benchHandles.length) return "伸びているアカウントが未登録のため、飛ばしました";
  let items: ObservedX[] = [];
  if (platform === "instagram") items = await fetchInstagramBench(apifyRunner(admin, userId), config.benchHandles);
  else if (platform === "tiktok") items = await fetchTiktokBench(apifyRunner(admin, userId), config.benchHandles);
  else {
    const key = process.env.YOUTUBE_API_KEY || process.env.GOOGLE_MAPS_API_KEY || "";
    if (!key) throw new Error("YouTube の公開データを読む API キー（YOUTUBE_API_KEY）が未設定です");
    const settled = await Promise.allSettled(config.benchHandles.slice(0, 8).map((h) => ytChannelVideos(key, h, 12)));
    for (const r of settled) {
      if (r.status !== "fulfilled") continue;
      items.push(
        ...r.value.map((v) => ({
          externalId: v.id,
          author: v.channelTitle,
          authorName: v.channelTitle,
          authorFollowers: null,
          text: `${v.title}\n${v.description.slice(0, 300)}${v.durationSec ? `\n（${Math.round(v.durationSec / 60)}分）` : ""}`,
          url: `https://www.youtube.com/watch?v=${v.id}`,
          media: v.thumbnail ? [{ type: "thumbnail", url: v.thumbnail }] : [],
          likes: v.likes,
          reposts: null,
          replies: v.comments,
          quotes: null,
          views: v.views,
          bookmarks: null,
          isReply: false,
          conversationId: null,
          postedAt: v.publishedAt,
        }))
      );
    }
  }
  const n = await saveObserved(sb, userId, "bench", items, null, platform);
  return `伸びている投稿を${n}件集めました`;
}

/** 自分の投稿・動画の結果 */
export async function mediaOwn(sb: SupabaseClient, userId: string, platform: MediaPlatform): Promise<string> {
  const cred = await getSnsCredentials(userId, CONN[platform]);
  if (!cred) throw new Error("アカウントが連携されていません");
  const prof = cred.profile as Record<string, unknown>;
  let items: ObservedX[] = [];
  const base = { authorName: "", authorFollowers: null, reposts: null, quotes: null, bookmarks: null, isReply: false, conversationId: null };
  if (platform === "instagram") {
    const ms = await igOwnMedia(cred.accessToken, String(prof.igBusinessId ?? ""), 30);
    items = ms.map((m) => ({ ...base, externalId: m.id, author: String(prof.username ?? ""), text: m.caption, url: m.permalink, media: m.mediaUrl ? [{ type: m.mediaType.toLowerCase(), url: m.mediaUrl }] : [], likes: m.likes, replies: m.comments, views: null, postedAt: m.timestamp }));
  } else if (platform === "tiktok") {
    const vs = await fetchTikTokVideos(cred.accessToken, 20);
    items = vs.map((v) => ({ ...base, externalId: v.id, author: String(prof.displayName ?? ""), text: v.title ?? "", url: "", media: [], likes: v.likeCount, replies: v.commentCount, reposts: v.shareCount, views: v.viewCount, postedAt: v.createTime ? new Date(v.createTime * 1000).toISOString() : null }));
  } else {
    const up = String(prof.uploadsPlaylistId ?? "");
    if (!up) throw new Error("YouTube の連携情報が古いです。連携し直してください");
    const vs = await ytOwnVideos(cred.accessToken, up, 30);
    items = vs.map((v) => ({ ...base, externalId: v.id, author: v.channelTitle, text: v.title, url: `https://www.youtube.com/watch?v=${v.id}`, media: [], likes: v.likes, replies: v.comments, views: v.views, postedAt: v.publishedAt }));
  }
  await saveObserved(sb, userId, "own", items, null, platform);
  // 承認して送った動画・投稿の数字を更新する
  const byId = new Map(items.map((i) => [i.externalId, i]));
  const { data: vids } = await sb.from("sns_videos").select("id, external_id").eq("user_id", userId).eq("platform", platform).eq("status", "published").limit(60);
  for (const r of (vids ?? []) as { id: string; external_id: string | null }[]) {
    const i = r.external_id ? byId.get(r.external_id) : null;
    if (i) await sb.from("sns_videos").update({ metrics: { views: i.views, likes: i.likes, comments: i.replies, shares: i.reposts } }).eq("id", r.id);
  }
  return `自分の投稿${items.length}件の数字を取り込みました`;
}

async function observedFor(sb: SupabaseClient, userId: string, platform: MediaPlatform) {
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const { data } = await sb.from("sns_observed_posts").select(OBSERVED_COLUMNS).eq("user_id", userId).eq("platform", platform).gte("fetched_at", since).order("posted_at", { ascending: false }).limit(300);
  return ((data ?? []) as Record<string, unknown>[]).map(rowToObserved);
}

export async function mediaPatterns(sb: SupabaseClient, userId: string, platform: MediaPlatform): Promise<string> {
  const [brand, observed] = await Promise.all([loadSettings(sb, userId), observedFor(sb, userId, platform)]);
  const r = await analyzeMediaPatterns(platform, brand, observed);
  const { error } = await sb.from("sns_patterns").insert({ user_id: userId, platform, body: r });
  if (error) throw new Error(`分析を保存できませんでした：${error.message}`);
  return `伸びた型を${r.patterns.length}つ見つけました`;
}

/** Instagram のフィード投稿案（写真は素材か AI 画像） */
export async function igPostIdeas(sb: SupabaseClient, admin: SupabaseClient, userId: string, count: number, theme?: string): Promise<string> {
  const [brand, { data: mats }, { data: rep }, { data: recent }] = await Promise.all([
    loadSettings(sb, userId),
    sb.from("sns_materials").select(MATERIAL_COLUMNS).eq("user_id", userId).order("created_at", { ascending: false }).limit(150),
    sb.from("sns_patterns").select("id, body, created_at").eq("user_id", userId).eq("platform", "instagram").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    sb.from("sns_posts").select("body").eq("user_id", userId).eq("platform", "meta").eq("kind", "post").order("created_at", { ascending: false }).limit(15),
  ]);
  const materials = ((mats ?? []) as Record<string, unknown>[]).map(rowToMaterial);
  const posts = await draftIgPosts(brand, rep ? rowToPatternReport(rep as Record<string, unknown>) : null, materials, ((recent ?? []) as { body: string }[]).map((r) => r.body), count, theme);
  if (!posts.length) throw new Error("投稿案を作れませんでした");
  const byId = new Map(materials.map((m) => [m.id, m]));
  const rows = posts.map((p) => ({
    user_id: userId,
    platform: "meta",
    kind: "post",
    topic: (theme ?? "").slice(0, 300),
    body: p.caption,
    hashtags: p.hashtags,
    media: p.slides.map((s, i) => ({ key: `img${i + 1}`, type: "image", path: s.materialId ? (byId.get(s.materialId)?.path ?? null) : null, prompt: s.prompt ?? "", alt: s.alt })) satisfies OpsMedia[],
    pattern: p.pattern,
    reason: p.reason,
    guard: p.guard,
    status: "draft",
    source: "ops",
  }));
  const { error } = await sb.from("sns_posts").insert(rows);
  if (error) throw new Error(`投稿案を保存できませんでした：${error.message}`);
  // 画像は正方形に近い 4:5 で作る（Instagram のフィード）
  const msg = await stepImages(sb, admin, userId, { deadline: Date.now() + 150_000, aspect: "4:5", platform: "meta" });
  return `投稿案を${rows.length}本作りました。${msg}`;
}

/** 毎日の動画の案（台本まで。画像・ナレーションは人が「準備する」を押したときに作る＝費用を抑える） */
export async function videoIdeas(sb: SupabaseClient, userId: string, platform: MediaPlatform, count: number, opt: { theme?: string; format?: "short" | "long"; auto?: boolean } = {}): Promise<string> {
  const { config } = await loadMediaConfig(sb, userId, platform);
  const format = opt.format ?? (platform === "youtube" ? "long" : "short");
  const made: string[] = [];
  const errors: string[] = [];
  for (let i = 0; i < Math.max(1, Math.min(3, count)); i++) {
    try {
      made.push(await createVideoDraft(sb, userId, { platform, format, theme: opt.theme ?? "", voice: config.voice, minutes: config.longMinutes, auto: opt.auto }));
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
      break;
    }
  }
  if (!made.length) throw new Error(errors[0] ?? "動画の案を作れませんでした");
  return `動画の案を${made.length}本作りました（台本まで。「準備する」で画像とナレーションを作ります）`;
}

/** コメントへの返信案（Instagram・YouTube） */
export async function mediaComments(sb: SupabaseClient, userId: string, platform: "instagram" | "youtube"): Promise<string> {
  const cred = await getSnsCredentials(userId, CONN[platform]);
  if (!cred) throw new Error("アカウントが連携されていません");
  const prof = cred.profile as Record<string, unknown>;
  let comments: { id: string; text: string; author: string; context: string }[] = [];
  const contexts = new Map<string, string>();
  if (platform === "instagram") {
    const ms = await igOwnMedia(cred.accessToken, String(prof.igBusinessId ?? ""), 10);
    ms.forEach((m) => contexts.set(m.id, m.caption.slice(0, 80)));
    const cs = await igComments(cred.accessToken, ms.filter((m) => (m.comments ?? 0) > 0).map((m) => m.id), String(prof.username ?? ""));
    comments = cs.filter((c) => !c.replied).map((c) => ({ id: c.id, text: c.text, author: c.username, context: contexts.get(c.mediaId) ?? "" }));
  } else {
    const cs = await ytComments(cred.accessToken, String(prof.id ?? ""));
    comments = cs.filter((c) => !c.replied).map((c) => ({ id: c.id, text: c.text, author: c.author, context: c.videoId }));
  }
  const { data: done } = await sb.from("sns_posts").select("target").eq("user_id", userId).eq("platform", CONN[platform]).eq("kind", "reply").limit(500);
  const used = new Set(((done ?? []) as { target: { externalId?: string } | null }[]).map((d) => d.target?.externalId));
  const todo = comments.filter((c) => !used.has(c.id)).slice(0, 25);
  if (!todo.length) return "返信が要るコメントはありません";
  const brand = await loadSettings(sb, userId);
  const drafts = await draftCommentReplies(platform, brand, todo);
  const byId = new Map(todo.map((c) => [c.id, c]));
  const rows = drafts.map((d) => ({
    user_id: userId,
    platform: CONN[platform],
    kind: "reply",
    body: d.text,
    reason: `${d.needsHuman ? "【人の判断が要る】" : ""}${d.reason}`,
    guard: d.guard,
    status: d.needsHuman && !d.text ? "skipped" : "draft",
    source: "ops_auto",
    target: { externalId: d.commentId, author: byId.get(d.commentId)?.author ?? "", text: byId.get(d.commentId)?.text.slice(0, 400) ?? "", summoned: true },
  }));
  if (rows.length) {
    const { error } = await sb.from("sns_posts").insert(rows);
    if (error) throw new Error(`返信案を保存できませんでした：${error.message}`);
  }
  return `コメント${todo.length}件に返信案を作りました`;
}

/** Instagram の DM：読み込んで、返していない会話に返信案 */
export async function igDms(sb: SupabaseClient, userId: string): Promise<string> {
  const cred = await getSnsCredentials(userId, "meta");
  if (!cred) throw new Error("Instagram が連携されていません");
  const prof = cred.profile as Record<string, unknown>;
  const dms = await igListDms(cred.accessToken, String(prof.pageId ?? ""), String(prof.igBusinessId ?? ""));
  if (dms.length) {
    await sb.from("sns_inbox").upsert(
      dms.map((d) => ({ user_id: userId, platform: "meta", external_id: d.id, conversation_id: d.conversationId, sender_id: d.fromId, sender_name: d.fromName, from_me: d.fromMe, text: d.text.slice(0, 4000), sent_at: d.createdAt })),
      { onConflict: "user_id,platform,external_id" }
    );
  }
  const { data: inbox } = await sb.from("sns_inbox").select("id, external_id, conversation_id, sender_id, sender_name, from_me, text, sent_at").eq("user_id", userId).eq("platform", "meta").order("sent_at", { ascending: true }).limit(500);
  const msgs = ((inbox ?? []) as Record<string, unknown>[]).map(rowToInbox);
  const convs = new Map<string, typeof msgs>();
  for (const m of msgs) convs.set(m.conversationId, [...(convs.get(m.conversationId) ?? []), m]);
  const { data: pending } = await sb.from("sns_posts").select("target").eq("user_id", userId).eq("platform", "meta").eq("kind", "dm").in("status", ["draft", "approved"]);
  const hasDraft = new Set(((pending ?? []) as { target: { conversationId?: string } | null }[]).map((p) => p.target?.conversationId));
  const todo = [...convs.entries()]
    .filter(([id, list]) => !hasDraft.has(id) && list.length && !list[list.length - 1].fromMe)
    .map(([id, list]) => ({ conversationId: id, senderName: list.find((m) => !m.fromMe)?.senderName ?? "", messages: list }));
  if (!todo.length) return `DM を${dms.length}件読み込みました（返信が要る会話はありません）`;
  const brand = await loadSettings(sb, userId);
  const drafts = await draftDmReplies(brand, DEFAULT_X_CONFIG, todo);
  const sender = new Map(todo.map((t) => [t.conversationId, t.messages.find((m) => !m.fromMe)?.senderId ?? ""]));
  if (drafts.length) {
    await sb.from("sns_posts").insert(
      drafts.map((d) => ({ user_id: userId, platform: "meta", kind: "dm", body: d.text, reason: `${d.needsHuman ? "【人の判断が要る】" : ""}${d.reason}`, guard: d.guard, status: "draft", source: "ops_auto", target: { ...d.target, recipientId: sender.get(d.conversationId) } }))
    );
  }
  return `DM を${dms.length}件読み込み、${drafts.length}件の返信案を作りました`;
}

// ── 送る（Instagram の投稿・コメントの返信・DM、YouTube のコメントの返信） ─────────────────────

/**
 * 承認済みの案を送る。Instagram の投稿は画像1枚ごとのコンテナ ID を media_ids に保存し、
 * カルーセル → 公開の順に、やり直しでは続きから進める（二重投稿しない）
 */
export async function sendApprovedMedia(sb: SupabaseClient, admin: SupabaseClient, userId: string, postId: string, getCreds: typeof getSnsCredentials = getSnsCredentials, sign?: (path: string) => Promise<string>, wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<"published" | "processing"> {
  const { data } = await sb.from("sns_posts").select(`${OPS_POST_COLUMNS}, media_ids`).eq("id", postId).eq("user_id", userId).maybeSingle();
  if (!data) throw new Error("案が見つかりません");
  const post: OpsPost = rowToOpsPost(data as Record<string, unknown>);
  if (post.status === "published") return "published";
  if (post.status !== "approved") throw new Error("承認されていない案は送れません");
  if (post.guard?.level === "red") throw new Error("表現チェックで「要修正」が残っています");
  const ids: Record<string, string> = { ...(((data as Record<string, unknown>).media_ids as Record<string, string>) ?? {}) };
  const saveIds = async () => {
    await sb.from("sns_posts").update({ media_ids: ids }).eq("id", postId);
  };
  const done = async (externalId: string) => {
    await sb.from("sns_posts").update({ status: "published", published_via: "api", published_at: new Date().toISOString(), external_id: externalId, external_ids: [externalId], error_message: null, updated_at: new Date().toISOString() }).eq("id", postId);
    return "published" as const;
  };

  try {
    if (post.platform === "youtube") {
      if (post.kind !== "reply" || !post.target?.externalId) throw new Error("YouTube で送れるのはコメントへの返信だけです");
      const cred = await getCreds(userId, "youtube");
      if (!cred) throw new Error("YouTube が連携されていません");
      if (ids.sent) return done(ids.sent);
      ids.sent = await ytReply(cred.accessToken, post.target.externalId, post.body);
      await saveIds();
      return done(ids.sent);
    }
    const cred = await getCreds(userId, "meta");
    if (!cred) throw new Error("Instagram が連携されていません");
    const prof = cred.profile as Record<string, unknown>;
    const igId = String(prof.igBusinessId ?? "");
    if (post.kind === "reply") {
      if (ids.sent) return done(ids.sent);
      ids.sent = await igReplyComment(cred.accessToken, String(post.target?.externalId ?? ""), post.body);
      await saveIds();
      return done(ids.sent);
    }
    if (post.kind === "dm") {
      if (ids.sent) return done(ids.sent);
      const rid = String((post.target as { recipientId?: string } | null)?.recipientId ?? "");
      if (!rid) throw new Error("DM の送り先が分かりません。DM を読み込み直してください");
      ids.sent = await igSendDm(cred.accessToken, String(prof.pageId ?? ""), rid, post.body);
      await saveIds();
      return done(ids.sent);
    }
    // フィード投稿（1枚 or カルーセル）
    const imgs = post.media.filter((m) => m.path && !m.hasText).slice(0, 10);
    if (!imgs.length) throw new Error("Instagram の投稿には画像が要ります");
    const caption = [post.body, post.hashtags.map((h) => `#${h}`).join(" ")].filter(Boolean).join("\n\n");
    const signUrl =
      sign ??
      (async (p: string) => {
        const { data: s } = await admin.storage.from(MEDIA_BUCKET).createSignedUrl(p, 60 * 60 * 6);
        if (!s?.signedUrl) throw new Error("画像の URL を作れませんでした");
        return s.signedUrl;
      });
    if (!ids.container) {
      if (imgs.length === 1) {
        ids.container = await igCreateContainer(cred.accessToken, igId, { imageUrl: await signUrl(imgs[0].path!), caption });
      } else {
        for (const m of imgs) {
          if (ids[`c_${m.key}`]) continue;
          ids[`c_${m.key}`] = await igCreateContainer(cred.accessToken, igId, { imageUrl: await signUrl(m.path!), carouselItem: true });
          await saveIds();
        }
        ids.container = await igCreateContainer(cred.accessToken, igId, { children: imgs.map((m) => ids[`c_${m.key}`]), caption });
      }
      await saveIds();
    }
    if (!ids.published) {
      for (let k = 0; k < 12; k++) {
        const st = await igContainerStatus(cred.accessToken, ids.container);
        if (st === "FINISHED" || st === "PUBLISHED") break;
        if (st === "ERROR" || st === "EXPIRED") {
          delete ids.container;
          await saveIds();
          throw new Error("Instagram で画像の処理に失敗しました。もう一度送ってください");
        }
        await wait(3000);
      }
      ids.published = await igPublish(cred.accessToken, igId, ids.container);
      await saveIds();
    }
    const link = await igPermalink(cred.accessToken, ids.published);
    if (link) await sb.from("sns_posts").update({ target: { url: link } }).eq("id", postId);
    return done(ids.published);
  } catch (e) {
    await sb.from("sns_posts").update({ error_message: (e instanceof Error ? e.message : String(e)).slice(0, 400), updated_at: new Date().toISOString() }).eq("id", postId);
    throw e;
  }
}

/** 画像の取得（Storage）。テストで差し替えられるよう分けておく */
export const mediaDownload = (admin: SupabaseClient, path: string) => downloadImage(admin, path, MEDIA_BUCKET);

// ── 毎日の自動 ─────────────────────

type StepState = Record<string, { done?: boolean; at?: string; error?: string; tries?: number; note?: string }>;

export async function runDailyMedia(admin: SupabaseClient, userId: string, platform: MediaPlatform, deadline: number, impl?: Record<string, () => Promise<string>>): Promise<StepState> {
  const day = jstDay();
  const { data } = await admin.from("sns_daily_runs").select("steps").eq("user_id", userId).eq("platform", platform).eq("day", day).maybeSingle();
  const steps: StepState = ((data?.steps as StepState) ?? {}) as StepState;
  const save = () => admin.from("sns_daily_runs").upsert({ user_id: userId, platform, day, steps, updated_at: new Date().toISOString() }, { onConflict: "user_id,platform,day" });
  const { config } = await loadMediaConfig(admin, userId, platform);
  const run: Record<string, () => Promise<string>> = {
    collect: () => mediaCollect(admin, admin, userId, platform),
    own: () => mediaOwn(admin, userId, platform),
    patterns: () => mediaPatterns(admin, userId, platform),
    ideas: () => (config.dailyIdeas ? (platform === "instagram" ? igPostIdeas(admin, admin, userId, config.dailyIdeas) : videoIdeas(admin, userId, platform, config.dailyIdeas, { auto: true })) : Promise.resolve("毎日の案の数が0のため、飛ばしました")),
    ...(platform !== "tiktok" ? { comments: () => mediaComments(admin, userId, platform as "instagram" | "youtube") } : {}),
    ...(platform === "instagram" ? { dms: () => igDms(admin, userId) } : {}),
    ...impl,
  };
  for (const s of Object.keys(run)) {
    const st = steps[s] ?? {};
    if (st.done || (st.tries ?? 0) >= 2) continue;
    if (Date.now() > deadline - 100_000) break;
    try {
      steps[s] = { done: true, at: new Date().toISOString(), note: await run[s]() };
    } catch (e) {
      steps[s] = { done: false, at: new Date().toISOString(), error: (e instanceof Error ? e.message : String(e)).slice(0, 300), tries: (st.tries ?? 0) + 1 };
    }
    await save();
  }
  return steps;
}
