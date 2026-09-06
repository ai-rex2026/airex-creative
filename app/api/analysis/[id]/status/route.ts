import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** 進捗の読み取りだけ。画面はこれを見るだけで、処理は動かさない */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sb = await createClient();
  const { data } = await sb
    .from("analyses")
    .select("status,step,progress,error")
    .eq("id", id)
    .single();
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(data);
}
