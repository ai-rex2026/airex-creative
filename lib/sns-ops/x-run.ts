import type { SupabaseClient } from "@supabase/supabase-js";
import { defaultImageDeps, downloadImage, fillImages } from "../aio/images";
import { getSnsCredentials } from "../social-connect/tokens";
import { apifyRunner, fetchBenchPosts, searchHotPosts, type ObservedX } from "./apify";
import { jstDay } from "./day";
import { loadSettings } from "./store";
import { OBSERVED_COLUMNS, OPS_POST_COLUMNS, loadXConfig, rowToInbox, rowToObserved, rowToOpsPost, rowToPatternReport, saveObserved } from "./ops-store";
import type { OpsMedia, OpsPost } from "./ops-types";
import { analyzePatterns, draftDmReplies, draftXPosts, suggestEngagements } from "./x-brain";
import { xListDms, xOwnPosts, xRepost, xSendDm, xCreatePost, xUploadMedia } from "./x-api";
import { NeedsHumanError, publishX } from "./x-publish";

/**
 * X 運用の工程。手動のボタンからも、毎日の自動（/api/cron/sns-ops）からも同じ関数を呼ぶ。
 * どの工程も、終わった時点でその結果だけをその場で保存する（AGENTS.md）。
 * 自動の実行は sns_daily_runs に工程ごとの済み印を付け、済んだ工程（＝済んだ有料の呼び出し）を繰り返さない。
 *
 * sb は本人のセッション（RLS）か service role。どちらでも user_id で絞る。
 */

export const SNS_MEDIA_BUCKET = "sns-media";

/** 画像づくり用に足した aspect を、保存の前に外す */
export function stripAspect<T extends { aspect?: string }>(m: T): Omit<T, "aspect"> {
  const rest = { ...m };
  delete rest.aspect;
  return rest;
}
export const OPS_SOURCES = ["ops", "ops_auto"] as const;

export type XStep = "bench" | "search" | "own" | "patterns" | "drafts" | "images" | "engage" | "dms";
export const DAILY_STEPS: XStep[] = ["bench", "search", "own", "patterns", "drafts", "images", "engage", "dms"];

async function xAccount(userId: string) {
  const cred = await getSnsCredentials(userId, "x");
  if (!cred) throw new Error("X が連携されていません");
  const p = cred.profile as { id?: string; username?: string };
  if (!p.id) throw new Error("X の連携情報にアカウント ID がありません。連携し直してください");
  return { token: cred.accessToken, myId: String(p.id), myHandle: p.username ? String(p.username) : null, scope: cred.scope ?? "" };
}

// ── 集める ─────────────────────

export async function stepBench(sb: SupabaseClient, admin: SupabaseClient, userId: string): Promise<string> {
  const { config } = await loadXConfig(sb, userId);
  if (!config.benchHandles.length) return "伸びているアカウントが未登録のため、飛ばしました";
  const items = await fetchBenchPosts(apifyRunner(admin, userId), config.benchHandles);
  const me = await xAccount(userId).catch(() => null);
  const n = await saveObserved(sb, userId, "bench", items.filter((x) => !x.isReply), me?.myHandle ?? null);
  return `伸びているアカウントの投稿を${n}件集めました`;
}

export async function stepSearch(sb: SupabaseClient, admin: SupabaseClient, userId: string): Promise<string> {
  const { config } = await loadXConfig(sb, userId);
  if (!config.keywords.length) return "キーワードが未登録のため、飛ばしました";
  const items = await searchHotPosts(apifyRunner(admin, userId), config.keywords);
  const me = await xAccount(userId).catch(() => null);
  const n = await saveObserved(sb, userId, "search", items, me?.myHandle ?? null);
  return `話題の投稿を${n}件集めました`;
}

/** 自分の投稿の結果（X API の自分のデータの読み取り）。承認して送った案の数字も更新する */
export async function stepOwn(sb: SupabaseClient, userId: string): Promise<string> {
  const me = await xAccount(userId);
  const posts = await xOwnPosts(me.token, me.myId, 60);
  const items: ObservedX[] = posts.map((p) => ({
    externalId: p.id,
    author: me.myHandle ?? "",
    authorName: "",
    authorFollowers: null,
    text: p.text,
    url: `https://x.com/${me.myHandle ?? "i"}/status/${p.id}`,
    media: [],
    likes: p.likes,
    reposts: p.reposts,
    replies: p.replies,
    quotes: p.quotes,
    views: p.impressions,
    bookmarks: p.bookmarks,
    isReply: !!p.inReplyTo,
    conversationId: p.conversationId,
    postedAt: p.createdAt,
  }));
  await saveObserved(sb, userId, "own", items, null);
  const byId = new Map(posts.map((p) => [p.id, p]));
  const { data } = await sb.from("sns_posts").select("id, external_ids").eq("user_id", userId).eq("platform", "x").eq("status", "published").order("published_at", { ascending: false }).limit(60);
  for (const r of (data ?? []) as { id: string; external_ids: string[] }[]) {
    const p = byId.get(r.external_ids?.[0] ?? "");
    if (p) await sb.from("sns_posts").update({ metrics: { likes: p.likes, reposts: p.reposts, replies: p.replies, quotes: p.quotes, impressions: p.impressions, bookmarks: p.bookmarks }, metrics_at: new Date().toISOString() }).eq("id", r.id);
  }
  return `自分の投稿${posts.length}件の数字を取り込みました`;
}

