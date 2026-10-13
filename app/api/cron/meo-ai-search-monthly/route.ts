import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createCheck, runCheck } from "@/lib/meo-ops/ai-search";
import { runMonthlyAiSearch } from "@/lib/meo-ops/ai-search-monthly";
import { jstPeriodKey } from "@/lib/meo-ops/daily";

export const maxDuration = 300;

/**
 * AI検索の月次の自動実測。毎日起動するが、今月すでに実測があれば何もしないので、実際に測るのは月1回。
 * 有料のAI呼び出しを含むため、シークレットが無い環境では受け付けない。
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const results = await runMonthlyAiSearch(createAdminClient(), {
    period: jstPeriodKey(),
    createCheck,
    runCheck,
  });
  return NextResponse.json({ results });
}
