import { askJson } from "./anthropic";
import { checkGuard } from "./guardrail";
import type { Diagnosis, GuardHit } from "./types";
import type { AdAccountPerf, AdCampaignRow, AdPerfCollection } from "./ads/performance";

/**
 * 広告の実績分析（レポートの「広告の実績分析」欄と、カテゴリ別評価の「広告」）。2026-10-06 新設。
 *
 * 分析の開始時点で、利用者が連携して選んだ広告アカウントの直近30日の実績を読み（lib/ads/performance.ts）、
 * その数字だけを材料にAIが評価・所見・施策案を書く。流れは2段階で、どちらも終わった時点で保存する
 * （lib/analysis.ts）：
 *   1. 実績の取得 → status と accounts を保存（analyzed: false）
 *   2. AIの分析 → score・basis・findings・measures を足して保存（analyzed: true）
 * 2で失敗しても1の実績は残り、次の回は2だけをやり直す。AIの呼び出しは1回。
 * 出稿・入札・予算の変更はしない（読み取りと提案のみ。AGENTS.md）。
 */

export type AdReviewMeasure = {
  title: string;
  /** なぜそう考えるか（実績の数字を引用） */
  why: string;
  steps: string[];
  impact: "大" | "中" | "小";
  flags?: { text: string; law: string; reason: string; suggestion: string }[];
};

export type AdTotals = {
  cost: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionsValue: number;
};

export type AdReview = {
  /**
   * ok：実績を読めた（分析の対象がある） / none：広告アカウントを連携していない /
   * noselection：連携しているが分析するアカウントを選んでいない / error：選んだアカウントの実績をどれも読めなかった
   */
  status: "ok" | "none" | "noselection" | "error";
  period: { from: string; to: string };
  /** 連携している媒体の名前 */
  connected: string[];
  accounts: AdAccountPerf[];
  /** AIの分析まで終わったか */
  analyzed: boolean;
  score?: "強" | "標準" | "弱" | null;
  basis?: string;
  findings?: string[];
  measures?: AdReviewMeasure[];
  /** AIの分析に失敗したときの理由（実績の表は出す） */
  analysisError?: string;
};

/** 分析の期間（直近30日。今日を含まない＝前日まで。当日分はまだ集計中のことが多いため） */
export function adReviewPeriod(now = new Date()): { from: string; to: string } {
  const jst = new Date(now.getTime() + 9 * 3600_000);
  const to = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate() - 1));
  const from = new Date(to.getTime() - 29 * 86_400_000);
  const f = (d: Date) => d.toISOString().slice(0, 10);
  return { from: f(from), to: f(to) };
}

export function totalsOf(rows: AdCampaignRow[]): AdTotals {
  return rows.reduce(
    (a, c) => ({
      cost: a.cost + (c.cost || 0),
      impressions: a.impressions + (c.impressions || 0),
      clicks: a.clicks + (c.clicks || 0),
      conversions: a.conversions + (c.conversions || 0),
      conversionsValue: a.conversionsValue + (c.conversionsValue || 0),
    }),
    { cost: 0, impressions: 0, clicks: 0, conversions: 0, conversionsValue: 0 }
  );
}

/** 保存しすぎないよう、1アカウントあたり費用の多い順に上位だけ残す */
const MAX_CAMPAIGNS = 30;

