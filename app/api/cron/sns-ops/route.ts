import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runDailyX, sendApproved } from "@/lib/sns-ops/x-run";
import { runDailyMedia, sendApprovedMedia } from "@/lib/sns-ops/media-run";
import { publishVideo, defaultVideoPublishDeps } from "@/lib/sns-ops/video-run";
import type { MediaPlatform } from "@/lib/sns-ops/media-brain";
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
  const { data: due } = await admin.from("sns_posts").select("id, user_id, platform").eq("status", "approved").is("error_message", null).lte("scheduled_at", new Date().toISOString()).limit(30);
  const sent: Record<string, string> = {};
  for (const r of (due ?? []) as { id: string; user_id: string; platform: string }[]) {
    if (Date.now() > deadline - 120_000) break;
    try {
      sent[r.id] = r.platform === "x" ? await sendApproved(admin, admin, r.user_id, r.id) : await sendApprovedMedia(admin, admin, r.user_id, r.id);
    } catch (e) {
      sent[r.id] = `error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  out.scheduled = sent;

  // 1b) 承認済みで、媒体側の処理待ち・予約の動画の続き
  const { data: vids } = await admin.from("sns_videos").select("id, user_id, publish_state").eq("status", "approved").not("video_path", "is", null).limit(10);
  const vsent: Record<string, string> = {};
  for (const r of (vids ?? []) as { id: string; user_id: string; publish_state: { errors?: number } | null }[]) {
    if (Date.now() > deadline - 150_000) break;
    // 3回続けて失敗したものは自動では送らない（画面で直して送り直す）
    if ((r.publish_state?.errors ?? 0) >= 3) continue;
    try {
      vsent[r.id] = (await publishVideo(admin, r.user_id, r.id, defaultVideoPublishDeps(admin), Math.min(deadline - 100_000, Date.now() + 120_000))).state;
    } catch (e) {
      vsent[r.id] = `error: ${e instanceof Error ? e.message : String(e)}`;
      const { data: cur } = await admin.from("sns_videos").select("publish_state").eq("id", r.id).maybeSingle();
      const ps = (cur?.publish_state as Record<string, unknown>) ?? {};
      await admin.from("sns_videos").update({ error_message: vsent[r.id].slice(0, 400), publish_state: { ...ps, errors: Number(ps.errors ?? 0) + 1 } }).eq("id", r.id);
    }
  }
  out.videos = vsent;

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

  // 3) Instagram・TikTok・YouTube の毎日の工程
  const { data: mu } = await admin.from("sns_ops_settings").select("user_id, platform").in("platform", ["instagram", "tiktok", "youtube"]).eq("enabled", true).limit(300);
  const { data: mruns } = await admin.from("sns_daily_runs").select("user_id, platform, steps").in("platform", ["instagram", "tiktok", "youtube"]).eq("day", jstDay());
  const mdone = new Map(((mruns ?? []) as { user_id: string; platform: string; steps: Record<string, { done?: boolean; tries?: number }> }[]).map((r) => [`${r.user_id}:${r.platform}`, r.steps]));
  const media: Record<string, unknown> = {};
  for (const u of (mu ?? []) as { user_id: string; platform: MediaPlatform }[]) {
    if (Date.now() > deadline - 100_000) break;
    const st = mdone.get(`${u.user_id}:${u.platform}`);
    if (st && Object.values(st).length >= 4 && Object.values(st).every((x) => x.done || (x.tries ?? 0) >= 2)) continue;
    try {
      media[`${u.user_id}:${u.platform}`] = await runDailyMedia(admin, u.user_id, u.platform, deadline);
    } catch (e) {
      media[`${u.user_id}:${u.platform}`] = { error: e instanceof Error ? e.message : String(e) };
    }
  }
  out.media = media;
  return NextResponse.json(out);
}
