import type { SupabaseClient } from "@supabase/supabase-js";
import { getPlaceDetails, scoreMeo } from "./places";
import type { MeoStoreSnapshot } from "./types";

/**
 * MEO 日次スナップショット（本体 app/services/meo/daily_snapshot.py の移植）。
 *
 * 毎日1回、店舗の「その日時点の実測値」を meo_daily へ1件書く。ダッシュボードはこの積み重ねを推移として見せる。
 * 毎日引くのは自店の Place Details 1回だけ。競合は店舗確定時に保存したものでスコアを再計算する
 * （競合の星や件数は日単位ではほぼ動かず、毎日引くと1店舗あたり11倍のコストになる）。
 * さらに「30日開かれていない店舗は回さない」で母数を削る。
 */

/** この日数より前にしか開かれていない店舗は対象外 */
const INACTIVE_DAYS = 30;
/** 1回の実行で回す上限 */
const MAX_STORES = 300;

/** JST の yyyy-mm-dd。UTC で取ると 9時前が前日になり、画面の日付と1日ずれる */
export function jstDateKey(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(d);
}

export function jstPeriodKey(d: Date = new Date()): string {
  return jstDateKey(d).slice(0, 7);
}

function previousDateKey(key: string): string {
  const d = new Date(`${key}T00:00:00+09:00`);
  d.setDate(d.getDate() - 1);
  return jstDateKey(d);
}

/** その日の1件を書く。同日2回目は書かない（再実行しても壊れない） */
export async function writeDaily(
  sb: SupabaseClient,
  analysisId: string,
  store: Pick<MeoStoreSnapshot, "meoScore" | "reviewCount" | "rating">,
  day = jstDateKey()
): Promise<"written" | "exists"> {
  const { data: existing } = await sb
    .from("meo_daily")
    .select("date")
    .eq("analysis_id", analysisId)
    .eq("date", day)
    .maybeSingle();
  if (existing) return "exists";

  const { data: prev } = await sb
    .from("meo_daily")
    .select("review_count")
    .eq("analysis_id", analysisId)
    .eq("date", previousDateKey(day))
    .maybeSingle();

  const reviewCount = store.reviewCount ?? 0;
  // userRatingCount が落ちた日は 0 になる。そのまま差を取ると翌日に偽の急増が出るので、増加数は不明にする
  const unreliable = store.reviewCount == null;
  const before = prev ? (prev.review_count as number) : null;

  await sb.from("meo_daily").upsert({
    analysis_id: analysisId,
    date: day,
    meo_score: store.meoScore,
    review_count: reviewCount,
    new_review_count: before == null || unreliable ? null : Math.max(reviewCount - before, 0),
    average_rating: store.rating,
  });
  return "written";
}

export type DailyResult = { written: number; skipped: Record<string, number>; failed: number };

/** cron から呼ぶ。対象店舗の当日スナップショットを書く */
export async function snapshotDaily(sb: SupabaseClient): Promise<DailyResult> {
  const result: DailyResult = { written: 0, skipped: {}, failed: 0 };
  const skip = (reason: string) => (result.skipped[reason] = (result.skipped[reason] ?? 0) + 1);
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    skip("no_places_key");
    return result;
  }

  const cutoff = new Date(Date.now() - INACTIVE_DAYS * 864e5).toISOString();
  const { data } = await sb
    .from("analyses")
    .select("id, meo_place_id, meo_store")
    .not("meo_place_id", "is", null)
    .gte("meo_last_opened_at", cutoff)
    .order("meo_last_opened_at", { ascending: false })
    .limit(MAX_STORES);

  const day = jstDateKey();
  for (const row of data ?? []) {
    try {
      const { data: done } = await sb
        .from("meo_daily")
        .select("date")
        .eq("analysis_id", row.id)
        .eq("date", day)
        .maybeSingle();
      if (done) {
        skip("already_done");
        continue;
      }
      const detail = await getPlaceDetails(row.meo_place_id as string);
      if (!detail) {
        result.failed++;
        continue;
      }
      const cached = (row.meo_store as MeoStoreSnapshot | null) ?? null;
      const competitors = cached?.placeId === detail.placeId ? cached.competitors : [];
      const scored = scoreMeo(detail, competitors);
      const next: MeoStoreSnapshot = { ...detail, competitors, ...scored, fetchedAt: new Date().toISOString() };
      await writeDaily(sb, row.id as string, next, day);
      // 画面の見出し（星・件数・スコア）も最新にしておく
      await sb.from("analyses").update({ meo_store: next }).eq("id", row.id);
      result.written++;
    } catch {
      // 1店舗の想定外エラーで他店舗を止めない
      result.failed++;
    }
  }
  return result;
}
