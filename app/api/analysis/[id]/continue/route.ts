import { NextResponse } from "next/server";
import { processAnalysis } from "@/lib/worker";

// 分析1件が丸ごと入るだけの時間を確保する（cron/worker と同じ）
export const maxDuration = 300;

/**
 * lib/worker.ts の processAnalysis が時間切れになったときに、自分自身へ投げる継続用エンドポイント。
 * cron の巡回（最大1分＋stale判定200秒）を待たずに次のバーストをすぐ始めるためのもの。
 * 画面や外部からは通常叩かない（叩かれても、その分析が既に完了していれば即座に終わるだけ）。
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const attempt = Number(new URL(req.url).searchParams.get("attempt") ?? "0") || 0;
  try {
    const status = await processAnalysis(id, 240_000, attempt);
    return NextResponse.json({ status });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
