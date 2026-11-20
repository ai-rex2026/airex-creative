import { createAdminClient } from "@/lib/supabase/admin";
import { askJson, MODEL_FAST } from "@/lib/anthropic";
import { TASKS, type KnowhowTask } from "@/lib/knowhow";
import { detectConflicts, MAX_NEW, type ConflictAsk, type ConflictRef, type NewItem } from "@/lib/knowhow-conflicts";

/** その領域で選べる用途（SEO と AIO は記事づくりを共有） */
function optionsFor(area: string): Record<string, string> | undefined {
  const o: Record<string, string> = {};
  for (const [k, v] of Object.entries(TASKS)) {
    if (v.area === area || ((area === "aio" || area === "seo") && (v.area === "aio" || v.area === "seo"))) o[k as KnowhowTask] = v.label;
  }
  return Object.keys(o).length ? o : undefined;
}

/** 同じ領域で承認済みの案を、比較用に集める（AI への指示の文・辞書のルール・コードで実装した案） */
export async function loadRefs(areas: string[]): Promise<ConflictRef[]> {
  const sb = createAdminClient();
  const { data } = await sb
    .from("knowhow_items")
    .select("id, area, form, title, applied_text, impl_note, rule")
    .eq("status", "approved")
    .neq("kind", "nochange")
    .in("area", areas)
    .order("decided_at", { ascending: true })
    .limit(200);
  return (data ?? []).map((r) => {
    const rule = r.rule as { reason?: string; pattern?: string } | null;
    const text = r.form === "legal_rule" ? `${rule?.reason ?? ""}（検出：${rule?.pattern ?? ""}）` : r.form === "code" ? String(r.impl_note || r.applied_text || r.title) : String(r.applied_text || r.title);
    return { id: String(r.id), area: String(r.area), form: String(r.form), title: String(r.title), text };
  });
}

/**
 * 判断待ちで、まだ矛盾チェックをしていない案（最大 MAX_NEW 件）を判定して保存する。
 * 保存は1件ずつ。AI が失敗したら印を付けず、次回やり直す（済んだ案は再判定しない）
 */
export async function checkPendingConflicts(ask?: ConflictAsk, itemIds?: string[]): Promise<{ checked: number; withConflict: number; failed: boolean }> {
  const sb = createAdminClient();
  let q = sb.from("knowhow_items").select("id, key, area, form, title, applied_text, impl_note, tasks").eq("status", "pending").is("dup_of", null).is("conflict_checked_at", null).order("created_at", { ascending: true }).limit(MAX_NEW);
  if (itemIds?.length) q = q.in("id", itemIds);
  const { data } = await q;
  const rows = data ?? [];
  if (rows.length === 0) return { checked: 0, withConflict: 0, failed: false };
  const items: NewItem[] = rows.map((r) => ({ key: String(r.id), area: String(r.area), title: String(r.title), text: String(r.applied_text || r.impl_note || r.title), taskOptions: r.form === "note" && (!Array.isArray(r.tasks) || r.tasks.length === 0) ? optionsFor(String(r.area)) : undefined }));
  const refs = await loadRefs([...new Set(items.flatMap((i) => (i.area === "seo" || i.area === "aio" ? ["seo", "aio"] : [i.area])))]);
  const fn: ConflictAsk = ask ?? ((s, u) => askJson(s, u, { model: MODEL_FAST }));
  const res = await detectConflicts(items, refs, fn);
  if (!res) return { checked: 0, withConflict: 0, failed: true };
  let withConflict = 0;
  const now = new Date().toISOString();
  for (const [id, c] of res) {
    // 用途の提案は、管理者がまだ用途を決めていない（空の）案にだけ入れる。承認の画面で変えられる
    const { error } = await sb.from("knowhow_items").update({ conflicts: c.conflicts, conflict_checked_at: now, conflict_ok: false, ...(c.tasks.length ? { tasks: c.tasks } : {}) }).eq("id", id);
    if (!error && c.conflicts.length) withConflict++;
  }
  return { checked: res.size, withConflict, failed: false };
}

/** 未確認の案を、時間の許す限り10件ずつ続けて全件確認する（失敗したら止める。残りは次回） */
export async function checkAllPendingConflicts(deadlineMs = 120_000, ask?: ConflictAsk): Promise<{ checked: number; withConflict: number; failed: boolean; remaining: number }> {
  const end = Date.now() + deadlineMs;
  let checked = 0;
  let withConflict = 0;
  let failed = false;
  for (let i = 0; i < 50 && Date.now() < end - 20_000; i++) {
    const r = await checkPendingConflicts(ask);
    checked += r.checked;
    withConflict += r.withConflict;
    if (r.failed) {
      failed = true;
      break;
    }
    if (r.checked === 0) break;
  }
  const { count } = await createAdminClient().from("knowhow_items").select("id", { count: "exact", head: true }).eq("status", "pending").is("dup_of", null).is("conflict_checked_at", null);
  return { checked, withConflict, failed, remaining: count ?? 0 };
}
