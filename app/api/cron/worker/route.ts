import { NextResponse } from "next/server";
import { processPending } from "@/lib/worker";

// 分析1件が丸ごと入るだけの時間を確保する
export const maxDuration = 300;

/**
 * 止まっている分析を拾って進める。Vercel Cron から毎分叩かれる。
 * 通常は投入直後に after() が走り切るので、ここは取りこぼしの回収用。
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const res = await processPending();
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
