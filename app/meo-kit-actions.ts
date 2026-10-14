"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { Industry } from "@/lib/types";
import { createPostAction, publishPostAction, replyToReviewAction } from "@/app/meo-actions";
import { kindOf } from "@/lib/meo-ops/kit/text";
import { autoSteps } from "@/lib/meo-ops/kit/plan";
import { loadKitData, loadSteps, rowToLog, saveStep, saveStepError, toAuto, toInput, toPlan, type KitRow } from "@/lib/meo-ops/kit/store";
import {
  nextSeriesPost,
  rewriteCopy,
  stepAio,
  stepCoupon,
  stepDiagnose,
  stepGuard,
  stepHpb,
  stepHpbPage,
  stepKit,
  stepMeo,
  stepScan,
  stepScore,
  stepWinners,
  type KitCtx,
} from "@/lib/meo-ops/kit/steps";
import type { AutoLogEntry, AutoSettings, KitData, KitInput, KitStepId, PlanState } from "@/lib/meo-ops/kit/types";

/**
 * MEO の「やること」キット（オルコネレックスの作り）の Server Action。
 * 1 工程 = 1 回の呼び出し。工程が終わった時点でその工程だけ保存する（失敗しても他の工程の結果は残る）。
 * 書き込みは本人のセッション（RLS）で行う。
 */

const KIT_COLUMNS = "id, name, industry, meo_store, meo_place_id, meo_gbp_location";

async function owned(id: string) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) throw new Error("ログインが必要です");
  const { data } = await sb.from("stores").select(KIT_COLUMNS).eq("id", id).eq("owner_id", user.id).maybeSingle();
  if (!data) throw new Error("この店舗を操作する権限がありません");
  const row = data as unknown as KitRow;
  const industry: Industry = row.industry ?? "general";
  return { sb, user, row, industry };
}

async function ensureKitRow(sb: Awaited<ReturnType<typeof createClient>>, id: string) {
  const { data } = await sb.from("meo_kit").select("store_id").eq("store_id", id).maybeSingle();
  if (!data) await sb.from("meo_kit").insert({ store_id: id });
}

async function ctxOf(id: string): Promise<{ ctx: KitCtx; sb: Awaited<ReturnType<typeof createClient>> }> {
  const { sb, row, industry } = await owned(id);
  const [kit, steps, kws, settings] = await Promise.all([
    sb.from("meo_kit").select("input").eq("store_id", id).maybeSingle(),
    loadSteps(sb, id),
    sb.from("meo_keywords").select("keyword").eq("store_id", id).order("created_at", { ascending: true }).limit(10),
    sb.from("meo_settings").select("profile").eq("store_id", id).maybeSingle(),
  ]);
  const store = row.meo_store;
  const profile = (settings.data?.profile ?? {}) as Record<string, unknown>;
  const input = toInput(kit.data?.input);
  return {
    sb,
    ctx: {
      kind: kindOf(industry, store),
      industry,
      input: { ...input, url: input.url || store?.websiteUrl || "" },
      results: steps.results,
      store,
      storeName: row.name || store?.name || "",
      keywords: (kws.data ?? []).map((k) => String(k.keyword)).filter(Boolean),
      currentDescription: typeof profile.description === "string" ? profile.description : "",
    },
  };
}

function refresh(id: string) {
  revalidatePath(`/stores/${id}`, "layout");
}

export async function kitDataAction(id: string): Promise<KitData> {
  const { sb, row } = await owned(id);
  return loadKitData(sb, row);
}

export async function saveKitInputAction(id: string, input: KitInput) {
  const { sb } = await owned(id);
  await ensureKitRow(sb, id);
  const clean = toInput(input);
  if (clean.shopEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean.shopEmail)) throw new Error("お店のメールアドレスの形が正しくありません");
  const { error } = await sb.from("meo_kit").update({ input: clean, updated_at: new Date().toISOString() }).eq("store_id", id);
  if (error) throw new Error("保存に失敗しました");
}

/** 自動で順に回す工程の一覧（画面の進み具合に使う） */
export async function kitStepsAction(id: string) {
  const { row, industry } = await owned(id);
  return autoSteps(kindOf(industry, row.meo_store));
}

