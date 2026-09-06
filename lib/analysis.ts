import type { SupabaseClient } from "@supabase/supabase-js";
import { diagnose } from "./diagnose";
import { generateCopies, scoreCopies } from "./copy";
import type { BannerCopy, Diagnosis } from "./types";

/** 本番と同じ見た目の短いID（英数20文字） */
export function newAnalysisId() {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const buf = new Uint8Array(20);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => chars[b % chars.length]).join("");
}

export type Analysis = {
  id: string;
  owner_id: string;
  url: string | null;
  input_text: string | null;
  status: "queued" | "running" | "done" | "failed";
  step: string;
  progress: number;
  error: string | null;
  diagnosis: Diagnosis | null;
  copies: BannerCopy[] | null;
  created_at: string;
};

/**
 * 1回の呼び出しで工程を1つだけ進める。
 * サーバーレスは1リクエストの実行時間に上限があるため、
 * 「全部やる」ではなく「1歩進めて返す」を繰り返す形にしている。
 */
export async function tick(sb: SupabaseClient, id: string): Promise<Analysis> {
  const { data, error } = await sb.from("analyses").select("*").eq("id", id).single();
  if (error || !data) throw new Error("分析が見つかりません");
  const a = data as Analysis;
  if (a.status === "done" || a.status === "failed") return a;

  const save = async (patch: Partial<Analysis>) => {
    const { data: up } = await sb.from("analyses").update(patch).eq("id", id).select("*").single();
    return (up ?? { ...a, ...patch }) as Analysis;
  };

  try {
    if (!a.diagnosis) {
      await save({ status: "running", step: "サイトを読んでいます", progress: 15 });
      const d = await diagnose({ url: a.url ?? undefined, text: a.input_text ?? undefined });
      return await save({ diagnosis: d, step: "訴求軸ごとにコピーを書いています", progress: 45 });
    }
    if (!a.copies) {
      const copies = await generateCopies(a.diagnosis, 2);
      return await save({ copies, step: "勝ち筋を採点しています", progress: 80 });
    }
    const scored = await scoreCopies(a.diagnosis, a.copies);
    return await save({ copies: scored, status: "done", step: "完了しました", progress: 100 });
  } catch (e) {
    return await save({
      status: "failed",
      step: "失敗しました",
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
