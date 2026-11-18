"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkGuardDict } from "@/lib/guardrail";
import { MAX_APPLIED_TEXT, toRule } from "@/lib/knowhow";
import { getTier } from "@/lib/tier";

/**
 * ノウハウ更新案の判断（2026-11-18）。管理者だけ。画面を隠すだけでは Action を直接呼ばれるので、ここでも毎回ランクを確認する。
 * 承認すると、承認済みのものが実際のルールに反映される（lib/knowhow.ts）。「判断待ちに戻す」「却下」で外れる。
 */
const DECISIONS = { approve: "approved", reject: "rejected", hold: "held", reset: "pending" } as const;
type Decision = keyof typeof DECISIONS;

export async function decideKnowhowAction(fd: FormData): Promise<void> {
  const { userId, tier } = await getTier();
  if (tier !== "admin" || !userId) throw new Error("権限がありません");

  const id = String(fd.get("id") ?? "");
  const decision = String(fd.get("decision") ?? "") as Decision;
  const note = String(fd.get("note") ?? "").slice(0, 500);
  // 絞り込み（状態・カテゴリ・日付）は、操作のあとも保つ。許可したキーだけ受け取る
  const keep = new URLSearchParams();
  const src = new URLSearchParams(String(fd.get("back") ?? ""));
  for (const k of ["s", "a", "by", "from", "to"]) {
    const v = src.get(k);
    if (v && /^[A-Za-z0-9_-]{1,12}$/.test(v)) keep.set(k, v);
  }
  const fail = (m: string) => redirect(`/admin/knowhow?${keep.toString()}${keep.size ? "&" : ""}err=${encodeURIComponent(m)}`);
  if (!id || !(decision in DECISIONS)) return fail("操作が不正です");

  const sb = createAdminClient();
  const { data: item } = await sb.from("knowhow_items").select("id, risk, evidence, status, form, kind, rule").eq("id", id).maybeSingle();
  if (!item) return fail("案が見つかりません");

  if (decision === "approve") {
    // 法令に関わる案は、公式の出典があり、内容を確認したと明示したものだけ承認できる
    if (item.risk === "legal") {
      if (item.evidence !== "official") return fail("法令に関わる案は、公式の出典があるものだけ承認できます");
      if (fd.get("confirmed") !== "on") return fail("原文を確認したチェックを入れてください");
    }
  }

  // 承認すると実際のルールに反映される。反映される文（管理者が直せる）と法令ルールは、ここで中身を確かめる
  let appliedText: string | null = null;
  if (decision === "approve") {
    if (item.form === "legal_rule") {
      if (!toRule(item.rule)) return fail("法令ルールの形式が正しくありません（承認できません）");
    } else if (item.kind !== "nochange") {
      appliedText = String(fd.get("applied_text") ?? "").trim();
      if (!appliedText) return fail("反映する文が空です");
      if (appliedText.length > MAX_APPLIED_TEXT) return fail(`反映する文は${MAX_APPLIED_TEXT}文字までです`);
      if (checkGuardDict([appliedText], "general").length > 0) return fail("断定・最上級などの表現が含まれています。言い換えてください");
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
      ...(appliedText !== null ? { applied_text: appliedText } : {}),
    })
    .eq("id", id);
  if (error) return fail("保存に失敗しました");
  await sb.from("knowhow_log").insert({ item_id: id, action: decision, by_user: userId, note });
  revalidatePath("/admin/knowhow");
  // 同じ URL への redirect は画面が更新されないことがあるので、結果つきの別の URL へ送る（結果は画面の上に出す）
  redirect(`/admin/knowhow?${keep.toString()}${keep.size ? "&" : ""}done=${decision}&t=${Date.now()}`);
}
