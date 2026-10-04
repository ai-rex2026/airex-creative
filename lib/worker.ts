import { createAdminClient } from "./supabase/admin";
import { tick } from "./analysis";

/** 実行中とみなす猶予。これより古い更新は「止まっている」と判断して拾い直す */
// 広告運用設計のようにAIの1工程が2分を超えることがあるのに加え、ad_ops確定後の
// 9章まとめ並列生成フェーズ（social_competitors・tactics・sns_plan・kpi・lpo・keywords・
// line_plan・copies・suggests）は askJson() の1回目（最大150秒）＋JSON解析失敗時の
// 再試行（さらに最大150秒）が絡むと最悪ケースで約5分かかり得る。この間 updated_at は
// 更新されない（Promise.all完了後に1回だけ保存するため）ので、閾値が短すぎると
// 「まだ正常に動いている分析」を cron の安全網が二重に拾ってしまい、二重実行の片方が
// 失敗して status=failed を書いた直後にもう片方が成功してchapterデータだけ上書きする
// （= ほぼ完走しているのに failed のまま残る）レース条件を引き起こす。
// 並列フェーズの最悪ケース（約300秒）に安全マージンを持たせて、二重に走らせない長さにする
const STALE_MS = 400_000;

/** 自己継続（下記 triggerContinue）を許す最大回数。壊れて完了しない分析を延々と連打しないための安全弁 */
const MAX_CHAIN_ATTEMPTS = 6; // 240秒 x 6 ≈ 24分。それでも終わらなければ cron の安全網（processPending）に任せる

/**
 * 1バーストが時間切れになった直後に、cron の巡回（最大1分＋stale判定200秒）を待たず
 * 自分で次のバーストを呼び出す。
 *
 * Vercel の1回のサーバーレス実行には上限があるので、同じ関数の中でループし続けることはできない。
 * かわりに自分自身の API ルートに1本 fetch を投げて「次の実行」を新しく起動する。
 * 応答本体は待たず、送り出せたかどうかだけ短いタイムアウトで確認する（それ以上待つと
 * 呼び出し元の時間予算を圧迫するため）。
 *
 * VERCEL_URL が無い（ローカル開発など）場合は何もしない。cron の安全網がそのまま効く。
 */
