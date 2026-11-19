import { createAdminClient } from "@/lib/supabase/admin";
import { askJson, MODEL_FAST } from "@/lib/anthropic";
import { detectConflicts, MAX_NEW, type ConflictAsk, type ConflictRef, type NewItem } from "@/lib/knowhow-conflicts";

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
  let q = sb.from("knowhow_items").select("id, key, area, title, applied_text, impl_note").eq("status", "pending").is("conflict_checked_at", null).order("created_at", { ascending: true }).limit(MAX_NEW);
  if (itemIds?.length) q = q.in("id", itemIds);
  const { data } = await q;
  const rows = data ?? [];
  if (rows.length === 0) return { checked: 0, withConflict: 0, failed: false };
  const items: NewItem[] = rows.map((r) => ({ key: String(r.id), area: String(r.area), title: String(r.title), text: String(r.applied_text || r.impl_note || r.title) }));
  const refs = await loadRefs([...new Set(items.flatMap((i) => (i.area === "seo" || i.area === "aio" ? ["seo", "aio"] : [i.area])))]);
  const fn: ConflictAsk = ask ?? ((s, u) => askJson(s, u, { model: MODEL_FAST }));
  const res = await detectConflicts(items, refs, fn);
  if (!res) return { checked: 0, withConflict: 0, failed: true };
  let withConflict = 0;
  const now = new Date().toISOString();
  for (const [id, conflicts] of res) {
    const { error } = await sb.from("knowhow_items").update({ conflicts, conflict_checked_at: now, conflict_ok: false }).eq("id", id);
    if (!error && conflicts.length) withConflict++;
  }
  return { checked: res.size, withConflict, failed: false };
}
