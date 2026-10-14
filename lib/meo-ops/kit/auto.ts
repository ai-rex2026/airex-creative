import type { SupabaseClient } from "@supabase/supabase-js";
import { checkGuard } from "../../guardrail";
import { gbpAccessToken } from "../../gbp/oauth";
import { buildPostSummary, createLocalPost, putReply } from "../../gbp/api";
import type { Industry } from "../../types";
import { DEFAULT_AI_REPLY_SETTINGS } from "../logic";
import type { MeoAiReplySettings, MeoStoreSnapshot } from "../types";
import { draftReply } from "../writer";
import { loadSteps, saveStep, toAuto, toInput } from "./store";
import { nextSeriesPost, type KitCtx } from "./steps";
import { kindOf } from "./text";

/**
 * 自動で回す（オルコネレックス v1 の「自動運用」）。Vercel Cron から毎日 10:00 JST に呼ばれる。
 * お店ごとにオン・オフ（既定はすべてオフ）。
 * - 口コミの返信：未返信の口コミに返信文を作る。星が基準以上（お店が決めた4か5）で言葉のチェックが緑のものだけ
 *   そのまま Google に送り、それ以外はすべて「確認待ち」に入れる（不満への返信を人が見ずに出さない）
 * - 投稿：決めた曜日に「続けて出すもの」の次の1本を作る。公開をオンにしていて言葉のチェックが緑なら公開、そうでなければ確認待ち
 * 1件ずつ処理して1件ずつ記録する（途中で落ちても、済んだ分は残る）。
 */

const REPLIES_PER_STORE = 10;
const WEEKDAY_JST = () => new Date(Date.now() + 9 * 3600_000).getUTCDay();
const TODAY_JST = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

type StoreRow = {
  id: string;
  owner_id: string;
  name: string | null;
  industry: Industry | null;
  meo_store: MeoStoreSnapshot | null;
  meo_gbp_account: string | null;
  meo_gbp_location: string | null;
};

function toReplySettings(v: unknown): MeoAiReplySettings {
  const raw = (v ?? {}) as Record<string, unknown>;
  return {
    keywords: Array.isArray(raw.keywords) ? (raw.keywords as string[]) : [],
    tone: (raw.tone === "friendly" || raw.tone === "formal" ? raw.tone : DEFAULT_AI_REPLY_SETTINGS.tone) as MeoAiReplySettings["tone"],
    styleInstruction: typeof raw.style_instruction === "string" ? raw.style_instruction : "",
    ngWords: Array.isArray(raw.ng_words) ? (raw.ng_words as string[]) : [],
    signature: typeof raw.signature === "string" ? raw.signature : "",
  };
}

/** 外部に出る処理（AI・Google）。検証では差し替えて、実際の API を呼ばずに分岐を確かめる */
export type AutoDeps = {
  token: typeof gbpAccessToken;
  draftReply: typeof draftReply;
  checkGuard: typeof checkGuard;
  putReply: typeof putReply;
  createLocalPost: typeof createLocalPost;
  nextSeriesPost: typeof nextSeriesPost;
  weekday: () => number;
  today: () => string;
};
const DEPS: AutoDeps = { token: gbpAccessToken, draftReply, checkGuard, putReply, createLocalPost, nextSeriesPost, weekday: WEEKDAY_JST, today: TODAY_JST };

export type AutoResult = { store: string; replies: { sent: number; pending: number; failed: number }; post: "sent" | "pending" | "skipped" | "failed" | null; error?: string };