async function triggerContinue(id: string, attempt: number) {
  if (attempt > MAX_CHAIN_ATTEMPTS) return;
  const host = process.env.VERCEL_URL;
  if (!host) return;
  const base = `https://${host}`;
  try {
    await fetch(`${base}/api/analysis/${id}/continue?attempt=${attempt}`, {
      method: "POST",
      headers: process.env.CRON_SECRET ? { authorization: `Bearer ${process.env.CRON_SECRET}` } : undefined,
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    // 送り出せなくても cron の安全網（processPending）が最後には拾う
  }
}

/**
 * 1件の分析を、完了するか時間切れになるまで進める。
 * 画面ではなくサーバー（after / cron / continue）から呼ぶ。
 *
 * 時間切れで終わるときは、cron の巡回を待たずに次のバーストを自分で起動する
 * （attempt は起動の連鎖回数。呼び出し元が付けなければ0＝新規の分析として数える）。
 */
// 2026-10-04: 以前は速度計測(PSI)専用に「次が速度計測の工程なら、このバーストの
// 2周目以降は試みずに次のバーストへ引き渡す」という個別チェック（DBを覗いて
// url/speed/statusを見る）を入れていた。これは速度計測というその1工程にしか効かず、
// 同じ理由でタイムアウトしうる他の工程（askJsonを呼ぶ9章並列生成フェーズなど。
// lib/anthropic.ts 参照）には適用されない個別対応だった。
//
// そこで一度「一定時間を超えて完了した工程の直後は常に次バーストへ引き渡す」という
// 工程名に依存しない一般ルールに置き換えたが、これは行き過ぎだった。askJson を呼ぶ
// 工程はほぼ全てこの閾値を超えるため、実質的に「ほぼ全工程の直後でバースト引き渡し」
// になり、引き渡し1回あたりのオーバーヘッド（自分へのfetch往復＋新しい関数の起動＋
// 分析行の再読込）が、工程数の多い分析（9章並列フェーズなど）で積み重なって
// 全体の処理時間を目に見えて伸ばしてしまう。
//
// 実際に守るべきなのは「このバーストの残り予算で、次に控えている工程が万一
// 最悪ケース（askJsonの初回+リトライで最大260秒、TOTAL_BUDGET_MS。
// lib/anthropic.ts 参照）を引いても、関数の実行上限（300秒）を超えない」ことだけ。
// 工程そのものの所要時間ではなく「残り予算がどれだけあるか」で判断すれば、
// 残り予算が十分にある間（＝ほとんどの場合）は工程をどれだけ重くても同じバーストで
// 連鎖させてよく、本当に残り予算が少なくなったときだけ次バーストに引き渡せばよい。
// これなら速度計測・AI生成・外部API呼び出しのどの工程にも同じ保護が効きつつ、
// 無駄な引き渡しを増やさず処理時間を最短化できる
const LOW_BUDGET_MS = 90_000; // 残りがこれを下回ったら、次の工程の最悪ケースを安全に試せない恐れがあるので次バーストへ渡す

export async function processAnalysis(id: string, budgetMs = 240_000, attempt = 0) {
  const sb = createAdminClient();
  const deadline = Date.now() + budgetMs;
  for (;;) {
    // deadline を tick に渡す（表示速度計測ステップが、このバーストに実際残っている
    // 時間を見て安全に試せる分だけ試すための保険。下の「残り予算が少なければ次バーストへ
    // 引き渡す」ルールで基本的には速度計測もフル予算の状態でしか実行されないはずだが、
    // 念のための二重の安全網）
    const a = await tick(sb, id, deadline);
    if (a.status === "done" || a.status === "failed") return a.status;
    if (Date.now() > deadline) {
      await triggerContinue(id, attempt + 1);
      return "timeout";
    }
    if (deadline - Date.now() < LOW_BUDGET_MS) {
      // このバーストの残り予算が少ない。次の工程がAI生成などの重い処理だった場合、
      // 最悪ケースの時間を使うと関数の実行上限を超えかねないので、ここで次の
      // バースト（満額の時間予算を持つ）に引き渡す。残り予算が十分なうちは
      // ここに来ないので、通常の分析では工程がそのまま同じバーストで連鎖する
      await triggerContinue(id, attempt + 1);
      return "handoff";
    }
  }
}

/**
 * 止まっている分析を拾って進める。cron から呼ぶ安全網。
 *
 * 拾う部分は claim_pending_analyses（Postgres関数。FOR UPDATE SKIP LOCKED で
 * 原子的に行をロック＆updated_atをtouchしてから返す）を使う。cron は毎分発火するが
 * 1回の実行は最大300秒かかりうるため、前回の実行がまだ終わっていないうちに
 * 次のcronが同じ「stale」判定の行を拾ってしまうことがある（continueチェーンとの
 * 重複も同様）。単純なSELECTだけだと、拾った直後にApifyなどの高コストな外部呼び出しを
 * 始める前に別プロセスが同じidを拾い直し、同じ分析に対して何重にもApify Actorを
 * 起動してクレジットを溶かす事故になる（2026-10-03に実際に発生）。
 * この関数はSELECTと同時にupdated_atを更新するので、一度拾われた行は他プロセスの
 * 次回staleチェックに引っかからなくなり、二重処理を防げる。
 */
export async function processPending(limit = 3, budgetMs = 240_000) {
  const sb = createAdminClient();
  const staleBefore = new Date(Date.now() - STALE_MS).toISOString();
  const { data } = await sb.rpc("claim_pending_analyses", {
    p_limit: limit,
    p_stale_before: staleBefore,
  });

  const ids = (data ?? []) as string[];
  const deadline = Date.now() + budgetMs;
  const done: string[] = [];
  for (const id of ids) {
    if (Date.now() > deadline) break;
    await processAnalysis(id, deadline - Date.now());
    done.push(id);
  }
  return { picked: ids, processed: done };
}
