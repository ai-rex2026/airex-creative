import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * アフィリエイト運用の AI 利用料。
 * 単価は変わるので、記録時点でトークン数を金額に変換して aff_usage に凍結する。
 */

/** 100万トークンあたりの単価（USD） */
const PRICES: Record<string, { in: number; out: number }> = {
  "claude-opus-5": { in: 5, out: 25 },
  "claude-opus-4-8": { in: 5, out: 25 },
  "claude-sonnet-5": { in: 3, out: 15 },
  "claude-sonnet-4-6": { in: 3, out: 15 },
  "claude-sonnet-4-5": { in: 3, out: 15 },
  "claude-haiku-4-5": { in: 1, out: 5 },
};
/** 単価表にないモデルは Sonnet 相当で見積もる（実際より安く見えるより高く見えるほうが安全） */
const FALLBACK = { in: 3, out: 15 };
/** Web検索ツールは1検索あたりの従量（トークンとは別建て） */
const WEB_SEARCH_USD_PER_CALL = 0.01;
/** 円換算レート。請求は USD なので画面表示のための目安 */
export const USD_JPY = Number(process.env.USD_JPY) || 155;

export function usdFor(model: string, inputTokens: number, outputTokens: number, webSearches = 0): number {
  const p = PRICES[model] ?? FALLBACK;
  return (inputTokens / 1e6) * p.in + (outputTokens / 1e6) * p.out + webSearches * WEB_SEARCH_USD_PER_CALL;
}

/** 金額の表示。数円単位なので小数1桁まで出す */
export function fmtYen(usd: number): string {
  const v = usd * USD_JPY;
  if (v === 0) return "0円";
  if (v < 10) return `${v.toFixed(1)}円`;
  return `${Math.round(v).toLocaleString("ja-JP")}円`;
}

export type UsageKind = "collect_search" | "collect_judge" | "enrich" | "campaign_draft" | "kw_suggest";

export const USAGE_KIND_LABEL: Record<UsageKind, string> = {
  collect_search: "収集：検索",
  collect_judge: "収集：ランキング判定",
  enrich: "記事本文の読取",
  campaign_draft: "案件ドラフト作成",
  kw_suggest: "KW候補の提案",
};

export type MeterInput = { model: string; input_tokens: number; output_tokens: number; web_searches?: number };

/**
 * askJson の meter に渡す関数を作る。1回の呼び出しにつき aff_usage へ1行積む。
 * 記録の失敗で本体の処理を落としたくないので、握りつぶして続行する。
 */
export function meterTo(sb: SupabaseClient, scope: { userId: string; kind: UsageKind; campaignId?: string | null; keywordId?: string | null }) {
  return async (u: MeterInput) => {
    try {
      await sb.from("aff_usage").insert({
        user_id: scope.userId,
        campaign_id: scope.campaignId ?? null,
        keyword_id: scope.keywordId ?? null,
        kind: scope.kind,
        model: u.model,
        input_tokens: u.input_tokens,
        output_tokens: u.output_tokens,
        web_searches: u.web_searches ?? 0,
        cost_usd: usdFor(u.model, u.input_tokens, u.output_tokens, u.web_searches ?? 0),
      });
    } catch {
      // 計測は補助情報。記録できなくても処理は続ける
    }
  };
}
