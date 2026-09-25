"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Diagnosis, GuardHit, Industry } from "@/lib/types";
import { buildStoreSnapshot, hasPlacesKey, searchStoreCandidates } from "@/lib/meo-ops/places";
import { writeDaily } from "@/lib/meo-ops/daily";
import { createCheck, defaultQuery, quota, runCheck } from "@/lib/meo-ops/ai-search";
import { draftDescription, draftPost, draftReply } from "@/lib/meo-ops/writer";
import { MEO_ANALYSIS_COLUMNS, rowToReview, type MeoAnalysisRow } from "@/lib/meo-ops/workspace";
import { buildAiSearchPrompt, DEFAULT_AI_REPLY_SETTINGS } from "@/lib/meo-ops/logic";
import type {
  MeoAiReplySettings,
  MeoNotificationSettings,
  MeoPostInput,
  MeoProfileDraft,
  StoreCandidate,
} from "@/lib/meo-ops/types";

/**
 * MEO運用ワークスペースの Server Action。
 * 本体ではバックエンド（Python /api/meo）が持っていた、ブラウザで実行できない処理
 * （Places・AI の呼び出し、月次上限の判定）をここに置く。書き込みは本人のセッション（RLS）で行い、
 * AI検索の結果や日次の実測のようにサーバーが書くものだけ service role を使う。
 */

async function owned(id: string) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) throw new Error("ログインが必要です");
  const { data } = await sb.from("analyses").select(`${MEO_ANALYSIS_COLUMNS}, diagnosis`).eq("id", id).eq("owner_id", user.id).maybeSingle();
  if (!data) throw new Error("この分析を操作する権限がありません");
  const row = data as unknown as MeoAnalysisRow & { diagnosis: Diagnosis | null };
  const industry: Industry = row.diagnosis?.industry ?? "general";
  return { sb, user, row, industry };
}

function refresh(id: string) {
  revalidatePath(`/analysis/${id}/meo`, "layout");
}

// ── 店舗の検索・確定 ──────────────────────────────
/** 店舗の候補を検索する。query を省略すると分析済みの店舗名と住所から組み立てる */
export async function searchStoreCandidatesAction(id: string, query?: string): Promise<StoreCandidate[]> {
  const { row } = await owned(id);
  let q = (query ?? "").trim().slice(0, 200);
  if (!q) {
    const name = row.meo?.self?.name || row.site?.bizName || row.site?.title || "";
    const addr = row.meo?.self?.address || row.site?.bizAddress || "";
    q = `${name} ${addr}`.trim();
  }
  if (!q) throw new Error("検索する店舗名または住所を入力してください");
  // 設定漏れは利用者の操作では直せないので、入力ミスと区別できる文言にする
  if (!hasPlacesKey()) throw new Error("店舗検索を利用できません。設定を確認してください");
  return searchStoreCandidates(q, 10);
}

/** 自社店舗を確定する。確定と同時に Places の実測（自店＋近隣競合）を取り、今日の記録を1件書く */
export async function selectStoreAction(id: string, placeId: string) {
  const { sb, row } = await owned(id);
  if (!placeId || placeId.length > 500) throw new Error("店舗の指定が不正です");
  const snapshot = await buildStoreSnapshot(placeId);
  if (!snapshot) throw new Error("店舗の情報を取得できませんでした。時間をおいて再度お試しください");

  const changed = row.meo_place_id !== placeId;
  const { error } = await sb
    .from("analyses")
    .update({ meo_place_id: placeId, meo_place_source: "manual", meo_store: snapshot })
    .eq("id", id);
  if (error) throw new Error("店舗の保存に失敗しました");

  const admin = createAdminClient();
  // 別の店舗に切り替えたら、前の店舗の推移は混ぜない（別商圏の数字が1本の線に繋がってしまう）
  if (changed && row.meo_place_id) await admin.from("meo_daily").delete().eq("analysis_id", id);
  await writeDaily(admin, id, snapshot).catch(() => undefined);
  refresh(id);
}

