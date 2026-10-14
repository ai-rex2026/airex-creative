import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runAutoForAll } from "@/lib/meo-ops/kit/auto";

export const maxDuration = 300;

/**
 * MEO の「自動で回す」。Vercel Cron から毎日 10:00 JST に叩かれる。
 * お店ごとの設定（既定はすべてオフ）に従って、口コミの返信文・週1の投稿を作り、
 * 基準を満たすものだけ送る。それ以外は確認待ちに入れる（lib/meo-ops/kit/auto.ts）。
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const results = await runAutoForAll(createAdminClient(), Date.now() + 240_000);
    return NextResponse.json({ results });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
