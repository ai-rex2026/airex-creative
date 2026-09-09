"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { newAnalysisId, type Analysis } from "@/lib/analysis";
import { askAboutReport } from "@/lib/chat";
import { generateMeasures, type Measure } from "@/lib/measures";
import { generateRunbook } from "@/lib/runbook";
import type { AnalysisMode, BudgetBand } from "@/lib/types";
import type { PriceScan } from "@/lib/pricing";
import { processAnalysis } from "@/lib/worker";
import { generateLp } from "@/lib/lp";
import { hasAnthropic } from "@/lib/anthropic";
import type { BannerCopy, Diagnosis, GuardHit } from "@/lib/types";

function assertKey() {
  if (!hasAnthropic()) throw new Error("ANTHROPIC_API_KEY が未設定です");
}

/**
 * 入力された URL を整える。
 *
 * 「medicalbrows.jp」のようにスキーム無しで入れる人が多く、
 * そのまま fetch すると「Failed to parse URL」で分析ごと落ちていた。
 * 入力の癖をこちらで吸収する。
 */
function normalizeUrl(raw: string | undefined): string | undefined {
  const v = raw?.trim();
  if (!v) return undefined;
  const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v.replace(/^\/+/, "")}`;
  try {
    const u = new URL(withScheme);
    if (!u.hostname.includes(".")) throw new Error("host");
    return u.toString();
  } catch {
    throw new Error(`URLとして読めませんでした：${v}`);
  }
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
  let url: string | undefined;
  try {
    url = normalizeUrl(input.url);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "URLとして読めませんでした" };
  }
  if (mode === "meo" && !url) return { error: "MEO分析にはサイトのURLが必要です" };
  if (!url && !input.text) return { error: "URL か 商品説明のどちらかを入れてください" };

  const sb = await createClient();
  let {
    data: { user },
  } = await sb.auth.getUser();

  if (!user) {
    const { data, error } = await sb.auth.signInAnonymously();
    if (error || !data.user) return { error: "一時アカウントを作成できませんでした" };
    user = data.user;
  }

  const id = newAnalysisId();
  const row = {
    id,
    url: url ?? null,
    input_text: input.text ?? null,
    mode,
    budget: input.budget ?? null,
  };

  let { error } = await sb.from("analyses").insert({ ...row, owner_id: user.id });

  // 前に作ったゲストのセッションが期限切れだと、画面上はログイン済みに見えるのに
  // 書き込みだけ弾かれる。作り直して1回だけやり直す
  if (error) {
    const { data: re } = await sb.auth.signInAnonymously();
    if (re?.user) {
      user = re.user;
      ({ error } = await sb.from("analyses").insert({ ...row, owner_id: re.user.id }));
    }
  }
  // 本番では throw したエラー本文が伏せられて画面に出ないので、値で返す
  if (error) return { error: `分析を登録できませんでした：${error.message}` };

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

/**
 * 失敗した分析をやり直す。
 * 途中まで保存できている工程はそのまま使い、止まったところから続ける。
 * 失敗のたびに最初からやり直すと、費用も待ち時間も二重にかかる。
 */
export async function retryAnalysis(id: string) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) throw new Error("ログインが必要です");

  const { data, error } = await sb
    .from("analyses")
    .update({ status: "queued", step: "順番待ちです", error: null })
    .eq("id", id)
    .eq("owner_id", user.id)
    .select("id");
  if (error || !data || data.length === 0) throw new Error("やり直せませんでした");

  after(async () => {
    try {
      await processAnalysis(id);
    } catch {
      // 取りこぼしは cron のワーカーが拾う
    }
  });
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

  await updateOwned(sb, id, user.id, { budget }, "予算を保存できませんでした");
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

/** 粗利率。損益分岐CPAの計算に使う。断定できない数字なので画面で変えられるようにする */
export async function setMargin(id: string, margin: number) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) throw new Error("ログインが必要です");
  const m = Math.min(Math.max(margin, 0.05), 0.95);
  await updateOwned(sb, id, user.id, { margin: m });
}

/**
 * 行を更新する。RLSで弾かれても Supabase はエラーを返さず0行更新で成功に見えるので、
 * 更新できた行を数えて確かめる。ここを黙って通すと、画面は保存済みに見えるのに
 * DBには何も入っていない状態になる。
 */
async function updateOwned(
  sb: Awaited<ReturnType<typeof createClient>>,
  id: string,
  ownerId: string,
  patch: Record<string, unknown>,
  label = "保存できませんでした"
) {
  const { data, error } = await sb
    .from("analyses")
    .update(patch)
    .eq("id", id)
    .eq("owner_id", ownerId)
    .select("id");
  if (error) throw new Error(label);
  if (!data || data.length === 0) throw new Error(`${label}（この分析を編集する権限がありません）`);
}

/**
 * 損益分岐CPAの土台にする「主力商材」を選び直す。
 * 自動で拾った価格が一番高いものになることがあり、そのままだと
 * 出せるCPAを過大に見積もることになる。
 */
export async function setMainPrice(id: string, item: { name: string; yen: number } | null) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) throw new Error("ログインが必要です");

  const { data } = await sb.from("analyses").select("pricing").eq("id", id).eq("owner_id", user.id).single();
  if (!data?.pricing) throw new Error("価格の情報がありません");
  const cur = data.pricing as PriceScan;

  const next: PriceScan = item
    ? { ...cur, main: { name: item.name, yen: Math.max(1, Math.round(item.yen)) }, reason: `${cur.reason ?? ""}（主力商材は利用者が選び直しました）` }
    : { ...cur, main: cur.items[0] ?? null };

  await updateOwned(sb, id, user.id, { pricing: next });
  revalidatePath(`/analysis/${id}/report`);
  return next;
}

/** 追うKPIを選ぶ。複数選べる */
export async function selectKpis(id: string, selected: { id: string; name: string; custom?: boolean }[]) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) throw new Error("ログインが必要です");
  await updateOwned(sb, id, user.id, { kpi_selected: selected });
}

/**
 * 施策を作り直す。
 *
 * KPI を足したら全体に跳ね返す（足したぶんだけ継ぎ足すと、既存の施策が
 * 新しい KPI を踏まえていない状態のまま残る）。
 * 済みにした印は施策名で照合して引き継ぎ、拾えなかったものは記録に残す。
 */
export async function regenerateMeasures(id: string) {
  assertKey();
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) throw new Error("ログインが必要です");

  const { data } = await sb.from("analyses").select("*").eq("id", id).eq("owner_id", user.id).single();
  if (!data) throw new Error("分析が見つかりません");
  const a = data as Analysis;
  if (!a.diagnosis || !a.kpi) throw new Error("分析が完了していません");

  // 済みにした施策の名前。引き継ぎと、再提案の抑止に使う
  const doneIds = a.measures_done ?? [];
  const doneTitles = (a.measures ?? []).filter((m) => doneIds.includes(m.id)).map((m) => m.title);

  // 自由入力の KPI もツリーの候補として渡す
  const custom = (a.kpi_selected ?? []).filter((k) => k.custom);
  const kpi = {
    ...a.kpi,
    candidates: [
      ...a.kpi.candidates,
      ...custom.map((k) => ({
        id: k.id,
        name: k.name,
        node: "",
        why: "利用者が追加した指標",
        trackable: "連携が必要です" as const,
        how: "利用者の指定",
      })),
    ],
  };

  const plan = await generateMeasures(a.diagnosis, a.site, kpi, a.meo, a.pricing, a.extra_inputs ?? [], doneTitles, a.social);
  const items = (plan.items ?? []).map((m, i) => ({ ...m, id: `m${Date.now()}-${i}` }));

  // 名前が一致するものは済みのまま引き継ぐ
  const carried = items.filter((m) => doneTitles.includes(m.title)).map((m) => m.id);

  await updateOwned(sb, id, user.id, { measures: items, measures_done: carried });

  revalidatePath(`/analysis/${id}/report`);
  return { items, done: carried };
}

/**
 * 施策を済みにする／戻す。
 * 済みにした時点で記録に残す。施策を作り直しても記録は消えない。
 */
export async function toggleMeasure(id: string, measureId: string, done: boolean) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) throw new Error("ログインが必要です");

  const { data } = await sb
    .from("analyses")
    .select("measures, measures_done, measure_log")
    .eq("id", id)
    .eq("owner_id", user.id)
    .single();
  if (!data) throw new Error("分析が見つかりません");

  const cur: string[] = (data.measures_done as string[]) ?? [];
  const next = done ? [...new Set([...cur, measureId])] : cur.filter((x) => x !== measureId);

  const patch: Record<string, unknown> = { measures_done: next };
  if (done) {
    const m = ((data.measures as Measure[]) ?? []).find((x) => x.id === measureId);
    const log = ((data.measure_log as { title: string; at: string }[]) ?? []).filter((x) => x.title !== m?.title);
    if (m) patch.measure_log = [{ title: m.title, at: new Date().toISOString() }, ...log].slice(0, 200);
  }

  await updateOwned(sb, id, user.id, patch);
  return next;
}

/**
 * サイトから辿れない材料を足す。
 * 別ドメインのLPや、リンクしていないSNSは自動では見つけられない。
 * すでに実施している施策を重複して提案しないためにも要る。
 */
export async function addInput(id: string, platform: string, url: string) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) throw new Error("ログインが必要です");

  const v = url.trim();
  if (!v) throw new Error("URLかアカウント名を入れてください");
  if (v.length > 300) throw new Error("入力が長すぎます");

  const { data } = await sb.from("analyses").select("extra_inputs").eq("id", id).eq("owner_id", user.id).single();
  if (!data) throw new Error("分析が見つかりません");
  const cur = (data.extra_inputs as { platform: string; url: string }[]) ?? [];
  if (cur.some((x) => x.url === v)) return cur;

  const next = [...cur, { platform, url: v }];
  await updateOwned(sb, id, user.id, { extra_inputs: next });
  revalidatePath(`/analysis/${id}/report`);
  return next;
}

/**
 * 施策の実行プロンプトを作る。
 * 全施策ぶんを先に作ると費用が積み上がるので、使うときに1件だけ作る。
 */
export async function makeRunbook(id: string, measureId: string) {
  assertKey();
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) throw new Error("ログインが必要です");

  const { data } = await sb.from("analyses").select("*").eq("id", id).eq("owner_id", user.id).single();
  if (!data) throw new Error("分析が見つかりません");
  const a = data as Analysis;
  if (!a.diagnosis) throw new Error("分析が完了していません");

  const items = a.measures ?? [];
  const target = items.find((m) => m.id === measureId);
  if (!target) throw new Error("その施策は見つかりません");

  const runbook = await generateRunbook(a.diagnosis, a.site, target, a.pricing, a.meo);
  const next = items.map((m) => (m.id === measureId ? { ...m, runbook } : m));

  await updateOwned(sb, id, user.id, { measures: next });
  return runbook;
}
