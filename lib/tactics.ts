import { askJson } from "./anthropic";
import type { Diagnosis } from "./types";
import type { SiteScan } from "./site-scan";

/**
 * 広告以外の施策。SNS・LINE・LPO・SEO/MEO・PR まで、
 * 「誰が何をするか」で書かせる。プロセス語（体制構築・最適化推進 等）は禁止。
 */
export type Tactic = {
  area: string;
  summary: string;
  actions: string[];
  kpi: string;
};

export type SchedulePhase = {
  phase: string;
  period: string;
  items: string[];
};

export type TacticPlan = {
  items: Tactic[];
  schedule: SchedulePhase[];
  risks: string[];
};

export async function generateTactics(d: Diagnosis, site: SiteScan | null): Promise<TacticPlan> {
  return askJson<TacticPlan>(
    `あなたは広告運用と集客の実務者です。広告出稿**以外**の施策を設計します。

items は次の領域から、この商材に効くものだけを4〜6件。効かない領域は入れない。
  SNSオーガニック運用（Instagram / TikTok / X）／ LINE公式アカウント ／
  ランディングページ改善（LPO）／ SEO ／ MEO（Googleマップ）／ PR・サジェスト対策

守ること:
- actions は3件まで。**誰が何をするか**を具体で書く。「体制を構築する」「最適化を推進する」のような
  プロセス語は禁止。「週2本、症例写真＋価格を入れたリールを投稿する」のように書く
- kpi は1つ。数えられるものにする（例：保存数、指名検索数、来院予約数）
- schedule は3フェーズ（例：1〜2週目 / 1〜3ヶ月 / 3ヶ月以降）。items は各3件まで
- risks は3件まで。この商材で実際に起きうるものだけ（法令・炎上・人手・季節性など）`,
    `商材: ${d.product}
ターゲット: ${d.audience}
業種: ${d.industry}
強み: ${d.strengths.join(" / ")}
買わない理由: ${d.objections.join(" / ")}
${site ? `サイトの技術面: 構造化データ ${site.structuredData ? "有り" : "無し"} / sitemap ${site.sitemapXml ? "有り" : "無し"} / 内部リンク ${site.internalLinks}` : ""}

出力:
{"items":[{"area":"","summary":"","actions":["",""],"kpi":""}],
 "schedule":[{"phase":"","period":"","items":[""]}],
 "risks":[""]}`,
    { maxTokens: 4000 }
  );
}
