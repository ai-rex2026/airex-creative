import { NextResponse } from "next/server";
import { runWebScanAll } from "@/lib/knowhow-web-run";

export const maxDuration = 300;

/**
 * 第三者の情報（公式サイト以外のウェブ・X）からのノウハウ案づくりの週1回の実行（2026-11-20）。
 * vercel.json の cron：水〜土 3:50 JST（2026-11-25）。1回で全領域は時間内に終わらないので、複数の日に分けて呼ぶ（同じ週に済んだ単位・Skill の探索は飛ばすので、有料の検索・AI は繰り返さない。残りは次の日が続ける）。
 * CRON_SECRET が無いと誰でも叩けてしまうので、未設定のときは動かさない
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET が未設定です" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await runWebScanAll());
}
