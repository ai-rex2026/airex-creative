import { NextResponse } from "next/server";
import { runSpeedRound } from "@/lib/speed-job";

// 1回の計測に5分弱を丸ごと使う（lib/speed-job.ts の ROUND_MS）
export const maxDuration = 300;

/**
 * 表示速度の専用の計測（lib/speed-job.ts）。分析の開始直後に、分析の工程とは別に起動される。
 * 測れなければ自分で次の回を起動する。画面や外部からは叩かない
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const round = Math.max(1, Number(new URL(req.url).searchParams.get("round") ?? "1") || 1);
  try {
    const speed = await runSpeedRound(id, round);
    return NextResponse.json({ score: speed?.score ?? null });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