/**
 * 工程を1つ実行して保存する。失敗は例外にせず { ok:false } で返す（画面は次の工程に進める）。
 * 前の工程の結果が要る工程は、保存済みの結果を読み直して使う。
 */
export async function runKitStepAction(id: string, step: KitStepId): Promise<{ ok: boolean; error: string | null }> {
  const { ctx, sb } = await ctxOf(id);
  await ensureKitRow(sb, id);
  try {
    let result: unknown;
    switch (step) {
      case "scan":
        result = await stepScan(ctx);
        break;
      case "hpbpage":
        result = await stepHpbPage(ctx);
        break;
      case "diagnose":
        result = await stepDiagnose(ctx);
        break;
      case "score":
        result = await need(ctx, "diagnose", () => stepScore(ctx));
        break;
      case "hpb":
        result = await need(ctx, "diagnose", () => stepHpb(ctx));
        break;
      case "meo":
        result = await need(ctx, "diagnose", () => stepMeo(ctx));
        break;
      case "kit":
        result = await need(ctx, "diagnose", () => stepKit(ctx));
        break;
      case "coupon":
        result = await need(ctx, "diagnose", () => stepCoupon(ctx));
        break;
      case "aio":
        result = await need(ctx, "diagnose", () => stepAio(ctx));
        break;
      case "guard":
        result = await stepGuard(ctx);
        break;
      default:
        throw new Error("この工程はここからは実行できません");
    }
    await saveStep(sb, id, step, result);
    return { ok: true, error: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await saveStepError(sb, id, step, message);
    return { ok: false, error: message };
  }
}

async function need<T>(ctx: KitCtx, step: "diagnose", fn: () => Promise<T>): Promise<T> {
  if (!ctx.results[step]) throw new Error("先に「お店の特徴」の整理が要ります（上から作り直してください）");
  return fn();
}

/** AIが先に挙げる店（無ければ近くの同業）のページを読み、差と打ち手を出す */
export async function runWinnersAction(id: string): Promise<{ ok: boolean; error: string | null }> {
  const { ctx, sb } = await ctxOf(id);
  if (!ctx.results.diagnose) return { ok: false, error: "先に「やることを出す」を実行してください" };
  const { data: checks } = await sb.from("ai_search_checks").select("listed_stores").eq("store_id", id).eq("status", "completed").order("created_at", { ascending: false }).limit(3);
  const own = (ctx.store?.name || ctx.storeName).replace(/\s+/g, "");
  const listed: string[] = [];
  for (const c of checks ?? [])
    for (const n of Array.isArray(c.listed_stores) ? (c.listed_stores as string[]) : []) {
      const k = String(n).replace(/\s+/g, "");
      if (k && !(own && (k.includes(own) || own.includes(k))) && !listed.includes(n)) listed.push(n);
    }
  const from = listed.length ? "ai" : "places";
  const names = (listed.length ? listed : (ctx.store?.competitors ?? []).map((c) => c.name)).filter(Boolean).slice(0, 3);
  try {
    const result = await stepWinners(ctx, names, from);
    await saveStep(sb, id, "winners", result);
    return { ok: true, error: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await saveStepError(sb, id, "winners", message);
    return { ok: false, error: message };
  }
}

/** 続けて出すもの：次の1本を作る（初回は1年分のテーマも決める） */
export async function nextSeriesAction(id: string) {
  const { ctx, sb } = await ctxOf(id);
  const { series, post } = await nextSeriesPost(ctx);
  await saveStep(sb, id, "series", series);
  return post;
}

export async function rewriteKitCopyAction(id: string, text: string, mode: "短く" | "やわらかく" | "別案", limit?: number) {
  const { ctx } = await ctxOf(id);
  const t = text.trim().slice(0, 4000);
  if (!t) throw new Error("文章がありません");
  return rewriteCopy(ctx, t, mode, limit);
}

/** 画面で直した文章（作り直し・手直し）をその工程の結果に書き戻す。文章を作る工程だけ */
export async function patchStepAction(id: string, step: "hpb" | "meo" | "kit" | "coupon" | "aio" | "series", result: unknown) {
  const { sb } = await owned(id);
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("保存する内容が正しくありません");
  if (JSON.stringify(result).length > 200_000) throw new Error("文章が長すぎます");
  await saveStep(sb, id, step, result);
}

export async function savePlanStateAction(id: string, plan: PlanState) {
  const { sb } = await owned(id);
  await ensureKitRow(sb, id);
  const { error } = await sb.from("meo_kit").update({ plan: toPlan(plan), updated_at: new Date().toISOString() }).eq("store_id", id);
  if (error) throw new Error("保存に失敗しました");
}

/** 文章を「投稿」タブの下書きに入れる（公開は人が投稿タブで押す） */
export async function addPostDraftAction(id: string, title: string, body: string) {
  await createPostAction(id, { title: title.slice(0, 200) || "お知らせ", body, status: "draft", scheduledAt: null, imageUrl: null, actionButton: null, aiGenerated: true });
}

/** 説明文を「プロフィール」タブの下書きに入れる（Google への反映は人がプロフィールタブで押す） */
export async function applyDescriptionDraftAction(id: string, text: string) {
  const { sb } = await owned(id);
  const { data } = await sb.from("meo_settings").select("profile").eq("store_id", id).maybeSingle();
  const profile = { ...((data?.profile ?? {}) as Record<string, unknown>), description: text.trim().slice(0, 750) };
  const { error } = await sb.from("meo_settings").upsert({ store_id: id, profile, updated_at: new Date().toISOString() });
  if (error) throw new Error("下書きの保存に失敗しました");
  refresh(id);
}

// ── 自動で回す ─────────────────────────────────
export async function saveAutoAction(id: string, auto: AutoSettings) {
  const { sb, row } = await owned(id);
  const clean = toAuto(auto);
  if ((clean.replies || clean.posts) && !row.meo_gbp_location) throw new Error("先に「設定」タブで Googleビジネスプロフィールの店舗と連携してください");
  await ensureKitRow(sb, id);
  const { error } = await sb.from("meo_kit").update({ auto: clean, updated_at: new Date().toISOString() }).eq("store_id", id);
  if (error) throw new Error("保存に失敗しました");
  refresh(id);
}

export async function autoLogAction(id: string): Promise<AutoLogEntry[]> {
  const { sb } = await owned(id);
  const { data } = await sb.from("meo_auto_log").select("*").eq("store_id", id).order("created_at", { ascending: false }).limit(100);
  return (data ?? []).map((r) => rowToLog(r));
}

/**
 * 確認待ちを片付ける。send = 人が見て「このまま送る（直して送る）」、dismiss = 送らない。
 * 送るときは既存の返信・投稿の公開と同じ経路（法令チェック → Google）を通る。
 */
export async function decidePendingAction(id: string, logId: string, decision: "send" | "dismiss", text?: string) {
  const { sb } = await owned(id);
  const { data } = await sb.from("meo_auto_log").select("*").eq("store_id", id).eq("id", logId).maybeSingle();
  if (!data) throw new Error("見つかりません");
  const e = rowToLog(data);
  if (e.status !== "pending") throw new Error("すでに片付いています");
  const now = new Date().toISOString();
  if (decision === "dismiss") {
    await sb.from("meo_auto_log").update({ status: "dismissed", decided_at: now }).eq("id", logId);
    refresh(id);
    return;
  }
  const body = (text ?? e.text).trim();
  if (!body) throw new Error("文章が空です");
  if (e.kind === "reply") {
    if (!e.refId) throw new Error("返信先の口コミがありません");
    await replyToReviewAction(id, e.refId, body);
  } else if (e.kind === "post") {
    await createPostAction(id, { title: e.title || "お知らせ", body, status: "draft", scheduledAt: null, imageUrl: null, actionButton: null, aiGenerated: true });
    const { data: post } = await sb.from("meo_posts").select("id").eq("store_id", id).eq("status", "draft").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!post) throw new Error("投稿を作れませんでした");
    await publishPostAction(id, String(post.id));
  }
  await sb.from("meo_auto_log").update({ status: "sent", text: body, decided_at: now }).eq("id", logId);
  refresh(id);
}