// ── 分析・案 ─────────────────────

async function recentObserved(sb: SupabaseClient, userId: string, days = 14) {
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const { data } = await sb.from("sns_observed_posts").select(OBSERVED_COLUMNS).eq("user_id", userId).eq("platform", "x").gte("fetched_at", since).order("posted_at", { ascending: false }).limit(300);
  return ((data ?? []) as Record<string, unknown>[]).map(rowToObserved);
}

export async function stepPatterns(sb: SupabaseClient, userId: string): Promise<string> {
  const [brand, { config }, observed] = await Promise.all([loadSettings(sb, userId), loadXConfig(sb, userId), recentObserved(sb, userId)]);
  const r = await analyzePatterns(brand, config, observed);
  const { error } = await sb.from("sns_patterns").insert({ user_id: userId, platform: "x", body: r });
  if (error) throw new Error(`分析を保存できませんでした：${error.message}`);
  return `伸びた型を${r.patterns.length}つ見つけました`;
}

export async function stepDrafts(sb: SupabaseClient, userId: string, opt: { count?: number; theme?: string; auto?: boolean } = {}): Promise<string> {
  const [brand, { config }, observed, { data: rep }, { data: recent }] = await Promise.all([
    loadSettings(sb, userId),
    loadXConfig(sb, userId),
    recentObserved(sb, userId),
    sb.from("sns_patterns").select("id, body, created_at").eq("user_id", userId).eq("platform", "x").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    sb.from("sns_posts").select("body").eq("user_id", userId).eq("platform", "x").eq("kind", "post").order("created_at", { ascending: false }).limit(20),
  ]);
  const count = Math.max(1, Math.min(10, opt.count ?? config.dailyDrafts));
  if (!opt.count && config.dailyDrafts === 0) return "毎日の案の数が0のため、飛ばしました";
  const examples = observed.filter((o) => o.source !== "own").sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0)).slice(0, 8);
  const drafts = await draftXPosts(brand, config, rep ? rowToPatternReport(rep as Record<string, unknown>) : null, examples, ((recent ?? []) as { body: string }[]).map((r) => r.body), count, opt.theme);
  if (!drafts.length) throw new Error("投稿案を作れませんでした");
  const rows = drafts.map((d) => ({
    user_id: userId,
    platform: "x",
    kind: "post",
    topic: (opt.theme ?? "").slice(0, 600),
    body: d.body,
    thread: d.thread,
    hashtags: d.hashtags,
    media: d.image ? ([{ key: "img1", type: "image", path: null, prompt: d.image.prompt, alt: d.image.alt }] satisfies OpsMedia[]) : [],
    pattern: d.pattern,
    reason: [d.reason, ...d.warnings].filter(Boolean).join(" / "),
    guard: d.guard,
    status: "draft",
    source: opt.auto ? "ops_auto" : "ops",
  }));
  const { error } = await sb.from("sns_posts").insert(rows);
  if (error) throw new Error(`投稿案を保存できませんでした：${error.message}`);
  return `投稿案を${rows.length}本作りました`;
}

/** まだ作っていない画像だけを作る（1枚ごとに保存）。案ごとに直列で、時間切れの前に止める */
export async function stepImages(sb: SupabaseClient, admin: SupabaseClient, userId: string, opt: { postId?: string; deadline?: number } = {}): Promise<string> {
  let q = sb.from("sns_posts").select("id, media").eq("user_id", userId).eq("status", "draft").order("created_at", { ascending: false }).limit(20);
  if (opt.postId) q = q.eq("id", opt.postId);
  const { data } = await q;
  let made = 0;
  let failed = 0;
  for (const r of (data ?? []) as { id: string; media: OpsMedia[] }[]) {
    if (opt.deadline && Date.now() > opt.deadline) break;
    const media = (r.media ?? []).map((m) => ({ ...m, aspect: "16:9" }));
    if (!media.some((m) => !m.path && !m.hasText && m.type === "image")) continue;
    const res = await fillImages(defaultImageDeps(admin, SNS_MEDIA_BUCKET), `${userId}/${r.id}`, media, async (next) => {
      await sb.from("sns_posts").update({ media: next.map(stripAspect), updated_at: new Date().toISOString() }).eq("id", r.id);
    });
    made += res.made;
    failed += res.failed;
  }
  return `画像を${made}枚作りました${failed ? `（${failed}枚は作れませんでした）` : ""}`;
}