export async function runAutoForAll(admin: SupabaseClient, deadlineMs: number, deps: AutoDeps = DEPS): Promise<AutoResult[]> {
  const { data: kits } = await admin.from("meo_kit").select("store_id, auto, input, auto_last_post_on").limit(500);
  const out: AutoResult[] = [];
  for (const k of kits ?? []) {
    if (Date.now() > deadlineMs) break; // 時間切れの分は翌日
    const auto = toAuto(k.auto);
    if (!auto.replies && !auto.posts) continue;
    const { data } = await admin.from("stores").select("id, owner_id, name, industry, meo_store, meo_gbp_account, meo_gbp_location").eq("id", k.store_id).maybeSingle();
    if (!data) continue;
    const row = data as unknown as StoreRow;
    const res: AutoResult = { store: row.id, replies: { sent: 0, pending: 0, failed: 0 }, post: null };
    try {
      if (!row.meo_gbp_location) throw new Error("Googleビジネスプロフィールが未連携");
      const token = await deps.token(row.owner_id);
      if (!token) throw new Error("Googleの連携が切れています");
      const industry: Industry = row.industry ?? "general";
      if (auto.replies) res.replies = await autoReplies(admin, row, industry, token, auto.autoSendMinStars, deps);
      if (auto.posts && deps.weekday() === auto.postWeekday && k.auto_last_post_on !== deps.today()) {
        res.post = await autoPost(admin, row, industry, token, auto.autoPublishPosts, toInput(k.input), deps);
        await admin.from("meo_kit").update({ auto_last_post_on: deps.today() }).eq("store_id", row.id);
      }
    } catch (e) {
      res.error = e instanceof Error ? e.message : String(e);
      console.error("[meo-auto]", row.id, res.error);
    }
    out.push(res);
  }
  return out;
}

async function autoReplies(admin: SupabaseClient, row: StoreRow, industry: Industry, token: string, minStars: number, deps: AutoDeps) {
  const r = { sent: 0, pending: 0, failed: 0 };
  const [{ data: reviews }, { data: settings }, { data: logged }] = await Promise.all([
    admin.from("meo_reviews").select("*").eq("store_id", row.id).eq("reply_status", "unreplied").not("gbp_name", "is", null).order("reviewed_at", { ascending: false }).limit(30),
    admin.from("meo_settings").select("ai_reply").eq("store_id", row.id).maybeSingle(),
    admin.from("meo_auto_log").select("ref_id").eq("store_id", row.id).eq("kind", "reply").in("status", ["pending", "sent", "dismissed"]),
  ]);
  const done = new Set((logged ?? []).map((x) => String(x.ref_id)));
  const s = toReplySettings(settings?.ai_reply);
  let n = 0;
  for (const rv of reviews ?? []) {
    if (n >= REPLIES_PER_STORE) break;
    const id = String(rv.id);
    if (done.has(id)) continue;
    n++;
    const rating = Number(rv.rating) || 0;
    try {
      const d = await deps.draftReply({ rating, authorName: String(rv.author_name ?? ""), text: String(rv.text ?? "") }, s);
      const verdict = await deps.checkGuard([d.reply], industry);
      const hits = [...d.guardHits, ...verdict.hits];
      const ok = minStars > 0 && rating >= minStars && verdict.level === "green" && d.guardHits.length === 0;
      if (!ok) {
        const reason = minStars === 0 ? "自動送信はオフ（確認してから送る設定）" : rating < minStars ? `星${rating}（${minStars}未満は人が確認）` : "言葉のチェックで注意が出た";
        await admin.from("meo_auto_log").insert({ store_id: row.id, kind: "reply", status: "pending", ref_id: id, title: `星${rating}の口コミへの返信`, text: d.reply, rating, reason, hits });
        r.pending++;
        continue;
      }
      const now = new Date().toISOString();
      try {
        await deps.putReply(token, String(rv.gbp_name), d.reply);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Googleへの送信に失敗しました";
        await admin.from("meo_auto_log").insert({ store_id: row.id, kind: "reply", status: "pending", ref_id: id, title: `星${rating}の口コミへの返信`, text: d.reply, rating, reason: `送信に失敗したので確認待ちにしました（${message}）`, hits });
        r.failed++;
        continue;
      }
      await admin.from("meo_reviews").update({ reply: d.reply, reply_status: "replied", replied_at: now, error_message: null, updated_at: now }).eq("store_id", row.id).eq("id", id);
      await admin.from("meo_auto_log").insert({ store_id: row.id, kind: "reply", status: "sent", ref_id: id, title: `星${rating}の口コミへの返信`, text: d.reply, rating, reason: `星${minStars}以上・言葉のチェック通過`, hits, decided_at: now });
      r.sent++;
    } catch (e) {
      console.error("[meo-auto] reply", row.id, id, e instanceof Error ? e.message : e);
      r.failed++;
    }
  }
  return r;
}

