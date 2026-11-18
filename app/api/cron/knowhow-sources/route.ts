import { NextResponse } from "next/server";
import { runKnowhowSources } from "@/lib/knowhow-run";

export const maxDuration = 300;

/**
 * 一次情報（公式ページ）の定期取得（2026-11-18）。Vercel Cron から週1回（月曜 3:40 JST）叩かれる。
 * 変わったページだけ AI で案にして、ノウハウ更新案の受信箱（判断待ち）に入れる。自動では反映しない。
 * CRON_SECRET が無いと誰でも叩けてしまうので、未設定のときは動かさない
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET が未設定です" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await runKnowhowSources());
}