/** 反応（リプライ・引用・リポスト）の候補 */
export async function stepEngage(sb: SupabaseClient, userId: string, opt: { count?: number } = {}): Promise<string> {
  const [brand, { config }, observed, { data: done }] = await Promise.all([
    loadSettings(sb, userId),
    loadXConfig(sb, userId),
    recentObserved(sb, userId, 3),
    sb.from("sns_posts").select("target").eq("user_id", userId).eq("platform", "x").in("kind", ["reply", "quote", "repost"]).order("created_at", { ascending: false }).limit(200),
  ]);
  const count = Math.max(1, Math.min(10, opt.count ?? config.dailyEngage));
  if (!opt.count && config.dailyEngage === 0) return "毎日の反応の候補の数が0のため、飛ばしました";
  const used = new Set(((done ?? []) as { target: { externalId?: string } | null }[]).map((d) => d.target?.externalId).filter(Boolean));
  const since = Date.now() - 2 * 864e5;
  const candidates = observed
    .filter((o) => o.source !== "own" && !used.has(o.externalId) && (!o.postedAt || new Date(o.postedAt).getTime() > since))
    .sort((a, b) => Number(b.mentionsMe) - Number(a.mentionsMe) || (b.rate ?? 0) - (a.rate ?? 0))
    .slice(0, 40);
  if (!candidates.length) return "反応する候補の投稿がありません（先に投稿を集めてください）";
  const items = await suggestEngagements(brand, config, candidates, count);
  const byId = new Map(candidates.map((c) => [c.externalId, c]));
  const rows = items.map((i) => {
    const c = byId.get(i.externalId)!;
    return {
      user_id: userId,
      platform: "x",
      kind: i.action,
      body: i.text,
      reason: i.reason,
      guard: i.guard,
      status: "draft",
      source: "ops_auto",
      target: { externalId: c.externalId, url: c.url, author: c.author, text: c.text.slice(0, 400), summoned: c.mentionsMe },
    };
  });
  if (rows.length) {
    const { error } = await sb.from("sns_posts").insert(rows);
    if (error) throw new Error(`反応の候補を保存できませんでした：${error.message}`);
  }
  return `反応の候補を${rows.length}件出しました`;
}

/** DM を読み込み、返していない会話に返信案を作る */
export async function stepDms(sb: SupabaseClient, userId: string): Promise<string> {
  const me = await xAccount(userId);
  if (!/\bdm\.read\b/.test(me.scope)) return "DM を読む権限が無い連携です（X を連携し直すと DM を扱えます）";
  const { events, users } = await xListDms(me.token, 60);
  if (events.length) {
    const rows = events.map((e) => ({
      user_id: userId,
      platform: "x",
      external_id: e.id,
      conversation_id: e.conversationId,
      sender_id: e.senderId,
      sender_name: users[e.senderId] ? `${users[e.senderId].name}（@${users[e.senderId].username}）` : e.senderId,
      from_me: e.senderId === me.myId,
      text: e.text.slice(0, 4000),
      sent_at: e.createdAt,
    }));
    await sb.from("sns_inbox").upsert(rows, { onConflict: "user_id,platform,external_id" });
  }
  const { data: inbox } = await sb.from("sns_inbox").select("id, external_id, conversation_id, sender_id, sender_name, from_me, text, sent_at").eq("user_id", userId).eq("platform", "x").order("sent_at", { ascending: true }).limit(500);
  const msgs = ((inbox ?? []) as Record<string, unknown>[]).map(rowToInbox);
  const convs = new Map<string, typeof msgs>();
  for (const m of msgs) convs.set(m.conversationId, [...(convs.get(m.conversationId) ?? []), m]);
  const { data: pending } = await sb.from("sns_posts").select("target").eq("user_id", userId).eq("platform", "x").eq("kind", "dm").in("status", ["draft", "approved"]);
  const hasDraft = new Set(((pending ?? []) as { target: { conversationId?: string } | null }[]).map((p) => p.target?.conversationId));
  const todo = [...convs.entries()]
    .filter(([id, list]) => !hasDraft.has(id) && list.length && !list[list.length - 1].fromMe)
    .map(([id, list]) => ({ conversationId: id, senderName: list.find((m) => !m.fromMe)?.senderName ?? "", messages: list }));
  if (!todo.length) return `DM を${events.length}件読み込みました（返信が要る会話はありません）`;
  const [brand, { config }] = await Promise.all([loadSettings(sb, userId), loadXConfig(sb, userId)]);
  const drafts = await draftDmReplies(brand, config, todo);
  if (drafts.length) {
    const { error } = await sb.from("sns_posts").insert(
      drafts.map((d) => ({ user_id: userId, platform: "x", kind: "dm", body: d.text, reason: `${d.needsHuman ? "【人の判断が要る】" : ""}${d.reason}`, guard: d.guard, status: "draft", source: "ops_auto", target: d.target }))
    );
    if (error) throw new Error(`DM の返信案を保存できませんでした：${error.message}`);
  }
  return `DM を${events.length}件読み込み、${drafts.length}件の返信案を作りました`;
}

