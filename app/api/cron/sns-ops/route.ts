import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runDailyX, sendApproved } from "@/lib/sns-ops/x-run";
import { jstDay } from "@/lib/sns-ops/day";

export const maxDuration = 300;

/**
 * SNS運用（X）の自動。Vercel Cron から30分おきに叩かれる。
 * 1) 予約時刻を過ぎた「承認済み」の案を送る（人が承認したものだけ）
 * 2) 毎日の工程（集める・型の分析・案・画像・反応の候補・DM の返信案）を、設定でオンの人だけ進める。
 *    工程ごとに済み印を付けるので、途中で時間切れになっても次の回に続きから進む（済んだ有料の呼び出しは繰り返さない）
 * 自動で送るのは 1) の「承認済み」だけ。案は作るだけで送らない（AGENTS.md）。
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  const deadline = Date.now() + 250_000;
  const out: Record<string, unknown> = {};

  // 1) 予約の送信
  const { data: due } = await admin.from("sns_posts").select("id, user_id").eq("status", "approved").eq("platform", "x").lte("scheduled_at", new Date().toISOString()).limit(30);
  const sent: Record<string, string> = {};
  for (const r of (due ?? []) as { id: string; user_id: string }[]) {
    if (Date.now() > deadline - 120_000) break;
    try {
      sent[r.id] = await sendApproved(admin, admin, r.user_id, r.id);
    } catch (e) {
      sent[r.id] = `error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  out.scheduled = sent;

  // 2) 毎日の工程（その日まだ終わっていない人から）
  const { data: users } = await admin.from("sns_ops_settings").select("user_id").eq("platform", "x").eq("enabled", true).limit(200);
  const { data: runs } = await admin.from("sns_daily_runs").select("user_id, steps").eq("platform", "x").eq("day", jstDay());
  const doneMap = new Map(((runs ?? []) as { user_id: string; steps: Record<string, { done?: boolean; tries?: number }> }[]).map((r) => [r.user_id, r.steps]));
  const daily: Record<string, unknown> = {};
  for (const u of (users ?? []) as { user_id: string }[]) {
    if (Date.now() > deadline - 100_000) break;
    const st = doneMap.get(u.user_id);
    if (st && ["bench", "search", "own", "patterns", "drafts", "images", "engage", "dms"].every((k) => st[k]?.done || (st[k]?.tries ?? 0) >= 2)) continue;
    try {
      daily[u.user_id] = await runDailyX(admin, u.user_id, deadline);
    } catch (e) {
      daily[u.user_id] = { error: e instanceof Error ? e.message : String(e) };
    }
  }
  out.daily = daily;
  return NextResponse.json(out);
}
