import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { findDup, type DupRow } from "@/lib/knowhow-dedupe";

type PoolRow = DupRow & { id: string; status: string; created_at: string };

/** 比べる相手：除かれていない案のすべて（判断待ち・承認・保留・却下） */
export async function loadPool(sb: SupabaseClient): Promise<PoolRow[]> {
  const { data } = await sb
    .from("knowhow_items")
    .select("id, area, form, title, summary, applied_text, impl_note, status, created_at")
    .is("dup_of", null)
    .order("created_at", { ascending: true })
    .limit(3000);
  return (data ?? []) as PoolRow[];
}

/**
 * 新しい案のうち、既存の案（や、同じ実行で先に通った案）と似ているものを除く。保存しないので、AI の矛盾チェックも要らない。
 * 失敗したら（DB が読めない）除かずに通す（案を失うより、重複が残る方を選ぶ）
 */
export async function dropDuplicates<T extends DupRow>(items: T[], pool?: DupRow[]): Promise<{ kept: T[]; dropped: number }> {
  if (!items.length) return { kept: items, dropped: 0 };
  let base: DupRow[];
  try {
    base = pool ?? (await loadPool(createAdminClient()));
  } catch {
    return { kept: items, dropped: 0 };
  }
  const kept: T[] = [];
  for (const it of items) {
    if (findDup(it, [...base, ...kept])) continue;
    kept.push(it);
  }
  return { kept, dropped: items.length - kept.length };
}

/**
 * すでにある判断待ちの案のうち、もっと前に作られた案と似ているものに印（dup_of）を付けて、一覧から除く。消さない（画面から戻せる）。
 * 古い案を残す（同じ内容を一度却下した案が、言い換えで戻ってこないように、却下済みの案とも比べる）
 */
export async function sweepDuplicates(sb: SupabaseClient = createAdminClient()): Promise<number> {
  const pool = await loadPool(sb);
  const kept: PoolRow[] = [];
  let n = 0;
  for (const row of pool) {
    if (row.status !== "pending") {
      kept.push(row);
      continue;
    }
    const d = findDup(row, kept);
    if (d) {
      const { error } = await sb.from("knowhow_items").update({ dup_of: d.dup.id }).eq("id", row.id).eq("status", "pending");
      if (!error) n++;
      continue;
    }
    kept.push(row);
  }
  return n;
}
