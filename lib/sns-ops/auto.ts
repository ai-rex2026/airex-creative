import type { SupabaseClient } from "@supabase/supabase-js";
import { jstDateKey } from "../meo-ops/daily";
import { isSnsPlatform, type SnsPlatform } from "../social-connect/platforms";
import { insertDrafts, loadSettings } from "./store";
import { draftSnsPosts, suggestWeeklyTopic } from "./writer";

/**
 * 週1の自動生成（Vercel Cron から毎日1回）。
 * 「自動運用」をオンにした人のうち、今日（JST）が指定の曜日で、今週まだ自動の下書きを作っていない人だけに
 * テーマ決め → 媒体ごとの投稿案 → 下書き保存、を行う。投稿はしない（人が /sns で確認して送る）。
 *
 * AGENTS.md の決めごと: 1人ずつ結果をその場で保存し、失敗は他の人に波及させない。
 * 再実行しても同じ週に2回作らない（既存の auto 下書きの有無で判定）。
 */

function jstWeekday(d = new Date()): number {
  const s = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", weekday: "short" }).format(d);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(s);
}

export async function runWeeklyDrafts(admin: SupabaseClient, limit = 50) {
  const weekday = jstWeekday();
  const today = jstDateKey();
  const sinceIso = new Date(Date.now() - 6 * 24 * 3600_000).toISOString();

  const { data: users } = await admin
    .from("sns_settings")
    .select("user_id")
    .eq("auto_enabled", true)
    .eq("auto_weekday", weekday)
    .limit(limit);

  const out: { user_id: string; result: string }[] = [];
  for (const u of users ?? []) {
    const userId = u.user_id as string;
    try {
      // 今週すでに自動の下書きがあれば作らない（再実行・二重起動に備える）
      const { count } = await admin.from("sns_posts").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("source", "auto").gte("created_at", sinceIso);
      if ((count ?? 0) > 0) {
        out.push({ user_id: userId, result: "exists" });
        continue;
      }
      const { data: conns } = await admin.from("sns_connections").select("platform").eq("user_id", userId);
      const platforms = (conns ?? []).map((c) => c.platform as string).filter(isSnsPlatform) as SnsPlatform[];
      if (!platforms.length) {
        out.push({ user_id: userId, result: "no-connection" });
        continue;
      }
      const settings = await loadSettings(admin, userId);
      const { data: recent } = await admin.from("sns_posts").select("topic").eq("user_id", userId).order("created_at", { ascending: false }).limit(12);
      const recentTopics = [...new Set((recent ?? []).map((r) => String(r.topic ?? "")).filter(Boolean))];
      const { topic } = await suggestWeeklyTopic(settings, recentTopics);
      const drafts = await draftSnsPosts(topic, platforms, settings);
      await insertDrafts(admin, userId, topic, drafts, "auto");
      out.push({ user_id: userId, result: `created:${drafts.length}` });
    } catch (e) {
      console.error("[sns-weekly]", userId, e instanceof Error ? e.message : e);
      out.push({ user_id: userId, result: `failed: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}` });
    }
  }
  return { date: today, weekday, processed: out };
}
