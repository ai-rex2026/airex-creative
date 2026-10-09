"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { GuardHit, Industry } from "@/lib/types";
import { buildStoreSnapshot, hasPlacesKey, searchStoreCandidates } from "@/lib/meo-ops/places";
import { writeDaily } from "@/lib/meo-ops/daily";
import { createCheck, defaultQuery, quota, runCheck } from "@/lib/meo-ops/ai-search";
import { draftDescription, draftPost, draftReply, suggestSearchTerm } from "@/lib/meo-ops/writer";
import { MEO_STORE_COLUMNS, rowToReview, type MeoStoreRow } from "@/lib/meo-ops/workspace";
import { buildAiSearchPrompt, DEFAULT_AI_REPLY_SETTINGS } from "@/lib/meo-ops/logic";
import { deleteGbpConnection, gbpAccessToken, gbpConnectionEmail } from "@/lib/gbp/oauth";
import { fetchMetrics, getLocation, getProfile, listAllLocations, listReviews, patchLocation, putReply, deleteReply, type GbpLocation, type GbpMetrics } from "@/lib/gbp/api";
import { checkGuard } from "@/lib/guardrail";
import { planChanges, PROFILE_KEYS, PROFILE_LABEL, snapshotOf, type GbpProfile, type ProfileChange, type ProfileInput, type ProfileKey } from "@/lib/gbp/profile";
import { saveReviews } from "@/lib/gbp/sync";
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
  const { data } = await sb.from("stores").select(MEO_STORE_COLUMNS).eq("id", id).eq("owner_id", user.id).maybeSingle();
  if (!data) throw new Error("この店舗を操作する権限がありません");
  const row = data as unknown as MeoStoreRow;
  const industry: Industry = row.industry ?? "general";
  return { sb, user, row, industry };
}

function refresh(id: string) {
  revalidatePath(`/stores/${id}`, "layout");
  revalidatePath("/stores");
}

// ── 店舗の新規登録 ────────────────────────────────────────
const INDUSTRIES: Industry[] = ["beauty", "medical", "supplement", "finance", "general"];

/** 店舗を新しく登録するときの検索（まだ店舗IDが無い）。ログイン済みの本人だけが使える */
export async function searchStoresForNewAction(query: string): Promise<StoreCandidate[]> {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) throw new Error("ログインが必要です");
  const q = (query ?? "").trim().slice(0, 200);
  if (!q) throw new Error("検索する店舗名または住所を入力してください");
  if (!hasPlacesKey()) throw new Error("店舗検索を利用できません。設定を確認してください");
  return searchStoreCandidates(q, 10);
}

/** 店舗を登録する。Places の実測（自店＋近隣競合）を取り、今日の記録を1件書く。レポートとは独立した実体になる */
export async function createStoreAction(placeId: string, industry: Industry): Promise<string> {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) throw new Error("ログインが必要です");
  if (!placeId || placeId.length > 500) throw new Error("店舗の指定が不正です");
  if (!INDUSTRIES.includes(industry)) throw new Error("業種の指定が不正です");
  const snapshot = await buildStoreSnapshot(placeId);
  if (!snapshot) throw new Error("店舗の情報を取得できませんでした。時間をおいて再度お試しください");

  // 同じ店舗を二重に登録しない（既にあればそちらを開く）
  const { data: dup } = await sb.from("stores").select("id").eq("owner_id", user.id).eq("meo_place_id", placeId).maybeSingle();
  if (dup) return (dup as { id: string }).id;

  const { data, error } = await sb
    .from("stores")
    .insert({ owner_id: user.id, name: snapshot.name, industry, meo_place_id: placeId, meo_place_source: "manual", meo_store: snapshot })
    .select("id")
    .single();
  if (error || !data) throw new Error("店舗の登録に失敗しました");
  const id = (data as { id: string }).id;
  await writeDaily(createAdminClient(), id, snapshot).catch(() => undefined);
  revalidatePath("/stores");
  return id;
}