// ── 送る ─────────────────────

/**
 * 承認済みの案を送る。送れたら published、規約で API から送れない相手は needs_human を返す（状態は approved のまま）。
 * 失敗は error_message に残し、状態は approved のまま（次に押したとき・次の自動で続きから送る）
 */
export async function sendApproved(sb: SupabaseClient, admin: SupabaseClient, userId: string, postId: string): Promise<"published" | "needs_human"> {
  const { data } = await sb.from("sns_posts").select(`${OPS_POST_COLUMNS}, media_ids`).eq("id", postId).eq("user_id", userId).maybeSingle();
  if (!data) throw new Error("案が見つかりません");
  const post: OpsPost = rowToOpsPost(data as Record<string, unknown>);
  if (post.status === "published") return "published";
  if (post.status !== "approved") throw new Error("承認されていない案は送れません");
  if (post.guard?.level === "red") throw new Error("表現チェックで「要修正」が残っています");
  const me = await xAccount(userId);
  try {
    const r = await publishX(
      {
        download: (p) => downloadImage(admin, p, SNS_MEDIA_BUCKET),
        upload: (f) => xUploadMedia(me.token, f),
        post: (p) => xCreatePost(me.token, p),
        repost: (id) => xRepost(me.token, me.myId, id),
        dm: (c, t) => xSendDm(me.token, c, t),
      },
      post,
      ((data as Record<string, unknown>).media_ids as Record<string, string>) ?? {},
      {
        mediaIds: async (m) => {
          await sb.from("sns_posts").update({ media_ids: m }).eq("id", postId);
        },
        externalIds: async (ids) => {
          await sb.from("sns_posts").update({ external_ids: ids, external_id: ids[0] ?? null }).eq("id", postId);
        },
      }
    );
    await sb.from("sns_posts").update({ status: "published", published_via: "api", published_at: new Date().toISOString(), external_id: r.externalIds[0] ?? null, error_message: null, updated_at: new Date().toISOString() }).eq("id", postId);
    return "published";
  } catch (e) {
    if (e instanceof NeedsHumanError) return "needs_human";
    await sb.from("sns_posts").update({ error_message: (e instanceof Error ? e.message : String(e)).slice(0, 400), updated_at: new Date().toISOString() }).eq("id", postId);
    throw e;
  }
}

// ── 毎日の自動 ─────────────────────

type StepState = Record<string, { done?: boolean; at?: string; error?: string; tries?: number; note?: string }>;

/** 1ユーザー分の今日の工程を、済んでいないものから順に進める（期限までに終わらなければ次の回に続き） */
export async function runDailyX(admin: SupabaseClient, userId: string, deadline: number, impl?: Partial<Record<XStep, () => Promise<string>>>): Promise<StepState> {
  const day = jstDay();
  const { data } = await admin.from("sns_daily_runs").select("steps").eq("user_id", userId).eq("platform", "x").eq("day", day).maybeSingle();
  const steps: StepState = ((data?.steps as StepState) ?? {}) as StepState;
  const save = () => admin.from("sns_daily_runs").upsert({ user_id: userId, platform: "x", day, steps, updated_at: new Date().toISOString() }, { onConflict: "user_id,platform,day" });

  const run: Record<XStep, () => Promise<string>> = {
    bench: () => stepBench(admin, admin, userId),
    search: () => stepSearch(admin, admin, userId),
    own: () => stepOwn(admin, userId),
    patterns: () => stepPatterns(admin, userId),
    drafts: () => stepDrafts(admin, userId, { auto: true }),
    images: () => stepImages(admin, admin, userId, { deadline }),
    engage: () => stepEngage(admin, userId),
    dms: () => stepDms(admin, userId),
    ...impl,
  };
  for (const s of DAILY_STEPS) {
    const st = steps[s] ?? {};
    if (st.done || (st.tries ?? 0) >= 2) continue;
    if (Date.now() > deadline - 100_000) break; // 1工程に最大100秒ほど見ておく
    try {
      const note = await run[s]();
      steps[s] = { done: true, at: new Date().toISOString(), note };
    } catch (e) {
      steps[s] = { done: false, at: new Date().toISOString(), error: (e instanceof Error ? e.message : String(e)).slice(0, 300), tries: (st.tries ?? 0) + 1 };
    }
    await save();
  }
  return steps;
}
