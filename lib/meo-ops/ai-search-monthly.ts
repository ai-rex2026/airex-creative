import type { SupabaseClient } from "@supabase/supabase-js";
import type { Industry } from "../types";
import type { MeoStoreSnapshot } from "./types";

/**
 * AI検索の月次の自動実測。
 *
 * - 対象は MEO 運用の店舗のうち、これまでに完了した実測がある店舗（検索語は前回のものを引き継ぐ。推測で決めない）
 * - 今月すでに完了・実行中・待機中の実測があれば何もしない（再実行しても有料の呼び出しを繰り返さない）
 * - 今月の失敗が MAX_FAILED_PER_PERIOD 件に達したら、それ以上は自動で測らない
 * - 1回の起動で測る店舗は MAX_STORES_PER_RUN まで。残りは翌日の起動に回る
 * - 各実測は runCheck が完了時にその場で保存する（まとめて最後に保存しない）
 */

export const MAX_STORES_PER_RUN = 3;
export const MAX_FAILED_PER_PERIOD = 3;

export type MonthlyDeps = {
  /** 今月（JST）のキー。例: "2026-10" */
  period: string;
  createCheck: (sb: SupabaseClient, storeId: string, area: string, category: string) => Promise<{ checkId: string }>;
  runCheck: (
    sb: SupabaseClient,
    checkId: string,
    ctx: { store: MeoStoreSnapshot | null; ownNames: string[]; industry: Industry }
  ) => Promise<boolean>;
};

export type MonthlyResult = {
  store_id: string;
  action: "measured" | "skipped" | "error";
  reason?: string;
  check_id?: string;
};

type CheckRow = { status: string; period: string | null; query_area: string | null; query_category: string | null };

export async function runMonthlyAiSearch(sb: SupabaseClient, deps: MonthlyDeps): Promise<MonthlyResult[]> {
  const { data: stores, error } = await sb.from("stores").select("id, name, industry, meo_store").not("meo_store", "is", null);
  if (error) throw new Error(`店舗の取得に失敗しました: ${error.message}`);

  const results: MonthlyResult[] = [];
  let started = 0;

  for (const s of stores ?? []) {
    const storeId = s.id as string;
    try {
      const { data: rows, error: e2 } = await sb
        .from("ai_search_checks")
        .select("status, period, query_area, query_category")
        .eq("store_id", storeId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (e2) throw new Error(e2.message);
      const checks = (rows ?? []) as CheckRow[];

      const thisPeriod = checks.filter((c) => c.period === deps.period);
      if (thisPeriod.some((c) => ["completed", "running", "pending"].includes(c.status))) {
        results.push({ store_id: storeId, action: "skipped", reason: "今月は実施済み（または実行中）" });
        continue;
      }
      if (thisPeriod.filter((c) => c.status === "failed").length >= MAX_FAILED_PER_PERIOD) {
        results.push({ store_id: storeId, action: "skipped", reason: `今月の失敗が${MAX_FAILED_PER_PERIOD}件に達したため自動実行を止めています` });
        continue;
      }
      const last = checks.find((c) => c.status === "completed" && c.query_area?.trim() && c.query_category?.trim());
      if (!last) {
        results.push({ store_id: storeId, action: "skipped", reason: "前回の検索語がない（先に手動で1回実行してください）" });
        continue;
      }
      if (started >= MAX_STORES_PER_RUN) {
        results.push({ store_id: storeId, action: "skipped", reason: "1回の起動の上限。次回に回します" });
        continue;
      }

      started++;
      const created = await deps.createCheck(sb, storeId, last.query_area as string, last.query_category as string);
      const store = (s.meo_store as MeoStoreSnapshot | null) ?? null;
      // 自店の名前だけで照合する（分析したサイトのタイトルは使わない）
      const ownNames = [store?.name ?? "", (s.name as string | null) ?? ""].filter((n) => n.trim());
      const industry = (s.industry as Industry | null) ?? "general";
      const ok = await deps.runCheck(sb, created.checkId, { store, ownNames, industry });
      results.push({ store_id: storeId, action: ok ? "measured" : "error", check_id: created.checkId, ...(ok ? {} : { reason: "実測が完了しませんでした" }) });
    } catch (e) {
      // 1店舗の失敗で他の店舗を止めない
      results.push({ store_id: storeId, action: "error", reason: e instanceof Error ? e.message.slice(0, 200) : "原因不明" });
    }
  }
  return results;
}
