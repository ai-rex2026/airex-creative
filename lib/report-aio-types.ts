/**
 * URLレポートの AIO（lib/report-aio.ts）の型と、評価の決定的な計算。
 * 画面側（クライアントコンポーネント）からも読むので、サーバー専用のモジュール（AI呼び出し）を import しない
 */

export type AioPromptResult = {
  text: string;
  /** recommend=おすすめ型 / issue=課題型 / select=選定・比較型 */
  kind: "recommend" | "issue" | "select";
  status: "pending" | "ok" | "error";
  error?: string;
  /** 回答に候補として挙がった会社・サービス名（掲載順） */
  listed?: string[];
  /** 自社が何番目に挙がったか（1始まり）。挙がっていなければ null */
  rank?: number | null;
  /** 回答の根拠として Google 検索から引かれたページ */
  cited?: { url: string; title: string; domain: string }[];
  /** 引用元に自社サイトのドメインが入ったか */
  ownCited?: boolean;
  queries?: string[];
  /** Google 検索を使った回答か。false=検索を使わずAIの知識だけで答えた（引用元は無い） */
  grounded?: boolean;
  answer?: string;
  model?: string;
  at?: string;
};

export type AioMeasure = { title: string; why: string; steps: string[]; impact: "大" | "中" | "小" };

export type ReportAio = {
  /** prompts=問いを作った（未実測あり） / measured=実測が終わった / done=施策まで書いた */
  stage: "prompts" | "measured" | "done";
  createdAt: string;
  /** 測らなかった理由（未登録ユーザー・Gemini未設定など）。あれば prompts は空 */
  skipped?: string | null;
  engine: "gemini";
  ownNames: string[];
  ownDomain: string;
  prompts: AioPromptResult[];
  /** 候補に挙がった問いの数 / 測れた問いの数 から決める */
  score?: "強" | "標準" | "弱" | null;
  basis?: string;
  findings?: string[];
  measures?: AioMeasure[];
  analysisError?: string | null;
};

/** 実測結果から評価を決める（決定的・AIなし） */
export function scoreAio(aio: ReportAio): { score: "強" | "標準" | "弱" | null; basis: string } {
  if (aio.skipped) return { score: null, basis: aio.skipped };
  const ok = aio.prompts.filter((p) => p.status === "ok");
  if (!ok.length) return { score: null, basis: "AIへの問い合わせに失敗したため、評価できませんでした" };
  const hit = ok.filter((p) => p.rank != null).length;
  const cited = ok.filter((p) => p.ownCited).length;
  const score = hit >= 2 ? "強" : hit === 1 || cited >= 1 ? "標準" : "弱";
  return {
    score,
    basis: `Geminiに${ok.length}問聞き、${hit}問で候補に挙がりました${cited ? `（自社サイトの引用 ${cited}問）` : ""}`,
  };
}

