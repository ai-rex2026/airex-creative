import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { expireStuckChecks, pendingCheckIds, runCheck } from "@/lib/aio/run";
import { expireStuckOverviews, pendingOverviewIds, runOverview } from "@/lib/aio/overview";
import { AIO_PROJECT_COLUMNS, rowToProject } from "@/lib/aio/store";

export const maxDuration = 300;

/** 1回の cron で同時に回す本数（AI の検索つき呼び出し・DataForSEO の Live とも同時実行の上限より十分少ない） */
const CHECKS_PER_RUN = 6;
const OVERVIEWS_PER_RUN = 12;

/**
 * AIO の実測の取りこぼし回収（店舗の /api/cron/meo-ai-search と同じ役目）。
 * 画面から始めた実測のうち、その場（after()）で回しきれなかった分と、関数ごと切られて残ったものを5分おきに拾う。
 * 実測と Google の概要を同時に並べて回す（CHECKS_PER_RUN・OVERVIEWS_PER_RUN）。
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  const done: { id: string; ok: boolean }[] = [];
  const overviews: { id: string; ok: boolean }[] = [];
  try {
    await expireStuckChecks(admin);
    await expireStuckOverviews(admin);
    // 2026-11-16：1件ずつ順に回すと10本で30〜40分かかり、概要は実測に時間を取られて回らなかった。
    // 実測（1件 最長200秒）と概要（1件 最長60秒）を同時に並べて回す。それぞれ1件ごとに保存し、取れた処理だけが呼ぶ（runCheck・runOverview の中で pending→running）
    const projects = new Map<string, ReturnType<typeof rowToProject> | null>();
    const projectOf = async (pid: string) => {
      if (!projects.has(pid)) {
        const { data } = await admin.from("aio_projects").select(AIO_PROJECT_COLUMNS).eq("id", pid).maybeSingle();
        projects.set(pid, data ? rowToProject(data as Record<string, unknown>) : null);
      }
      return projects.get(pid) ?? null;
    };
    const [checkIds, overviewIds] = await Promise.all([pendingCheckIds(admin, CHECKS_PER_RUN), pendingOverviewIds(admin, OVERVIEWS_PER_RUN)]);
    await Promise.allSettled([
      ...checkIds.map(async (c) => {
        const p = await projectOf(c.project_id);
        if (!p) return;
        const ok = await runCheck(admin, c.id, { name: p.name, aliases: p.aliases }).catch(() => false);
        done.push({ id: c.id, ok });
      }),
      ...overviewIds.map(async (c) => {
        const p = await projectOf(c.project_id);
        if (!p) return;
        const ok = await runOverview(admin, c.id, p).catch(() => false);
        overviews.push({ id: c.id, ok });
      }),
    ]);
    return NextResponse.json({ done, overviews });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e), done }, { status: 500 });
  }
}
