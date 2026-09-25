import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { snapshotDaily } from "@/lib/meo-ops/daily";

// 店舗ごとに Place Details を1回ずつ引くので、件数が多い日に備えて長めに取る
export const maxDuration = 300;

/**
 * MEO の日次スナップショット。Vercel Cron から1日1回（4:00 JST）叩かれる。
 * 過去30日に開かれた店舗だけを回す（見ていない店舗に毎日コストを払わない）。
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await snapshotDaily(createAdminClient()));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
