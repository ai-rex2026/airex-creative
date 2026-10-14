import type { SupabaseClient } from "@supabase/supabase-js";
import type { GuardHit, Industry } from "../../types";
import { jstDateKey } from "../daily";
import type { MeoStoreSnapshot } from "../types";
import { kindOf, writeReviewUrl } from "./text";
import { DEFAULT_AUTO, type AutoLogEntry, type AutoSettings, type KitData, type KitInput, type KitNumber, type KitResults, type KitStepId, type KitStepState, type PlanState } from "./types";

/**
 * キットの保存と読み込み。
 * - meo_kit … お店ごとに1行（入れてもらった URL・「やること」の状態・自動で回す設定）
 * - meo_kit_steps … 工程ごとに1行（結果。工程が終わった時点でその工程だけ保存する）
 * - meo_auto_log … 自動でやったこと／確認待ち
 */

export const EMPTY_INPUT: KitInput = { url: "", note: "", hpbUrl: "", shopEmail: "", staff: [] };

const str = (v: unknown) => (typeof v === "string" ? v : "");

export function toInput(v: unknown): KitInput {
  const o = (v ?? {}) as Record<string, unknown>;
  return {
    url: str(o.url).slice(0, 1000),
    note: str(o.note).slice(0, 2000),
    hpbUrl: str(o.hpbUrl).slice(0, 1000),
    shopEmail: str(o.shopEmail).slice(0, 200),
    staff: (Array.isArray(o.staff) ? o.staff : []).filter((x): x is string => typeof x === "string").slice(0, 5),
  };
}

export function toAuto(v: unknown): AutoSettings {
  const o = (v ?? {}) as Record<string, unknown>;
  const stars = Number(o.autoSendMinStars);
  const wd = Number(o.postWeekday);
  return {
    replies: o.replies === true,
    autoSendMinStars: stars === 4 || stars === 5 ? stars : 0,
    posts: o.posts === true,
    postWeekday: Number.isInteger(wd) && wd >= 0 && wd <= 6 ? wd : DEFAULT_AUTO.postWeekday,
    autoPublishPosts: o.autoPublishPosts === true,
  };
}

export function toPlan(v: unknown): PlanState {
  const o = (v ?? {}) as Record<string, unknown>;
  const out: PlanState = {};
  for (const [k, val] of Object.entries(o)) if (val === "todo" || val === "done" || val === "skip") out[k.slice(0, 40)] = val;
  return out;
}

export async function loadSteps(sb: SupabaseClient, storeId: string) {
  const { data } = await sb.from("meo_kit_steps").select("step, result, error_message, updated_at").eq("store_id", storeId);
  const results: KitResults = {};
  const steps: Partial<Record<KitStepId, KitStepState>> = {};
  for (const r of data ?? []) {
    const id = r.step as KitStepId;
    if (r.result != null) (results as Record<string, unknown>)[id] = r.result;
    steps[id] = { status: r.error_message ? "failed" : "done", updatedAt: String(r.updated_at), error: (r.error_message as string | null) ?? null };
  }
  return { results, steps };
}

/** 工程の結果だけを保存する（他の工程の行には触らない） */
export async function saveStep(sb: SupabaseClient, storeId: string, step: KitStepId, result: unknown) {
  const { error } = await sb.from("meo_kit_steps").upsert({ store_id: storeId, step, result, error_message: null, updated_at: new Date().toISOString() });
  if (error) throw new Error("結果の保存に失敗しました");
}

/** 失敗を記録する。前回の成功結果（result）は消さない */
export async function saveStepError(sb: SupabaseClient, storeId: string, step: KitStepId, message: string) {
  const { data } = await sb.from("meo_kit_steps").select("step").eq("store_id", storeId).eq("step", step).maybeSingle();
  const row = { error_message: message.slice(0, 1000), updated_at: new Date().toISOString() };
  if (data) await sb.from("meo_kit_steps").update(row).eq("store_id", storeId).eq("step", step);
  else await sb.from("meo_kit_steps").insert({ store_id: storeId, step, result: null, ...row });
}

