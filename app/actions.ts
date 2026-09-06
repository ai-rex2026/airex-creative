"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { newAnalysisId } from "@/lib/analysis";
import { generateLp } from "@/lib/lp";
import { hasAnthropic } from "@/lib/anthropic";
import type { BannerCopy, Diagnosis } from "@/lib/types";

function assertKey() {
  if (!hasAnthropic()) throw new Error("ANTHROPIC_API_KEY が未設定です");
}

/**
 * 分析を積む。アカウントが無ければ一時アカウント（匿名サインイン）を作って、
 * その持ち物として登録する。あとで本登録すると同じIDのまま引き継がれる。
 */
export async function startAnalysis(input: { url?: string; text?: string }) {
  assertKey();
  if (!input.url && !input.text) throw new Error("URL か 商品説明のどちらかを入れてください");

  const sb = await createClient();
  let {
    data: { user },
  } = await sb.auth.getUser();

  if (!user) {
    const { data, error } = await sb.auth.signInAnonymously();
    if (error || !data.user) throw new Error("一時アカウントを作成できませんでした");
    user = data.user;
  }

  const id = newAnalysisId();
  const { error } = await sb.from("analyses").insert({
    id,
    owner_id: user.id,
    url: input.url ?? null,
    input_text: input.text ?? null,
  });
  if (error) throw new Error(`分析を登録できませんでした: ${error.message}`);

  redirect(`/analysis/${id}`);
}

/** 本登録。匿名のまま作った分析は uid が変わらないのでそのまま引き継がれる */
export async function signUp(email: string, password: string) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();

  if (user?.is_anonymous) {
    const { error } = await sb.auth.updateUser({ email, password });
    if (error) throw new Error(error.message);
    return;
  }
  const { error } = await sb.auth.signUp({ email, password });
  if (error) throw new Error(error.message);
}

export async function signIn(email: string, password: string) {
  const sb = await createClient();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error("メールアドレスかパスワードが違います");
}

export async function signOut() {
  const sb = await createClient();
  await sb.auth.signOut();
}

export async function runLp(d: Diagnosis, copy: BannerCopy) {
  assertKey();
  return generateLp(d, copy);
}
