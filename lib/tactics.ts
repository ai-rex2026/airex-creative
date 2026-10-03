import { askJson } from "./anthropic";
import type { Diagnosis } from "./types";
import type { SiteScan } from "./site-scan";
import { socialFacts, type SocialScan } from "./social";
import type { AdOps } from "./ad-ops";

/**
 * 広告以外の施策。SNS・LINE・LPO・SEO/MEO・PR まで、
 * 「誰が何をするか」で書かせる。プロセス語（体制構築・最適化推進 等）は禁止。
 *
 * 運用中のSNS（YouTube・Xなど）が実測できている場合は、その数値を土台にする。
 * 実測が無いまま「SNSを強化する」だけを書くと、すでに動いている数字を無視した
 * 一般論になってしまう（フォロワー数・投稿数が取れているのに使わないのは勿体ない）。
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

/**
 * スケジュール（実行スケジュール章）に広告出稿の動きも織り込むための要約。
 * ad_ops はこの関数が呼ばれる時点では確定済み（lib/analysis.ts の呼び出し順序を参照）なので、
 * 媒体名・役割・予算をそのまま schedule の item に引用させる
 */
function adOpsFacts(ops: AdOps | null): string {
  if (!ops || !ops.done || ops.campaigns.length === 0) return "";
  return ops.campaigns
    .map((c) => `- ${c.channel}「${c.name}」${c.purpose ? `（${c.purpose}）` : ""}${c.budget ? ` 予算目安${c.budget}` : ""}`)
    .join("\n");
}

export async function generateTactics(
  d: Diagnosis,
  site: SiteScan | null,
  social: SocialScan | null = null,
  adOps: AdOps | null = null
): Promise<TacticPlan> {
  const sns = socialFacts(social);
  const ads = adOpsFacts(adOps);
  return askJson<TacticPlan>(
    `あなたは広告運用と集客の実務者です。広告出稿**以外**の施策を設計します。

items は次の領域から、この商材に効くものだけを4〜6件。効かない領域は入れない。
  SNSオーガニック運用（Instagram / TikTok / X / YouTube）／ LINE公式アカウント ／
  ランディングページ改善（LPO）／ SEO ／ MEO（Googleマップ）／ PR・サジェスト対策

守ること:
- actions は3件まで。**誰が何をするか**を具体で書く。「体制を構築する」「最適化を推進する」のような
  プロセス語は禁止。「週2本、症例写真＋価格を入れたリールを投稿する」のように書く
- kpi は1つ。数えられるものにする（例：保存数、指名検索数、来院予約数）
- schedule は実際に手を動かす順番の一覧。5〜6フェーズ（例：出稿準備中 / 1〜2週目 / 1ヶ月目 /
  2〜3ヶ月目 / 4〜6ヶ月目 / それ以降）に分け、**items は各フェーズ3〜6件**（薄いフェーズで妥協しない）。
  **各 item は「誰が・何を・どこに対して」を含む具体的な単一アクションにする。**
  上の items（area/summary/actions）やカテゴリ名をそのまま言い換えただけの抽象的な一文は禁止。
  この商材・サイト・SNS・広告出稿の実際の事実（渡される d / site / social / 広告の情報）を
  根拠や対象として引用する。
  悪い例：「SEO対策を進める」「SNS運用を強化する」「広告を運用する」
  良い例：「『${d.product}』の instagram プロフィールに、価格と所在地を記載したハイライトを追加する」
${ads ? "- 広告出稿も必ずスケジュールに乗せる。下に渡す実際のキャンペーン名・媒体・予算を使い、「いつ入稿するか」「いつ最初の指標（CPA/CTR等）を見て調整するか」「いつ予算配分を見直すか」を、各媒体・各キャンペーンについて具体的なitemとして書く（出稿準備フェーズで完結させない。初動確認・調整のタイミングも後続フェーズに置く）" : "- この分析では広告出稿の設計がまだ無いため、広告関連のitemは schedule に入れない"}
- risks は3件まで。この商材で実際に起きうるものだけ（法令・炎上・人手・季節性など）
${sns ? "- 実測できているSNSの数値（フォロワー数・投稿数など）がある場合は、その媒体については新規開設ではなく、今の数値・投稿頻度・投稿内容を動かす前提で具体的に書く。実測が無い媒体についてだけ、新規に始める施策として書いてよい" : ""}`,
    `商材: ${d.product}
ターゲット: ${d.audience}
業種: ${d.industry}
強み: ${d.strengths.join(" / ")}
買わない理由: ${d.objections.join(" / ")}
${site ? `サイトの技術面: 構造化データ ${site.structuredData ? "有り" : "無し"} / sitemap ${site.sitemapXml ? "有り" : "無し"} / 内部リンク ${site.internalLinks}` : ""}
${sns ? `\n【運用中の公式SNS】※実測。新規に開設する施策は出さない。今ある数値・投稿頻度を動かす施策を書く\n${sns}` : ""}
${ads ? `\n【設計済みの広告出稿】※この内容をschedule内の広告itemに具体的に引用する\n${ads}` : ""}

出力:
{"items":[{"area":"","summary":"","actions":["",""],"kpi":""}],
 "schedule":[{"phase":"","period":"","items":["","","",""]}],
 "risks":[""]}`,
    { maxTokens: 4500 }
  );
}