// ── 設定・下書き ────────────────────────────────
export async function saveMeoConfigAction(id: string, ai: MeoAiReplySettings, n: MeoNotificationSettings) {
  const { sb } = await owned(id);
  const clip = (a: string[]) => a.map((s) => s.slice(0, 100)).slice(0, 50);
  const { error } = await sb.from("meo_settings").upsert({
    analysis_id: id,
    ai_reply: {
      keywords: clip(ai.keywords),
      tone: ["polite", "friendly", "formal"].includes(ai.tone) ? ai.tone : "polite",
      style_instruction: ai.styleInstruction.slice(0, 1000),
      ng_words: clip(ai.ngWords),
      signature: ai.signature.slice(0, 300),
    },
    notifications: { new_review: !!n.newReview, edited_review: !!n.editedReview, monthly_report: !!n.monthlyReport },
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error("設定の保存に失敗しました");
  refresh(id);
}

export async function saveProfileDraftAction(id: string, d: MeoProfileDraft) {
  const { sb } = await owned(id);
  const { error } = await sb.from("meo_settings").upsert({
    analysis_id: id,
    profile: {
      description: d.description.slice(0, 750),
      payment_methods: d.paymentMethods.slice(0, 20),
      attributes: Object.fromEntries(Object.entries(d.attributes).slice(0, 30).map(([k, v]) => [k.slice(0, 40), v === true])),
      store_name: d.storeName.slice(0, 200),
      phone_number: d.phoneNumber.slice(0, 40),
      address: d.address.slice(0, 300),
      website_url: d.websiteUrl.slice(0, 500),
    },
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error("プロフィールの保存に失敗しました");
  refresh(id);
}

/** 「ビジネスの説明」をAIで下書きする（保存はしない。画面で直してから保存する） */
export async function draftDescriptionAction(
  id: string,
  input: { storeName: string; paymentMethods: string[]; attributes: string[] }
): Promise<{ description: string; hits: GuardHit[] }> {
  const { row, industry } = await owned(id);
  const r = await draftDescription(
    row.meo_store,
    { storeName: input.storeName, paymentMethods: input.paymentMethods, attributes: input.attributes, siteSummary: row.site?.description ?? null },
    industry
  );
  return { description: r.description, hits: r.guard.hits };
}

// ── 投稿 ─────────────────────────────────────
export async function createPostAction(id: string, p: MeoPostInput) {
  const { sb } = await owned(id);
  const title = p.title.trim().slice(0, 200);
  const body = p.body.trim().slice(0, 1500);
  if (!title || !body) throw new Error("タイトルと本文を入力してください");
  const status = p.status === "scheduled" ? "scheduled" : "draft";
  if (status === "scheduled" && !p.scheduledAt) throw new Error("配信日時を指定してください");
  const { error } = await sb.from("meo_posts").insert({
    analysis_id: id,
    title,
    body,
    status,
    scheduled_at: status === "scheduled" ? p.scheduledAt : null,
    image_url: p.imageUrl,
    action_button: p.actionButton,
    ai_generated: !!p.aiGenerated,
  });
  if (error) throw new Error("投稿の保存に失敗しました");
  refresh(id);
}

export async function draftPostAction(id: string, theme: string, storeName: string) {
  const { row, industry } = await owned(id);
  const r = await draftPost(row.meo_store, storeName, theme, industry);
  return { title: r.title, body: r.body, hits: r.guard.hits, level: r.guard.level };
}

// ── クチコミ ──────────────────────────────────
/**
 * 返信を送信待ちとして保存する。Google への送信はサーバー（cron）が行い、成功したときだけ replied になる。
 * GBP の店舗が紐付いていないと送れないので、その場合は保存せずに伝える。
 */
export async function replyToReviewAction(id: string, reviewId: string, reply: string) {
  const { sb, row } = await owned(id);
  if (!row.meo_gbp_location) throw new Error("Googleビジネスプロフィールの店舗が未連携のため送信できません。「設定」タブで連携してください");
  const text = reply.trim().slice(0, 4000);
  if (!text) throw new Error("返信文を入力してください");
  const { error } = await sb
    .from("meo_reviews")
    .update({ reply: text, reply_status: "pending", error_message: null, updated_at: new Date().toISOString() })
    .eq("analysis_id", id)
    .eq("id", reviewId);
  if (error) throw new Error("返信の送信に失敗しました");
  refresh(id);
}

export async function draftReplyAction(id: string, reviewId: string) {
  const { sb } = await owned(id);
  const { data: review } = await sb.from("meo_reviews").select("*").eq("analysis_id", id).eq("id", reviewId).maybeSingle();
  if (!review) throw new Error("クチコミが見つかりません");
  const { data: settings } = await sb.from("meo_settings").select("ai_reply").eq("analysis_id", id).maybeSingle();
  const raw = (settings?.ai_reply ?? {}) as Record<string, unknown>;
  const s: MeoAiReplySettings = {
    keywords: Array.isArray(raw.keywords) ? (raw.keywords as string[]) : [],
    tone: (raw.tone === "friendly" || raw.tone === "formal" ? raw.tone : DEFAULT_AI_REPLY_SETTINGS.tone) as MeoAiReplySettings["tone"],
    styleInstruction: typeof raw.style_instruction === "string" ? raw.style_instruction : "",
    ngWords: Array.isArray(raw.ng_words) ? (raw.ng_words as string[]) : [],
    signature: typeof raw.signature === "string" ? raw.signature : "",
  };
  return draftReply(rowToReview(review), s);
}

// ── AI検索 ───────────────────────────────────
export async function getAiSearchStatusAction(id: string) {
  const { sb, row } = await owned(id);
  const q = defaultQuery(row.meo_store, row.meo?.self?.address ?? row.site?.bizAddress ?? null);
  const quo = await quota(sb, id);
  return {
    area: q.area,
    category: q.category,
    prompt: q.area && q.category ? buildAiSearchPrompt(q.area, q.category) : "",
    ...quo,
  };
}

/**
 * AI への問い合わせを予約し、応答を返したあとに実行する（web 検索を挟むため1回30〜60秒かかる）。
 * 結果は画面が数秒おきに読み直して受け取る。
 */
export async function runAiSearchAction(id: string, input: { area: string; category: string }) {
  const { sb, row, industry } = await owned(id);
  const area = input.area.trim().slice(0, 100);
  const category = input.category.trim().slice(0, 100);
  if (!area || !category) throw new Error("エリアと業種を入力してください");

  const created = await createCheck(sb, id, area, category);
  const siteTitle = row.site?.title ?? "";
  const ownNames = [row.meo_store?.name ?? "", row.meo?.self?.name ?? "", siteTitle.split(/[|｜]/)[0] ?? ""].filter((n) => n.trim());
  after(async () => {
    await runCheck(createAdminClient(), created.checkId, { store: row.meo_store, ownNames, industry }).catch(() => undefined);
  });
  refresh(id);
  return created;
}

/** 実行中のチェックの状態だけを読む（画面のポーリング用。全体を読み直すより軽い） */
export async function aiSearchCheckStatusAction(id: string, checkId: string) {
  const { sb } = await owned(id);
  const { data } = await sb.from("ai_search_checks").select("status").eq("analysis_id", id).eq("id", checkId).maybeSingle();
  return (data?.status as string | undefined) ?? null;
}

/** 店舗の実測（星・件数・写真・競合）を今すぐ取り直す */
export async function refreshStoreAction(id: string) {
  const { sb, row } = await owned(id);
  if (!row.meo_place_id) throw new Error("店舗が未選択です");
  const snapshot = await buildStoreSnapshot(row.meo_place_id);
  if (!snapshot) throw new Error("店舗の情報を取得できませんでした");
  await sb.from("analyses").update({ meo_store: snapshot }).eq("id", id);
  refresh(id);
}