export function rowToLog(r: Record<string, unknown>): AutoLogEntry {
  return {
    id: String(r.id),
    kind: (r.kind === "post" || r.kind === "measure" ? r.kind : "reply") as AutoLogEntry["kind"],
    status: (["sent", "pending", "dismissed", "failed", "info"].includes(String(r.status)) ? r.status : "info") as AutoLogEntry["status"],
    refId: (r.ref_id as string | null) ?? null,
    title: str(r.title),
    text: str(r.text),
    rating: typeof r.rating === "number" ? r.rating : null,
    reason: str(r.reason),
    hits: Array.isArray(r.hits) ? (r.hits as GuardHit[]) : [],
    createdAt: String(r.created_at),
    decidedAt: (r.decided_at as string | null) ?? null,
  };
}

function cmp(now: number | null, prev: number | null, higherIsBetter = true): KitNumber["delta"] {
  if (now == null || prev == null) return null;
  if (now === prev) return "same";
  return now > prev === higherIsBetter ? "up" : "down";
}

/**
 * 画面の一番上の「今の数字」と前回比。
 * AI検索で挙がったか（最新と1つ前の実測）・マップ順位（上位3位に入る語の数。今月と前回の計測）・口コミ数と平均評価（今と約4週前）。
 */
export async function buildNumbers(sb: SupabaseClient, storeId: string, store: MeoStoreSnapshot | null, score: { total: number; rank: string } | null): Promise<KitNumber[]> {
  const ago = new Date(Date.now() - 28 * 86400_000);
  const [checks, kw, ranks, daily] = await Promise.all([
    sb.from("ai_search_checks").select("mentioned, rank, created_at").eq("store_id", storeId).eq("status", "completed").order("created_at", { ascending: false }).limit(2),
    sb.from("meo_keywords").select("id").eq("store_id", storeId),
    sb.from("meo_keyword_ranks").select("keyword_id, rank, measured_on").eq("store_id", storeId).order("measured_on", { ascending: false }).limit(400),
    sb.from("meo_daily").select("date, review_count, average_rating").eq("store_id", storeId).lte("date", jstDateKey(ago)).order("date", { ascending: false }).limit(1),
  ]);
  const out: KitNumber[] = [];

  const c = checks.data ?? [];
  const label = (x: { mentioned: boolean; rank: number | null } | undefined) => (!x ? null : x.mentioned ? (x.rank ? `${x.rank}番目に挙がる` : "挙がる") : "挙がらない");
  const now0 = c[0] as { mentioned: boolean; rank: number | null } | undefined;
  const prev0 = c[1] as { mentioned: boolean; rank: number | null } | undefined;
  out.push({
    key: "ai",
    label: "AI検索で",
    value: label(now0) ?? "未計測",
    prev: label(prev0),
    delta: now0 && prev0 ? cmp(now0.mentioned ? 100 - (now0.rank ?? 50) : 0, prev0.mentioned ? 100 - (prev0.rank ?? 50) : 0) : null,
    note: "店名を含まない質問で、web 検索つきの AI に聞いた結果（「AI検索」タブ）",
  });

  const ids = new Set((kw.data ?? []).map((r) => String(r.id)));
  const rows = (ranks.data ?? []).filter((r) => ids.has(String(r.keyword_id))) as { keyword_id: string; rank: number | null; measured_on: string }[];
  const days = [...new Set(rows.map((r) => r.measured_on))];
  const top3 = (day?: string) => {
    if (!day) return null;
    const latest = new Map<string, number | null>();
    for (const r of rows) if (r.measured_on <= day && !latest.has(r.keyword_id)) latest.set(r.keyword_id, r.rank);
    return [...latest.values()].filter((v) => v != null && v <= 3).length;
  };
  const nowTop = top3(days[0]);
  const prevTop = top3(days.find((d) => d < (days[0] ?? "") && d.slice(0, 7) !== (days[0] ?? "").slice(0, 7)) ?? days[1]);
  out.push({
    key: "map",
    label: "マップで3位以内",
    value: ids.size ? (nowTop == null ? "未計測" : `${nowTop} / ${ids.size}語`) : "語が未登録",
    prev: prevTop == null ? null : `${prevTop}語`,
    delta: cmp(nowTop, prevTop),
    note: "「キーワード順位」に登録した語で、Google の検索結果の何番目に出るか",
  });

  const d0 = (daily.data ?? [])[0] as { review_count: number | null; average_rating: number | null } | undefined;
  out.push({
    key: "reviews",
    label: "口コミ数",
    value: store?.reviewCount != null ? `${store.reviewCount}件` : "—",
    prev: d0?.review_count != null ? `${d0.review_count}件（4週前）` : null,
    delta: cmp(store?.reviewCount ?? null, d0?.review_count ?? null),
    note: "Google の登録情報から",
  });
  out.push({
    key: "rating",
    label: "平均評価",
    value: store?.rating != null ? `★${store.rating.toFixed(1)}` : "—",
    prev: d0?.average_rating != null ? `★${Number(d0.average_rating).toFixed(1)}（4週前）` : null,
    delta: cmp(store?.rating ?? null, d0?.average_rating ?? null),
    note: "Google の登録情報から",
  });
  if (score) out.push({ key: "score", label: "集客スコア", value: `${score.total}点（${score.rank}）`, prev: null, delta: null, note: "今のページを、評価の基準ごとに採点した合計" });
  return out;
}

