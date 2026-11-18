"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTier } from "@/lib/tier";

/**
 * ノウハウ更新案の判断（2026-11-18）。管理者だけ。画面を隠すだけでは Action を直接呼ばれるので、ここでも毎回ランクを確認する。
 * 承認しても、いまはプロンプトやチェックには自動で反映しない（反映は人が確認して実装する）。
 */
const DECISIONS = { approve: "approved", reject: "rejected", hold: "held", reset: "pending" } as const;
type Decision = keyof typeof DECISIONS;

export async function decideKnowhowAction(fd: FormData): Promise<void> {
  const { userId, tier } = await getTier();
  if (tier !== "admin" || !userId) throw new Error("権限がありません");

  const id = String(fd.get("id") ?? "");
  const decision = String(fd.get("decision") ?? "") as Decision;
  const note = String(fd.get("note") ?? "").slice(0, 500);
  const back = String(fd.get("back") ?? "pending");
  const fail = (m: string) => redirect(`/admin/knowhow?s=${encodeURIComponent(back)}&err=${encodeURIComponent(m)}`);
  if (!id || !(decision in DECISIONS)) return fail("操作が不正です");

  const sb = createAdminClient();
  const { data: item } = await sb.from("knowhow_items").select("id, risk, evidence, status").eq("id", id).maybeSingle();
  if (!item) return fail("案が見つかりません");

  if (decision === "approve") {
    // 法令に関わる案は、公式の出典があり、内容を確認したと明示したものだけ承認できる
    if (item.risk === "legal") {
      if (item.evidence !== "official") return fail("法令に関わる案は、公式の出典があるものだけ承認できます");
      if (fd.get("confirmed") !== "on") return fail("原文を確認したチェックを入れてください");
    }
  }

  const status = DECISIONS[decision];
  const now = new Date().toISOString();
  const { error } = await sb
    .from("knowhow_items")
    .update({
      status,
      decided_by: status === "pending" ? null : userId,
      decided_at: status === "pending" ? null : now,
      decision_note: note,
      updated_at: now,
    })
    .eq("id", id);
  if (error) return fail("保存に失敗しました");
  await sb.from("knowhow_log").insert({ item_id: id, action: decision, by_user: userId, note });
  revalidatePath("/admin/knowhow");
  redirect(`/admin/knowhow?s=${encodeURIComponent(back)}`);
}
