import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tick } from "@/lib/analysis";

// 1工程あたりの上限。診断（サイト読取＋生成）が一番長い
export const maxDuration = 120;

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "セッションがありません" }, { status: 401 });

  try {
    const a = await tick(sb, id);
    return NextResponse.json({
      status: a.status,
      step: a.step,
      progress: a.progress,
      error: a.error,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
