import { NextResponse } from "next/server";
import { refreshAllAdTokens } from "@/lib/ads/tokens";

export const maxDuration = 120;

/**
 * 広告アカウントのトークンをまとめて更新する。Vercel Cron から週１回叩かれる。
 * CRON_SECRET が無いと誰でも叩けてしまうので、未設定のときは動かさない。
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET が未設定です" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await refreshAllAdTokens());
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
