import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runWeeklyDrafts } from "@/lib/sns-ops/auto";

// 1人あたり AI 呼び出しが2回（テーマ決め・媒体ごとの文面）走るので、人数が多い日に備えて長めに取る
export const maxDuration = 300;

/**
 * SNS運用の週1自動生成。Vercel Cron から毎日 9:00 JST に叩かれ、今日が指定曜日の人だけ下書きを作る。
 * 投稿はしない（人が /sns で確認して送る）。
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await runWeeklyDrafts(createAdminClient()));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
