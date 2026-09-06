import { createAdminClient } from "./supabase/admin";
import { tick } from "./analysis";

/** 実行中とみなす猶予。これより古い更新は「止まっている」と判断して拾い直す */
const STALE_MS = 90_000;

/**
 * 1件の分析を、完了するか時間切れになるまで進める。
 * 画面ではなくサーバー（after / cron）から呼ぶ。
 */
export async function processAnalysis(id: string, budgetMs = 240_000) {
  const sb = createAdminClient();
  const deadline = Date.now() + budgetMs;
  for (;;) {
    const a = await tick(sb, id);
    if (a.status === "done" || a.status === "failed") return a.status;
    if (Date.now() > deadline) return "timeout";
  }
}

/** 止まっている分析を拾って進める。cron から呼ぶ安全網 */
export async function processPending(limit = 3, budgetMs = 240_000) {
  const sb = createAdminClient();
  const staleBefore = new Date(Date.now() - STALE_MS).toISOString();
  const { data } = await sb
    .from("analyses")
    .select("id")
    .in("status", ["queued", "running"])
    .lt("updated_at", staleBefore)
    .order("created_at", { ascending: true })
    .limit(limit);

  const ids = (data ?? []).map((r) => r.id as string);
  const deadline = Date.now() + budgetMs;
  const done: string[] = [];
  for (const id of ids) {
    if (Date.now() > deadline) break;
    await processAnalysis(id, deadline - Date.now());
    done.push(id);
  }
  return { picked: ids, processed: done };
}
