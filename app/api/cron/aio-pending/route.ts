import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { expireStuckChecks, pendingCheckIds, runCheck } from "@/lib/aio/run";
import { AIO_PROJECT_COLUMNS, rowToProject } from "@/lib/aio/store";

export const maxDuration = 300;

/**
 * AIO の実測の取りこぼし回収（店舗の /api/cron/meo-ai-search と同じ役目）。
 * after() で走らせた実測が関数ごと切られて pending のまま残ったものを、10分おきに拾い直す。
 * 1回に2件まで（1件ごとに web 検索つきの AI 呼び出しが走る）。
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  const done: { id: string; ok: boolean }[] = [];
  try {
    await expireStuckChecks(admin);
    for (const c of await pendingCheckIds(admin, 2)) {
      const { data } = await admin.from("aio_projects").select(AIO_PROJECT_COLUMNS).eq("id", c.project_id).maybeSingle();
      if (!data) continue;
      const p = rowToProject(data as Record<string, unknown>);
      const ok = await runCheck(admin, c.id, { name: p.name, aliases: p.aliases }).catch(() => false);
      done.push({ id: c.id, ok });
    }
    return NextResponse.json({ done });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e), done }, { status: 500 });
  }
}