export type KitRow = { id: string; name: string | null; industry: Industry | null; meo_store: MeoStoreSnapshot | null; meo_place_id: string | null; meo_gbp_location: string | null };

export async function loadKitData(sb: SupabaseClient, row: KitRow): Promise<KitData> {
  const industry: Industry = row.industry ?? "general";
  const store = row.meo_store;
  const kind = kindOf(industry, store);
  const [kit, stepsRes, pending, checks, unreplied] = await Promise.all([
    sb.from("meo_kit").select("input, plan, auto").eq("store_id", row.id).maybeSingle(),
    loadSteps(sb, row.id),
    sb.from("meo_auto_log").select("id", { count: "exact", head: true }).eq("store_id", row.id).eq("status", "pending"),
    sb.from("ai_search_checks").select("listed_stores, mentioned").eq("store_id", row.id).eq("status", "completed").order("created_at", { ascending: false }).limit(3),
    sb.from("meo_reviews").select("id", { count: "exact", head: true }).eq("store_id", row.id).eq("reply_status", "unreplied"),
  ]);
  const input = toInput(kit.data?.input);
  const { results, steps } = stepsRes;
  const ownName = (store?.name || row.name || "").replace(/\s+/g, "");
  const listed: string[] = [];
  for (const c of checks.data ?? []) {
    for (const n of Array.isArray(c.listed_stores) ? (c.listed_stores as string[]) : []) {
      const k = String(n).replace(/\s+/g, "");
      if (!k || (ownName && (k.includes(ownName) || ownName.includes(k)))) continue;
      if (!listed.includes(n)) listed.push(n);
    }
  }
  const reviewUrl = writeReviewUrl(store?.placeId ?? row.meo_place_id);
  const storeName = row.name || store?.name || "";
  const qs = new URLSearchParams({ n: storeName });
  if (reviewUrl) qs.set("g", reviewUrl);
  if (input.shopEmail) qs.set("e", input.shopEmail);
  if (input.staff[0]) qs.set("s", input.staff[0]);
  return {
    kind,
    input: { ...input, url: input.url || store?.websiteUrl || "" },
    results,
    steps,
    plan: toPlan(kit.data?.plan),
    auto: toAuto(kit.data?.auto),
    numbers: await buildNumbers(sb, row.id, store, results.score ? { total: results.score.total, rank: results.score.rank } : null),
    pendingCount: pending.count ?? 0,
    reviewUrl,
    reviewPagePath: `/review?${qs.toString()}`,
    storeName,
    websiteUrl: store?.websiteUrl ?? null,
    aiListed: listed.slice(0, 5),
    placeCompetitors: (store?.competitors ?? []).map((c) => c.name).filter(Boolean).slice(0, 5),
    unrepliedReviews: unreplied.count ?? 0,
    gbpLinked: !!row.meo_gbp_location,
  };
}