async function autoPost(admin: SupabaseClient, row: StoreRow, industry: Industry, token: string, publish: boolean, input: ReturnType<typeof toInput>, deps: AutoDeps): Promise<AutoResult["post"]> {
  const steps = await loadSteps(admin, row.id);
  if (!steps.results.diagnose) {
    await admin.from("meo_auto_log").insert({ store_id: row.id, kind: "post", status: "info", title: "投稿を作れませんでした", reason: "先にホームの「やることを出す」を実行してください" });
    return "skipped";
  }
  const [{ data: kws }, { data: settings }] = await Promise.all([
    admin.from("meo_keywords").select("keyword").eq("store_id", row.id).limit(10),
    admin.from("meo_settings").select("profile").eq("store_id", row.id).maybeSingle(),
  ]);
  const profile = (settings?.profile ?? {}) as Record<string, unknown>;
  const ctx: KitCtx = {
    kind: kindOf(industry, row.meo_store),
    industry,
    input: { ...input, url: input.url || row.meo_store?.websiteUrl || "" },
    results: steps.results,
    store: row.meo_store,
    storeName: row.name || row.meo_store?.name || "",
    keywords: (kws ?? []).map((k) => String(k.keyword)),
    currentDescription: typeof profile.description === "string" ? profile.description : "",
  };
  // 理美容の「続けて出すもの」は HPB ブログ（長文）なので、Google の投稿にはそのまま使わず 1500 字に収める
  const { series, post } = await deps.nextSeriesPost(ctx);
  await saveStep(admin, row.id, "series", series);
  const body = post.body.slice(0, 1400);
  const verdict = await deps.checkGuard([buildPostSummary(post.title, body)], industry);
  const hits = [...post.hits, ...verdict.hits];
  if (!publish || verdict.level !== "green" || !row.meo_gbp_account || !row.meo_gbp_location) {
    await admin.from("meo_auto_log").insert({ store_id: row.id, kind: "post", status: "pending", title: post.title, text: body, reason: !publish ? "公開は確認してから（設定）" : "言葉のチェックで注意が出た", hits });
    return "pending";
  }
  const now = new Date().toISOString();
  const { data: created, error } = await admin.from("meo_posts").insert({ store_id: row.id, title: post.title, body, status: "draft", ai_generated: true }).select("id").single();
  if (error || !created) throw new Error("投稿の保存に失敗しました");
  try {
    const name = await deps.createLocalPost(token, row.meo_gbp_account, row.meo_gbp_location, { summary: buildPostSummary(post.title, body), action: null, imageUrl: null });
    await admin.from("meo_posts").update({ status: "published", published_at: now, gbp_name: name, error_message: null, updated_at: now }).eq("id", created.id);
    await admin.from("meo_auto_log").insert({ store_id: row.id, kind: "post", status: "sent", ref_id: String(created.id), title: post.title, text: body, reason: "言葉のチェック通過", hits, decided_at: now });
    return "sent";
  } catch (e) {
    const message = e instanceof Error ? e.message : "Googleへの公開に失敗しました";
    await admin.from("meo_posts").update({ error_message: message, updated_at: now }).eq("id", created.id);
    await admin.from("meo_auto_log").insert({ store_id: row.id, kind: "post", status: "failed", ref_id: String(created.id), title: post.title, text: body, reason: message, hits });
    return "failed";
  }
}
