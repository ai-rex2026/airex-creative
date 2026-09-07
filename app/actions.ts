"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { newAnalysisId, type Analysis } from "@/lib/analysis";
import { askAboutReport } from "@/lib/chat";
import type { AnalysisMode, BudgetBand } from "@/lib/types";
import { processAnalysis } from "@/lib/worker";
import { generateLp } from "@/lib/lp";
import { hasAnthropic } from "@/lib/anthropic";
import type { BannerCopy, Diagnosis, GuardHit } from "@/lib/types";

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

/**
 * レポートを見たあとで予算を決める導線。
 * 配分%を実額に直すだけなら再生成は要らないので、保存して画面で計算する。
 */
export async function setBudget(id: string, budget: BudgetBand | null) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) throw new Error("ログインが必要です");

  const { error } = await sb.from("analyses").update({ budget }).eq("id", id).eq("owner_id", user.id);
  if (error) throw new Error("予算を保存できませんでした");
}

/**
 * その予算で媒体構成から作り直す。
 * 予算に対して媒体を広げすぎている場合の直し方で、AI の生成が走るので明示的に呼ばせる。
 */
export async function replanForBudget(id: string, budget: BudgetBand) {
  assertKey();
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) throw new Error("ログインが必要です");

  const { error } = await sb
    .from("analyses")
    .update({
      budget,
      media_plan: null,
      ad_ops: null,
      status: "queued",
      step: "広告手法を選び直しています",
      progress: 50,
    })
    .eq("id", id)
    .eq("owner_id", user.id);
  if (error) throw new Error("作り直しを登録できませんでした");

  after(async () => {
    try {
      await processAnalysis(id);
    } catch {
      // 取りこぼしは cron のワーカーが拾う
    }
  });
}

export type ChatEdit = { id: string; label?: string; before?: string; after?: string; reason?: string; ok: boolean };
export type ChatMsg = {
  role: "user" | "assistant";
  content: string;
  flags?: GuardHit[] | null;
  edits?: ChatEdit[] | null;
};

/** これまでのやり取り。レポートを開いたときに読む */
export async function loadChat(id: string): Promise<ChatMsg[]> {
  const sb = await createClient();
  const { data } = await sb
    .from("chat_messages")
    .select("role, content, flags, edits")
    .eq("analysis_id", id)
    .order("created_at", { ascending: true })
    .limit(60);
  return (data ?? []) as ChatMsg[];
}

/**
 * レポートについて質問する。
 * この段階ではレポートを書き換えない。読んで答えるだけ。
 */
export async function sendChat(id: string, question: string): Promise<ChatMsg> {
  assertKey();
  const q = question.trim();
  if (!q) throw new Error("質問を入力してください");
  if (q.length > 500) throw new Error("質問は500文字以内でお願いします");

  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) throw new Error("ログインが必要です");

  const { data: row } = await sb.from("analyses").select("*").eq("id", id).eq("owner_id", user.id).single();
  if (!row) throw new Error("分析が見つかりません");

  const history = (await loadChat(id)).map((m) => ({ role: m.role, content: m.content }));
  const ans = await askAboutReport(row as Analysis, history, q);

  // 書き換えが起きていれば、レポート本体と履歴の両方を更新する
  const applied = ans.edits.filter((e): e is Extract<typeof e, { ok: true }> => e.ok);
  if (Object.keys(ans.patch).length > 0) {
    await sb.from("analyses").update(ans.patch).eq("id", id).eq("owner_id", user.id);
    await sb.from("report_edits").insert(
      applied.map((e) => ({
        analysis_id: id,
        item_id: e.id,
        label: e.label,
        before_text: e.before,
        after_text: e.after,
      }))
    );
  }

  const edits: ChatEdit[] = ans.edits.map((e) =>
    e.ok
      ? { ok: true, id: e.id, label: e.label, before: e.before, after: e.after }
      : { ok: false, id: e.id, reason: e.reason }
  );

  await sb.from("chat_messages").insert([
    { analysis_id: id, role: "user", content: q },
    {
      analysis_id: id,
      role: "assistant",
      content: ans.text,
      flags: ans.flags.length ? ans.flags : null,
      edits: edits.length ? edits : null,
    },
  ]);

  if (applied.length > 0) revalidatePath(`/analysis/${id}/report`);

  return { role: "assistant", content: ans.text, flags: ans.flags, edits };
}

/** チャットで直した履歴。レポートに「AIチャットで修正」と出すために読む */
export async function loadEdits(id: string) {
  const sb = await createClient();
  const { data } = await sb
    .from("report_edits")
    .select("item_id, label, before_text, after_text, created_at")
    .eq("analysis_id", id)
    .order("created_at", { ascending: false })
    .limit(50);
  return data ?? [];
}
