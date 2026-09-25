"use server";

import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasAnthropic } from "@/lib/anthropic";
import { processAnalysis } from "@/lib/worker";
import { generateSnsPlan } from "@/lib/sns-plan";
import { generateNegatives, type OutreachPlan, type SuggestScan } from "@/lib/outreach";
import { estimateKeywordVolumes, type KeywordPlan } from "@/lib/deep";
import type { Diagnosis } from "@/lib/types";
import type { SocialScan } from "@/lib/social";

/**
 * 以前に作ったレポートへ、後から増えた項目を足す（作り直さずに、無い部分だけ作る）。
 * - SNSオーガニック運用・SNSキャンペーン企画（sns_plan）
 * - ネガティブ対策（outreach.negatives）
 * - 対策キーワードの月間検索数の推定（keywords.rows[].volume）
 */

async function ownedRow(id: string, columns: string) {
  if (!hasAnthropic()) throw new Error("ANTHROPIC_API_KEY が未設定です");
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) throw new Error("ログインが必要です");
  const { data } = await sb.from("analyses").select(columns).eq("id", id).eq("owner_id", user.id).maybeSingle();
  if (!data) throw new Error("この分析を編集する権限がありません");
  return { sb, user, row: data as unknown as Record<string, unknown> };
}

/** 足りない項目の一覧。画面の「新しい項目を追加」ボタンの出し分けに使う */
export async function missingSections(id: string): Promise<string[]> {
  const { row } = await ownedRow(id, "status, diagnosis, sns_plan, outreach, keywords");
  if (row.status !== "done" || !row.diagnosis) return [];
  const out: string[] = [];
  if (!row.sns_plan) out.push("SNSオーガニック運用・SNSキャンペーン企画");
  const o = row.outreach as OutreachPlan | null;
  if (o && !o.negatives) out.push("ネガティブ対策");
  const k = row.keywords as KeywordPlan | null;
  if (k && k.rows.length > 0 && k.rows.every((r) => r.volume === undefined)) out.push("月間検索数の推定");
  return out;
}

/** 足りない項目を作る。AI を数回呼ぶので、応答を返したあとに走らせる */
export async function addMissingSections(id: string) {
  const { row } = await ownedRow(id, "status, diagnosis, social, sns_plan, outreach, suggests, keywords");
  if (row.status !== "done" || !row.diagnosis) throw new Error("レポートが完成してから追加できます");
  const d = row.diagnosis as Diagnosis;

  after(async () => {
    // 本人の確認は済んでいるので、書き込みは service role で行う（after の中ではセッションが切れていることがある）
    // 失敗した項目は保存しない（保存すると「追加する」が出なくなり、やり直せなくなるため）
    const admin = createAdminClient();
    const patch: Record<string, unknown> = {};
    const tasks: Promise<void>[] = [];
    if (!row.sns_plan) {
      tasks.push(
        generateSnsPlan(d, (row.social as SocialScan | null) ?? null)
          .then((p) => {
            if (p.channels.length || p.campaign) patch.sns_plan = p;
          })
          .catch(() => undefined)
      );
    }
    const o = row.outreach as OutreachPlan | null;
    if (o && !o.negatives) {
      tasks.push(
        generateNegatives(d, (row.suggests as SuggestScan | null) ?? null)
          .then((negatives) => {
            if (negatives.length) patch.outreach = { ...o, negatives };
          })
          .catch(() => undefined)
      );
    }
    const k = row.keywords as KeywordPlan | null;
    if (k && k.rows.length > 0 && k.rows.every((r) => r.volume === undefined)) {
      tasks.push(
        estimateKeywordVolumes(d, k.rows)
          .then((rows) => {
            if (rows.some((r) => r.volume)) patch.keywords = { ...k, rows };
          })
          .catch(() => undefined)
      );
    }
    await Promise.all(tasks);
    if (Object.keys(patch).length) await admin.from("analyses").update(patch).eq("id", id);
  });
}

/**
 * 広告手法一覧と広告運用設計を、いまの形式（全媒体のキャンペーン・広告グループ構成、P-MAX を含む）で作り直す。
 * 予算はそのまま使う。作り直しの間はレポートが待機画面になる。
 */
export async function rebuildAdPlan(id: string) {
  const { sb, user } = await ownedRow(id, "id");
  const { error } = await sb
    .from("analyses")
    .update({ media_plan: null, ad_ops: null, status: "queued", step: "広告手法を選び直しています", progress: 50 })
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
