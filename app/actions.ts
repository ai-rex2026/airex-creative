"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { newAnalysisId } from "@/lib/analysis";
import type { AnalysisMode, BudgetBand } from "@/lib/types";
import { processAnalysis } from "@/lib/worker";
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
export async function startAnalysis(input: {
  url?: string;
  text?: string;
  mode?: AnalysisMode;
  budget?: BudgetBand | null;
}) {
  assertKey();
  const mode: AnalysisMode = input.mode === "meo" ? "meo" : "report";
  if (mode === "meo" && !input.url) throw new Error("MEO分析にはサイトのURLが必要です");
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
    mode,
    budget: input.budget ?? null,
  });
  if (error) throw new Error(`分析を登録できませんでした: ${error.message}`);

  // 画面ではなくサーバー側で走らせる。ブラウザを閉じても止まらない
  after(async () => {
    try {
      await processAnalysis(id);
    } catch {
      // 取りこぼしは cron のワーカーが拾う
    }
  });

  redirect(`/analysis/${id}/waiting`);
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

/** Google 連携の状態。設定画面で出す */
export async function googleConnection() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return null;
  const { data } = await sb.from("google_connections").select("connected_at").eq("user_id", user.id).maybeSingle();
  return data ?? null;
}

export async function disconnectGoogle() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return;
  await sb.from("google_connections").delete().eq("user_id", user.id);
}

export async function signOut() {
  const sb = await createClient();
  await sb.auth.signOut();
}

export async function runLp(d: Diagnosis, copy: BannerCopy) {
  assertKey();
  return generateLp(d, copy);
}