// ── 店舗の検索・確定 ──────────────────────────────
/** 店舗の候補を検索する。query を省略すると登録済みの店舗名と住所から組み立てる */
export async function searchStoreCandidatesAction(id: string, query?: string): Promise<StoreCandidate[]> {
  const { row } = await owned(id);
  let q = (query ?? "").trim().slice(0, 200);
  if (!q) {
    q = `${row.name ?? ""} ${row.meo_store?.address ?? ""}`.trim();
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
    .from("stores")
    .update({ meo_place_id: placeId, meo_place_source: "manual", meo_store: snapshot, name: snapshot.name })
    .eq("id", id);
  if (error) throw new Error("店舗の保存に失敗しました");

  const admin = createAdminClient();
  // 別の店舗に切り替えたら、前の店舗の推移は混ぜない（別商圏の数字が1本の線に繋がってしまう）
  if (changed && row.meo_place_id) await admin.from("meo_daily").delete().eq("store_id", id);
  await writeDaily(admin, id, snapshot).catch(() => undefined);
  refresh(id);
}

// ── 設定・下書き ────────────────────────────────
export async function saveMeoConfigAction(id: string, ai: MeoAiReplySettings, n: MeoNotificationSettings) {
  const { sb } = await owned(id);
  const clip = (a: string[]) => a.map((s) => s.slice(0, 100)).slice(0, 50);
  const { error } = await sb.from("meo_settings").upsert({
    store_id: id,
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
    store_id: id,
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
  input: { storeName: string; paymentMethods: string[]; attributes: string[]; notes?: string }
): Promise<{ description: string; hits: GuardHit[]; warning: string | null }> {
  const { row, industry } = await owned(id);
  const r = await draftDescription(
    row.meo_store,
    { storeName: input.storeName, paymentMethods: input.paymentMethods, attributes: input.attributes, notes: (input.notes ?? "").slice(0, 600) },
    industry
  );
  // 分析レポートの対象サイトの説明は材料に使わない（店舗と別の会社・製品の内容が混ざるため）
  return {
    description: r.description,
    hits: r.guard.hits,
    warning: r.nameMissing ? "説明文に店舗名が入っていません。別の会社の内容になっていないか確認してください。" : null,
  };
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
    store_id: id,
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
 * 返信をGoogleに公開する。人が画面で「公開する」を押したときだけ呼ばれる（自動送信はしない）。
 * 公開前にサーバー側で法令チェックを通し、赤（違反の可能性が高い）は送らない。
 * 成功したときだけ replied にする。失敗したときは文面を残したまま failed にして、理由を画面に出す。
 */
export async function replyToReviewAction(id: string, reviewId: string, reply: string) {
  const { sb, user, row, industry } = await owned(id);
  if (!row.meo_gbp_location) throw new Error("Googleビジネスプロフィールの店舗が未連携のため送信できません。「設定」タブで連携してください");
  const text = reply.trim().slice(0, 4000);
  if (!text) throw new Error("返信文を入力してください");
  const { data: rev } = await sb.from("meo_reviews").select("id, gbp_name").eq("store_id", id).eq("id", reviewId).maybeSingle();
  const reviewName = (rev?.gbp_name as string | null) ?? null;
  if (!rev || !reviewName) throw new Error("このクチコミはGoogleから取り込まれたものではないため、返信を送れません");

  const verdict = await checkGuard([text], industry);
  if (verdict.level === "red") throw new Error("法令上問題のある表現が含まれる可能性が高いため、送信できません。指摘に沿って直してください");

  const token = await gbpToken(user.id);
  const now = new Date().toISOString();
  try {
    await putReply(token, reviewName, text);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Googleへの送信に失敗しました";
    await sb.from("meo_reviews").update({ reply: text, reply_status: "failed", error_message: message, updated_at: now }).eq("store_id", id).eq("id", reviewId);
    refresh(id);
    throw new Error(message);
  }
  await sb.from("meo_reviews").update({ reply: text, reply_status: "replied", replied_at: now, error_message: null, updated_at: now }).eq("store_id", id).eq("id", reviewId);
  refresh(id);
}

/** 公開済みの返信をGoogleから削除する（取り消し）。人が「取り消す」を押したときだけ呼ばれる */
export async function deleteReplyAction(id: string, reviewId: string) {
  const { sb, user, row } = await owned(id);
  if (!row.meo_gbp_location) throw new Error("Googleビジネスプロフィールの店舗が未連携のため操作できません");
  const { data: rev } = await sb.from("meo_reviews").select("id, gbp_name").eq("store_id", id).eq("id", reviewId).maybeSingle();
  const reviewName = (rev?.gbp_name as string | null) ?? null;
  if (!rev || !reviewName) throw new Error("このクチコミはGoogleから取り込まれたものではありません");
  await deleteReply(await gbpToken(user.id), reviewName);
  await sb
    .from("meo_reviews")
    .update({ reply: null, reply_status: "unreplied", replied_at: null, error_message: null, updated_at: new Date().toISOString() })
    .eq("store_id", id)
    .eq("id", reviewId);
  refresh(id);
}

export async function draftReplyAction(id: string, reviewId: string) {
  const { sb } = await owned(id);
  const { data: review } = await sb.from("meo_reviews").select("*").eq("store_id", id).eq("id", reviewId).maybeSingle();
  if (!review) throw new Error("クチコミが見つかりません");
  const { data: settings } = await sb.from("meo_settings").select("ai_reply").eq("store_id", id).maybeSingle();
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
/** 事業内容（サービス内容の説明・Webサイト）から、AIに聞く「業種」を考える。実行はしない（候補を返すだけ） */
export async function suggestAiSearchTermAction(id: string, notes: string) {
  const { row } = await owned(id);
  try {
    return await suggestSearchTerm(row.meo_store, (notes ?? "").slice(0, 600));
  } catch (e) {
    // 本番では throw すると原因が隠れるため、画面に出せる形で返す（候補は付けず、手で入力できる）
    console.error("[ai-search] suggest failed", e);
    return { term: "", reason: `自動で考えられませんでした（${e instanceof Error ? e.message.slice(0, 80) : "原因不明"}）。業種を直接入力してください` };
  }
}

export async function getAiSearchStatusAction(id: string) {
  const { sb, row } = await owned(id);
  const q = defaultQuery(row.meo_store, row.meo_store?.address ?? null);
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

  // ai_search_checks への書き込みはサーバー（service role）だけに許している（本人の権限には書き込みの方針が無い）。
  // 持ち主の確認は上の owned() で済んでいる
  const created = await createCheck(createAdminClient(), id, area, category);
  // 自店の名前だけで照合する。分析したサイトのタイトルは使わない（別の会社・製品が「自店が言及された」と数えられるため）
  const ownNames = [row.meo_store?.name ?? "", row.name ?? ""].filter((n) => n.trim());
  after(async () => {
    await runCheck(createAdminClient(), created.checkId, { store: row.meo_store, ownNames, industry }).catch(() => undefined);
  });
  refresh(id);
  return created;
}

/** 実行中のチェックの状態だけを読む（画面のポーリング用。全体を読み直すより軽い） */
export async function aiSearchCheckStatusAction(id: string, checkId: string) {
  const { sb } = await owned(id);
  const { data } = await sb.from("ai_search_checks").select("status").eq("store_id", id).eq("id", checkId).maybeSingle();
  return (data?.status as string | undefined) ?? null;
}

/** 店舗の実測（星・件数・写真・競合）を今すぐ取り直す */
export async function refreshStoreAction(id: string) {
  const { sb, row } = await owned(id);
  if (!row.meo_place_id) throw new Error("店舗が未選択です");
  const snapshot = await buildStoreSnapshot(row.meo_place_id);
  if (!snapshot) throw new Error("店舗の情報を取得できませんでした");
  await sb.from("stores").update({ meo_store: snapshot }).eq("id", id);
  refresh(id);
}

// ── Googleビジネスプロフィール（読み取り＋プロフィール更新・返信の公開/取り消し。書き込みは人の承認後のみ。投稿の公開は行わない）──
async function gbpLinked(sb: Awaited<ReturnType<typeof createClient>>, id: string) {
  const { data } = await sb.from("stores").select("meo_gbp_account, meo_gbp_location").eq("id", id).maybeSingle();
  return { account: (data?.meo_gbp_account as string | null) ?? null, location: (data?.meo_gbp_location as string | null) ?? null };
}

async function gbpToken(userId: string) {
  const t = await gbpAccessToken(userId);
  if (!t) throw new Error("Googleビジネスプロフィールが未連携です。「設定」タブで連携してください");
  return t;
}

export type GbpOverview = {
  connected: boolean;
  email: string | null;
  location: GbpLocation | null;
  reviewCount: number;
  /** 店舗情報を読めなかった理由（連携自体は有効なこともある） */
  error: string | null;
};

/** 連携の状態と、紐付け済み店舗の基本情報。API のエラーは画面に出せるよう、投げずに返す */
export async function gbpOverviewAction(id: string): Promise<GbpOverview> {
  const { sb, user } = await owned(id);
  const conn = await gbpConnectionEmail(user.id);
  if (!conn) return { connected: false, email: null, location: null, reviewCount: 0, error: null };
  const linked = await gbpLinked(sb, id);
  const { count } = await sb.from("meo_reviews").select("id", { count: "exact", head: true }).eq("store_id", id).not("gbp_name", "is", null);
  const base = { connected: true, email: conn.email, location: null, reviewCount: count ?? 0 };
  if (!linked.account || !linked.location) return { ...base, error: null };
  try {
    const token = await gbpToken(user.id);
    return { ...base, location: await getLocation(token, linked.account, linked.location), error: null };
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : "店舗情報を取得できませんでした" };
  }
}

/** 連携したアカウントが管理している店舗の一覧（紐付ける店舗を選ぶため） */
export async function gbpListLocationsAction(id: string): Promise<{ locations: GbpLocation[]; errors: string[] }> {
  const { user } = await owned(id);
  return listAllLocations(await gbpToken(user.id));
}

/** クチコミを Google から取り込む（読み取りのみ）。保存済みの返信下書き・送信待ちは消さない */
async function syncReviews(id: string, userId: string, account: string, location: string) {
  const token = await gbpToken(userId);
  const reviews = await listReviews(token, account, location);
  const r = await saveReviews(createAdminClient(), id, reviews);
  return { fetched: reviews.length, ...r };
}

/** この店舗として、Google 側の店舗を紐付ける。紐付けたあとクチコミを取り込む */
export async function gbpLinkLocationAction(id: string, account: string, location: string) {
  const { sb, user } = await owned(id);
  if (!/^accounts\/[0-9]+$/.test(account) || !/^locations\/[0-9]+$/.test(location)) throw new Error("店舗の指定が不正です");
  // 連携したアカウントが実際に管理している店舗だけ紐付けられる（手で書き換えた値は通さない）
  const { locations } = await listAllLocations(await gbpToken(user.id));
  if (!locations.some((l) => l.account === account && l.name === location)) throw new Error("このアカウントで管理している店舗に見つかりません");
  const { error } = await sb.from("stores").update({ meo_gbp_account: account, meo_gbp_location: location }).eq("id", id);
  if (error) throw new Error("店舗の紐付けに失敗しました");
  refresh(id);
  // 取り込みは紐付けの成否と切り離す（クチコミ API が未有効でも紐付け自体は残す）
  try {
    return { sync: await syncReviews(id, user.id, account, location), syncError: null as string | null };
  } catch (e) {
    return { sync: null, syncError: e instanceof Error ? e.message : "クチコミを取り込めませんでした" };
  }
}

export async function gbpSyncReviewsAction(id: string) {
  const { sb, user } = await owned(id);
  const linked = await gbpLinked(sb, id);
  if (!linked.account || !linked.location) throw new Error("店舗が紐付いていません");
  const r = await syncReviews(id, user.id, linked.account, linked.location);
  refresh(id);
  return r;
}

/** 直近28日の表示回数・通話・ウェブサイト・ルート検索（読み取りのみ） */
export async function gbpMetricsAction(id: string): Promise<GbpMetrics> {
  const { sb, user } = await owned(id);
  const linked = await gbpLinked(sb, id);
  if (!linked.location) throw new Error("店舗が紐付いていません");
  return fetchMetrics(await gbpToken(user.id), linked.location);
}

export async function gbpUnlinkLocationAction(id: string) {
  const { sb } = await owned(id);
  const { error } = await sb.from("stores").update({ meo_gbp_account: null, meo_gbp_location: null }).eq("id", id);
  if (error) throw new Error("紐付けを解除できませんでした");
  refresh(id);
}

/** Google との連携そのものを解除する（この人のすべての店舗で紐付けも外れる） */
export async function gbpDisconnectAction(id: string) {
  const { user } = await owned(id);
  await deleteGbpConnection(user.id);
  refresh(id);
}

// ── プロフィールの更新（人が内容を確認して承認したときだけ Google に書き込む）──────
async function gbpLinkedStore(id: string) {
  const { sb, user, industry } = await owned(id);
  const linked = await gbpLinked(sb, id);
  if (!linked.account || !linked.location) throw new Error("店舗が紐付いていません。「設定」タブで店舗を紐付けてください");
  return { user, industry, location: linked.location, token: await gbpToken(user.id) };
}

/** Google 上の現在の説明文・営業時間・Webサイト（読み取りのみ） */
export async function gbpProfileCurrentAction(id: string): Promise<GbpProfile> {
  const { token, location } = await gbpLinkedStore(id);
  return getProfile(token, location);
}

export type GbpProfilePreview = {
  changes: ProfileChange[];
  /** 承認の時点で Google にあった値。反映時に照合して、間に誰かが変えていたら止める */
  baseline: Partial<Record<ProfileKey, string>>;
  guardLevel: "red" | "yellow" | "green" | null;
  hits: GuardHit[];
  /** true のあいだは反映できない（法令チェックが赤） */
  blocked: boolean;
};

async function guardDescription(industry: Industry, changes: ProfileChange[]) {
  const d = changes.find((c) => c.key === "description" && c.changed);
  if (!d) return { level: null as GbpProfilePreview["guardLevel"], hits: [] as GuardHit[] };
  const v = await checkGuard([d.next], industry);
  return { level: v.level, hits: v.hits };
}

/** 反映する前の確認用。Google に書き込まない。現在値との差分と、説明文の法令チェックを返す */
export async function gbpProfilePreviewAction(id: string, input: ProfileInput): Promise<GbpProfilePreview> {
  const { token, location, industry } = await gbpLinkedStore(id);
  const current = await getProfile(token, location);
  const changes = planChanges(current, input);
  const g = await guardDescription(industry, changes);
  return {
    changes,
    baseline: Object.fromEntries(changes.map((c) => [c.key, snapshotOf(current, c.key)])),
    guardLevel: g.level,
    hits: g.hits,
    blocked: g.level === "red",
  };
}

export type GbpApplyResult = { key: ProfileKey; label: string; ok: boolean; error: string | null };

/**
 * 承認された項目だけを Google に書き込む。自動では呼ばれない（画面の承認ボタンからのみ）。
 * - 反映の直前に Google の現在値を取り直し、承認画面で見た値から変わっていたらその項目は反映しない
 * - 説明文の法令チェックをここでも通す（画面側の判定は信用しない）。赤なら反映しない
 * - 項目ごとに「検証 → 反映」を行い、1項目の失敗でほかの項目を止めない
 */
export async function gbpProfileApplyAction(
  id: string,
  input: ProfileInput,
  approved: { keys: ProfileKey[]; baseline: Partial<Record<ProfileKey, string>> }
): Promise<GbpApplyResult[]> {
  const keys = PROFILE_KEYS.filter((k) => approved.keys.includes(k));
  if (!keys.length) throw new Error("反映する項目が選ばれていません");
  const { token, location, industry } = await gbpLinkedStore(id);
  const current = await getProfile(token, location);
  const changes = planChanges(current, input);
  const g = await guardDescription(industry, changes);

  const results: GbpApplyResult[] = [];
  for (const key of keys) {
    const label = PROFILE_LABEL[key];
    const fail = (error: string) => results.push({ key, label, ok: false, error });
    const c = changes.find((x) => x.key === key);
    if (!c) {
      fail("この項目の内容が送られていません");
      continue;
    }
    if (!c.changed) {
      fail("Googleの現在の内容と同じなので、反映していません");
      continue;
    }
    if (approved.baseline[key] === undefined || approved.baseline[key] !== snapshotOf(current, key)) {
      fail("確認したあとにGoogle側の内容が変わっています。もう一度「反映内容を確認する」から進めてください");
      continue;
    }
    if (key === "description" && g.level === "red") {
      fail("法令チェックで修正が必要な表現があるため、反映していません");
      continue;
    }
    try {
      await patchLocation(token, location, key, input, true);
      await patchLocation(token, location, key, input, false);
      results.push({ key, label, ok: true, error: null });
    } catch (e) {
      fail(e instanceof Error ? e.message : "反映に失敗しました");
    }
  }
  refresh(id);
  return results;
}
