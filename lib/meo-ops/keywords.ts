import type { SupabaseClient } from "@supabase/supabase-js";
import { askJson, MODEL_FAST } from "../anthropic";
import { jstDateKey, jstPeriodKey } from "./daily";
import { normalizeJapanese } from "./japanese";
import { guessAreaFromAddress } from "./logic";
import { hasPlacesKey, searchRankedPlaces, type RankedPlace } from "./places";
import type { MeoStoreSnapshot } from "./types";

/**
 * MEO のキーワード順位の定点観測（2026-10-13 のミーティング：「どのキーワードで今何位か」が無いのが MEO として弱い）。
 *
 * - 店舗ごとにキーワードを登録し、決めた起点（緯度経度＋半径）から Google の Places Text Search を投げて、
 *   自店舗が何番目に出るかを記録する（上位20件まで。入っていなければ「圏外」）
 * - 毎月1日に全キーワードを自動で測る（/api/cron/meo-keyword-monthly）。画面からは1日1回まで手動で測り直せる
 * - 地図アプリの並びと完全に同一ではないが、同じ起点・同じ条件で測るので推移は追える
 * - 一緒に上位の店の評価・クチコミ数・写真数も記録し、自店とのギャップを見せる（埋めるべき差）
 */

export type RankOrigin = { latitude: number; longitude: number; radiusMeters: number; label: string };

export const DEFAULT_RADIUS_M = 3000;
export const MAX_KEYWORDS = 20;
export const RANK_LIMIT = 20;

export type MeoKeyword = { id: string; keyword: string; createdAt: string };

export type MeoKeywordRank = {
  id: string;
  keywordId: string;
  measuredOn: string;
  period: string;
  /** 1始まり。上位 RANK_LIMIT 件に無ければ null（圏外） */
  rank: number | null;
  top: RankedPlace[];
  origin: RankOrigin | null;
  source: "monthly" | "manual";
};

export type MeoKeywordData = {
  keywords: MeoKeyword[];
  ranks: MeoKeywordRank[];
  origin: RankOrigin | null;
  /** 起点が未設定のときに使う、店舗の位置 */
  storeOrigin: RankOrigin | null;
  canMeasure: boolean;
  /** 今日すでに手動で測ったか（1日1回） */
  measuredToday: boolean;
};

export const KEYWORD_COLUMNS = "id, keyword, created_at";
export const RANK_COLUMNS = "id, keyword_id, measured_on, period, rank, top, origin, source";

export function rowToKeyword(r: Record<string, unknown>): MeoKeyword {
  return { id: String(r.id), keyword: String(r.keyword ?? ""), createdAt: String(r.created_at) };
}

export function rowToRank(r: Record<string, unknown>): MeoKeywordRank {
  return {
    id: String(r.id),
    keywordId: String(r.keyword_id),
    measuredOn: String(r.measured_on),
    period: String(r.period ?? ""),
    rank: typeof r.rank === "number" ? r.rank : null,
    top: Array.isArray(r.top) ? (r.top as RankedPlace[]) : [],
    origin: (r.origin as RankOrigin | null) ?? null,
    source: r.source === "manual" ? "manual" : "monthly",
  };
}

/** 店舗の Places 実測から既定の起点を作る */
export function originFromStore(store: MeoStoreSnapshot | null): RankOrigin | null {
  if (!store?.location) return null;
  return { latitude: store.location.latitude, longitude: store.location.longitude, radiusMeters: DEFAULT_RADIUS_M, label: "店舗の位置" };
}

export function normalizeOrigin(v: unknown): RankOrigin | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const lat = Number(o.latitude);
  const lng = Number(o.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const radius = Math.min(50_000, Math.max(500, Number(o.radiusMeters) || DEFAULT_RADIUS_M));
  return { latitude: lat, longitude: lng, radiusMeters: radius, label: String(o.label ?? "").slice(0, 80) };
}

