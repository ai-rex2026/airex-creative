import { NextResponse } from "next/server";
import { runWebScanAll } from "@/lib/knowhow-web-run";

export const maxDuration = 300;

/**
 * 第三者の情報（公式サイト以外のウェブ・X）からのノウハウ案づくりの週1回の実行（2026-11-20）。
 * まだ vercel.json の cron には入れていない（管理画面の「集める」ボタンで各領域の出来を確かめてから入れる）。
 * CRON_SECRET が無いと誰でも叩けてしまうので、未設定のときは動かさない
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET が未設定です" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await runWebScanAll());
}