/** 取得した実績から、AI分析の前の状態（工程1）を作る */
export function reviewFromCollection(c: AdPerfCollection, period: { from: string; to: string }, names: Record<string, string>): AdReview {
  const connected = c.connected.map((p) => names[p] ?? p);
  const accounts = c.accounts.map((a) => ({
    ...a,
    campaigns: [...a.campaigns].sort((x, y) => y.cost - x.cost).slice(0, MAX_CAMPAIGNS),
  }));
  const status: AdReview["status"] =
    c.connected.length === 0
      ? "none"
      : accounts.length === 0
        ? "noselection"
        : accounts.some((a) => !a.error)
          ? "ok"
          : "error";
  return { status, period, connected, accounts, analyzed: status !== "ok" };
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const yen = (n: number) => `${Math.round(n).toLocaleString("ja-JP")}円`;

/** AIに渡す実績の表（数字は計算済みのものを渡し、AIに計算させない） */
function factsOf(rv: AdReview): string {
  const lines: string[] = [];
  for (const a of rv.accounts) {
    if (a.error) {
      lines.push(`■ ${a.platformName}「${a.accountName}」：実績を取得できませんでした`);
      continue;
    }
    const t = totalsOf(a.campaigns);
    lines.push(
      `■ ${a.platformName}「${a.accountName}」合計：費用 ${yen(t.cost)}／表示 ${t.impressions}／クリック ${t.clicks}` +
        `／CTR ${t.impressions ? r1((t.clicks / t.impressions) * 100) : "—"}%／CV ${r1(t.conversions)}` +
        `／CVR ${t.clicks ? r1((t.conversions / t.clicks) * 100) : "—"}%／CPA ${t.conversions ? yen(t.cost / t.conversions) : "—"}` +
        `／CV値 ${yen(t.conversionsValue)}／ROAS ${t.cost && t.conversionsValue ? `${Math.round((t.conversionsValue / t.cost) * 100)}%` : "—"}`
    );
    for (const c of a.campaigns.slice(0, 15)) {
      lines.push(
        `  - ${c.name}${c.status ? `（${c.status}）` : ""}：費用 ${yen(c.cost)}／表示 ${c.impressions}／クリック ${c.clicks}` +
          `／CTR ${c.impressions ? r1((c.clicks / c.impressions) * 100) : "—"}%／CV ${r1(c.conversions)}` +
          `／CPA ${c.conversions ? yen(c.cost / c.conversions) : "—"}`
      );
    }
  }
  return lines.join("\n");
}

type AiOut = {
  score: "強" | "標準" | "弱" | null;
  basis: string;
  findings: string[];
  measures: { title: string; why: string; steps: string[]; impact: "大" | "中" | "小" }[];
};

/** 工程2：AIで評価・所見・施策案を書く。失敗したら analysisError を付けて返す（実績は残す） */
export async function analyzeAdReview(rv: AdReview, d: Diagnosis, margin: number | null): Promise<AdReview> {
  if (rv.status !== "ok") return { ...rv, analyzed: true };
  try {
    const out = await askJson<AiOut>(
      `あなたは運用型広告の実務者です。渡された広告アカウントの実績（直近30日）だけを材料に、評価・所見・施策案を書きます。

守ること:
- 数字は渡された実績の表にあるものだけを引用する。表に無い数字（業界平均・改善率の見込みなど）は書かない
- 効果や結果を断定しない。「必ず」「確実に」「保証」「最も」は使わない
- 出稿・入札・予算の変更を自動で行う前提にしない。人が管理画面で行う手順として書く
- score は、この業種・商材で想定される成果に照らして「強」「標準」「弱」のいずれか。
  費用が少なすぎる・CVの計測が無い（CVがすべて0でクリックはある）など、良し悪しを判断できないときは null
- basis は評価の根拠を1〜2文（60字以内目安）。必ず数字を1つ以上引用する
- findings は所見を3〜5件。「何が起きているか」を数字とキャンペーン名を引用して書く
- measures は施策案を3〜6件。title は「何をするか」を動詞で書く（「〜の検討」「〜の強化」は禁止）。
  why は数字を引用した理由、steps は3〜5手順（誰がどの画面で何をするか）、impact は 大／中／小
- CVが0なのにクリックがある場合は、まずCVの計測が正しく設定されているかの確認を施策に入れる`,
      `【事業】${d.product}（対象：${d.audience}／業種：${d.industry}）
${margin ? `【1件あたりの粗利の目安】${yen(margin)}（許容CPAの判断に使ってよい）\n` : ""}【期間】${rv.period.from}〜${rv.period.to}
【実績】
${factsOf(rv)}

出力:
{"score":"標準","basis":"","findings":[""],"measures":[{"title":"","why":"","steps":[""],"impact":"中"}]}`,
      { maxTokens: 4000 }
    );
    const measures = (out.measures ?? []).filter((m) => m && typeof m.title === "string" && m.title.trim()).slice(0, 6);
    // 法令チェックは生成と同時に通す（AGENTS.md）
    let hits: GuardHit[] = [];
    try {
      const texts = measures.flatMap((m) => [m.title, m.why, ...(m.steps ?? [])]);
      hits = (await checkGuard(texts, d.industry)).hits.filter((h) => h.severity !== "low");
    } catch {
      // 検査できなくても施策は出す
    }
    const flagged = measures.map((m) => {
      const own = hits.filter((h) => [m.title, m.why, ...(m.steps ?? [])].some((t) => t?.includes(h.text)));
      return own.length ? { ...m, flags: own.map((h) => ({ text: h.text, law: h.law, reason: h.reason, suggestion: h.suggestion })) } : m;
    });
    const score = out.score === "強" || out.score === "標準" || out.score === "弱" ? out.score : null;
    return {
      ...rv,
      analyzed: true,
      score,
      basis: typeof out.basis === "string" ? out.basis : "",
      findings: (out.findings ?? []).filter((x) => typeof x === "string" && x.trim()).slice(0, 5),
      measures: flagged,
    };
  } catch (e) {
    return { ...rv, analyzed: true, score: null, analysisError: e instanceof Error ? e.message : String(e) };
  }
}
