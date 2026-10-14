import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createCheck } from "@/lib/aio/run";
import { AIO_PROMPT_COLUMNS, rowToPrompt } from "@/lib/aio/store";
import { jstPeriodKey } from "@/lib/meo-ops/daily";

export const maxDuration = 120;

/**
 * AIO の月次モニタリング。Vercel Cron から毎月2日 1:00 JST に叩かれ、「月次モニタリング」をオンにした対象の
 * 有効な対策プロンプトを全部 pending で積む（source = monthly。手動の上限は消費しない）。
 * 実際の問い合わせは /api/cron/aio-pending が10分おきに拾って順に行う（1回2件＝20本で約100分）。
 * 同じ月に同じプロンプトを二重に積まない（再実行しても壊れない）。
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  const period = jstPeriodKey();
  const out: { project_id: string; queued: number }[] = [];
  try {
    const { data: projects } = await admin.from("aio_projects").select("id").eq("monitoring_enabled", true).limit(200);
    for (const p of projects ?? []) {
      const pid = p.id as string;
      const { data: prompts } = await admin.from("aio_prompts").select(AIO_PROMPT_COLUMNS).eq("project_id", pid).eq("active", true);
      const { data: done } = await admin.from("aio_checks").select("prompt_id").eq("project_id", pid).eq("period", period).eq("source", "monthly");
      const already = new Set((done ?? []).map((d) => String(d.prompt_id)));
      let queued = 0;
      for (const r of (prompts ?? []) as Record<string, unknown>[]) {
        const pr = rowToPrompt(r);
        if (already.has(pr.id)) continue;
        try {
          await createCheck(admin, pid, pr.text, { promptId: pr.id, source: "monthly" });
          queued++;
        } catch (e) {
          console.error("[aio-monthly]", pid, pr.id, e instanceof Error ? e.message : e);
        }
      }
      out.push({ project_id: pid, queued });
    }
    return NextResponse.json({ period, projects: out });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e), projects: out }, { status: 500 });
  }
}
