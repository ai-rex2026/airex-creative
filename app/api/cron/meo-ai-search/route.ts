import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { pendingCheckIds, runCheck } from "@/lib/meo-ops/ai-search";
import type { MeoStoreSnapshot } from "@/lib/meo-ops/types";
import type { Diagnosis } from "@/lib/types";

export const maxDuration = 300;

/**
 * AI検索の取りこぼし回収。通常は受付直後に after() が走り切るので、ここは
 * 関数が途中で落ちて pending のまま残ったチェックを拾い直す安全網（月次枠だけ消えて何も起きないのを防ぐ）。
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const sb = createAdminClient();
  const picked = await pendingCheckIds(sb, 1);
  const done: string[] = [];
  for (const c of picked) {
    const { data: a } = await sb.from("analyses").select("meo_store, meo, site, diagnosis").eq("id", c.analysis_id).maybeSingle();
    const store = (a?.meo_store as MeoStoreSnapshot | null) ?? null;
    const title = ((a?.site as { title?: string } | null)?.title ?? "").split(/[|｜]/)[0] ?? "";
    const ownNames = [store?.name ?? "", (a?.meo as { self?: { name?: string } } | null)?.self?.name ?? "", title].filter((n) => n.trim());
    const industry = (a?.diagnosis as Diagnosis | null)?.industry ?? "general";
    if (await runCheck(sb, c.id, { store, ownNames, industry }).catch(() => false)) done.push(c.id);
  }
  return NextResponse.json({ picked: picked.map((c) => c.id), done });
}
