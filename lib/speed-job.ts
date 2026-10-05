import { createAdminClient } from "./supabase/admin";
import { scanSpeed, type SpeedScan } from "./pagespeed";

/**
 * 表示速度の専用の計測。分析の工程とは別の関数で、分析の開始直後から並行して測る。
 *
 * 2026-10-05: 以前は分析の工程の中で測っていたため、1回の計測に使える時間が
 * そのバーストの残り時間（他の工程と分け合う）に縛られ、重いページ（medicalbrows.jp など）で
 * 3回とも時間切れになり「表示速度を測定できませんでした」で終わる回があった。
 * 専用の関数なら1回あたり5分弱を丸ごと使え、失敗しても自分で次の回を起動して
 * 最大 MAX_ROUNDS 回（約20分）まで測り直せる。分析の工程側は、この計測が動いている間は
 * 自分では測らず、結果を待つ（lib/analysis.ts）。
 */

/** 計測を何回まで繰り返すか。1回あたり最長 ROUND_MS */
const MAX_ROUNDS = 4;
const ROUND_MS = 270_000;

/** スコアまで測れているか（「測定中」の印には score が無いことがあるので、数値かどうかで見る） */
const hasScore = (s: SpeedScan | null | undefined): boolean => typeof s?.score === "number";

/** 次の回（または最初の回）を、専用のエンドポイントで起動する。待たずに戻る */
export async function kickSpeed(id: string, round = 1): Promise<boolean> {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (!host) return false;
  try {
    await fetch(`https://${host}/api/analysis/${id}/speed?round=${round}`, {
      method: "POST",
      headers: process.env.CRON_SECRET ? { authorization: `Bearer ${process.env.CRON_SECRET}` } : undefined,
      // 起動の要求が届けばよい。計測の完了は待たない
      signal: AbortSignal.timeout(5_000),
    });
    return true;
  } catch (e) {
    // 5秒で打ち切った（＝要求は届いて計測が走っている）場合も true として扱う
    return e instanceof Error && e.name === "TimeoutError";
  }
}

/** 計測1回分。成功していない限り、次の回を起動する */
export async function runSpeedRound(id: string, round: number): Promise<SpeedScan | null> {
  const sb = createAdminClient();
  const { data } = await sb.from("analyses").select("url, mode, speed, status").eq("id", id).maybeSingle();
  if (!data?.url || data.mode === "meo") return null;
  const cur = (data.speed ?? null) as SpeedScan | null;
  // 既に測れているなら何もしない（二重に起動された場合など）
  if (cur && hasScore(cur)) return cur;

  // 動いている印を更新する（分析の工程側が「止まっている」と判断しないように）
  await sb
    .from("analyses")
    .update({ speed: { ...(cur ?? {}), measuring: true, startedAt: new Date().toISOString(), retryable: true } })
    .eq("id", id);

  const prevAttempts = cur?.attempts ?? 0;
  const res = await scanSpeed(data.url as string, ROUND_MS, prevAttempts);
  const last = round >= MAX_ROUNDS || hasScore(res) || res.retryable !== true;

  // 保存の直前に読み直し、他で測れた結果を上書きしない
  const { data: again } = await sb.from("analyses").select("speed").eq("id", id).maybeSingle();
  const now = (again?.speed ?? null) as SpeedScan | null;
  if (now && hasScore(now)) return now;

  const toSave: SpeedScan = {
    ...res,
    // まだ次の回があるなら「測定中」のまま残す。最後の回なら確定させる（以後は再試行しない）
    measuring: !last,
    startedAt: new Date().toISOString(),
    retryable: last ? false : res.retryable,
  };
  await sb.from("analyses").update({ speed: toSave }).eq("id", id);
  if (!last) {
    const ok = await kickSpeed(id, round + 1);
    if (!ok) await sb.from("analyses").update({ speed: { ...toSave, measuring: false, retryable: true } }).eq("id", id);
  }
  return toSave;
}