export async function loadKeywordData(sb: SupabaseClient, storeId: string, store: MeoStoreSnapshot | null, originRaw: unknown): Promise<MeoKeywordData> {
  const [{ data: kws }, { data: ranks }] = await Promise.all([
    sb.from("meo_keywords").select(KEYWORD_COLUMNS).eq("store_id", storeId).order("created_at", { ascending: true }),
    sb.from("meo_keyword_ranks").select(RANK_COLUMNS).eq("store_id", storeId).order("measured_on", { ascending: false }).limit(600),
  ]);
  const rankList = ((ranks ?? []) as Record<string, unknown>[]).map(rowToRank);
  const today = jstDateKey();
  return {
    keywords: ((kws ?? []) as Record<string, unknown>[]).map(rowToKeyword),
    ranks: rankList,
    origin: normalizeOrigin(originRaw),
    storeOrigin: originFromStore(store),
    canMeasure: hasPlacesKey(),
    measuredToday: rankList.some((r) => r.source === "manual" && r.measuredOn === today),
  };
}

/**
 * 1店舗の全キーワードを測って保存する。同じ日に同じキーワードを2回保存しない（再実行しても壊れない）。
 * 1キーワード＝Text Search 1回（課金）。失敗したキーワードは飛ばして次へ（1本の失敗で全体を失わない）
 */
export async function measureStoreKeywords(
  sb: SupabaseClient,
  storeId: string,
  ownPlaceId: string,
  origin: RankOrigin,
  keywords: MeoKeyword[],
  source: "monthly" | "manual",
  day = jstDateKey()
): Promise<{ measured: number; skipped: number; failed: number }> {
  let measured = 0;
  let skipped = 0;
  let failed = 0;
  const period = jstPeriodKey(new Date(`${day}T12:00:00+09:00`));
  for (const kw of keywords) {
    const { data: exists } = await sb.from("meo_keyword_ranks").select("id").eq("keyword_id", kw.id).eq("measured_on", day).maybeSingle();
    if (exists) {
      skipped++;
      continue;
    }
    const top = await searchRankedPlaces(kw.keyword, origin, RANK_LIMIT);
    if (!top) {
      failed++;
      continue;
    }
    const idx = top.findIndex((p) => p.placeId === ownPlaceId);
    const { error } = await sb.from("meo_keyword_ranks").insert({
      store_id: storeId,
      keyword_id: kw.id,
      measured_on: day,
      period,
      rank: idx >= 0 ? idx + 1 : null,
      top,
      origin,
      source,
    });
    if (error) failed++;
    else measured++;
  }
  return { measured, skipped, failed };
}

const SUGGEST_SYSTEM = `あなたは日本の店舗の MEO（Googleマップ対策）担当者です。
お客さんが Googleマップで探すときに実際に入力する言葉を、店舗の情報から5つ考えます。

- 「エリア名＋業種」「エリア名＋サービス名」「駅名＋業種」のような、実際に検索される短い語にする
- 店名は入れない（店名での検索は測る意味が薄い）
- 5つは互いに違う切り口にする（業種の言い換え、主力メニュー、客層、駅名 など）
- 日本語の文章で通常使う漢字だけで書く

出力: {"keywords":["渋谷 美容室","渋谷駅 カラー","表参道 ヘアサロン","渋谷 縮毛矯正","渋谷 メンズカット"]}`;

/** キーワード候補を AI に考えさせる（登録はしない。人が選ぶ） */
export async function suggestKeywords(store: MeoStoreSnapshot | null, storeName: string, existing: string[]): Promise<string[]> {
  const lines = [
    `店舗名: ${storeName}`,
    store?.category ? `業種（Googleのカテゴリ）: ${store.category}` : "",
    store?.address ? `住所: ${store.address}（エリア: ${guessAreaFromAddress(store.address) || "不明"}）` : "",
    existing.length ? `登録済み（これ以外を出す）: ${existing.join(" / ")}` : "",
  ].filter(Boolean);
  const res = await askJson<{ keywords?: unknown }>(SUGGEST_SYSTEM, lines.join("\n"), { model: MODEL_FAST, maxTokens: 300, timeoutMs: 30_000 });
  const seen = new Set(existing.map((k) => k.replace(/\s+/g, "")));
  return (Array.isArray(res.keywords) ? res.keywords : [])
    .map((k) => normalizeJapanese(String(k ?? "").trim().replace(/\s+/g, " ")))
    .filter((k) => k && k.length <= 40 && !seen.has(k.replace(/\s+/g, "")))
    .slice(0, 5);
}
