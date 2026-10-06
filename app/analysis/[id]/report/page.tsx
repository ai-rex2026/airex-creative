import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Report } from "@/components/Report";
import { MeoReport } from "@/components/MeoReport";
import { Shell } from "@/components/Shell";
import type { Analysis } from "@/lib/analysis";
import { evaluateCategories, supplementFromLedger, withAdAccounts } from "@/lib/summary-tab";
import { adConnections } from "@/app/ad-actions";
import { AD_PLATFORMS } from "@/lib/ads/platforms";
import { buildLedger } from "@/lib/measure-sources";

export const metadata = { title: "レポート｜AI-REX Studio" };

// この画面から呼ぶサーバーアクション（施策の作り直し・実行プロンプトの生成）は
// AI を2回叩くので、既定の実行時間では足りない
export const maxDuration = 300;

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect(`/login?callbackUrl=${encodeURIComponent(`/analysis/${id}/report`)}`);

  const { data } = await sb.from("analyses").select("*").eq("id", id).single();
  if (!data) notFound();
  const a = data as Analysis;
  if (a.status !== "done") redirect(`/analysis/${id}/waiting`);

  // MEO だけを見に来た分析には診断もコピーも無い。専用の画面を出す
  if (a.mode === "meo") {
    return (
      <Shell active="analysis">
        <MeoReport id={a.id} meo={a.meo} site={a.site} url={a.url} />
      </Shell>
    );
  }
  if (!a.diagnosis || !a.copies) notFound();

  // カテゴリ別評価のうちSNSの説明文は、2026-10-06に短い書き方へ変えた。保存済みの分析も新しい書き方で
  // 出すため、表示のたびに計算し直して差し替える（実測値からの計算だけでAIは使わない）
  const categoryEvaluations = a.category_evaluations
    ? (() => {
        try {
          const fresh = evaluateCategories({
            site: a.site, adOps: a.ad_ops, meo: a.meo, seo: a.seo, gsc: a.gsc, keywords: a.keywords, speed: a.speed,
            lpo: a.lpo, social: a.social, suggests: a.suggests, socialCompetitors: a.social_competitors, diagnosis: a.diagnosis,
          }).find((e) => e.category === "SNS");
          return fresh ? a.category_evaluations.map((e) => (e.category === "SNS" ? fresh : e)) : a.category_evaluations;
        } catch {
          return a.category_evaluations;
        }
      })()
    : null;

  // 「広告」の評価（広告アカウントの連携の有無）。連携は利用者ごとなので、開くたびに作る
  const adNames = (user.is_anonymous ? [] : await adConnections()).map(
    (c) => AD_PLATFORMS.find((p) => p.id === c.platform)?.name ?? c.platform
  );
  const evaluationsShown = withAdAccounts(categoryEvaluations, adNames, !!user.is_anonymous, a.ad_review, a.public_ads);

  // 分析データの打ち手のうち施策に使われていないものを、効果中の施策として足す（AIは使わない）。
  // 作成済みの分析は、開いたときに1回だけ足して保存する（以後は足すものが無いので何もしない）
  let measures = a.measures;
  if (measures && measures.length > 0 && a.kpi) {
    try {
      const next = supplementFromLedger(measures, buildLedger(a), a.kpi);
      if (next.length > measures.length) {
        const { error } = await sb.from("analyses").update({ measures: next }).eq("id", a.id).eq("owner_id", user.id);
        if (!error) measures = next;
      }
    } catch {
      // 足せなくても、保存済みの施策はそのまま出す
    }
  }

  return (
    <Shell active="analysis">
      <Report d={a.diagnosis} copies={a.copies} url={a.url} isGuest={!!user.is_anonymous} site={a.site} seo={a.seo} plan={a.media_plan} summary={a.summary} competitors={a.competitors} tactics={a.tactics} adOps={a.ad_ops} meo={a.meo} lpo={a.lpo} keywords={a.keywords} seoArticles={a.seo_articles} industryVertical={a.industry_vertical} linePlan={a.line_plan} suggests={a.suggests} outreach={a.outreach} pricing={a.pricing} speed={a.speed} social={a.social} socialInsights={a.social_insights} imageScan={a.image_scan} customImages={a.custom_images} margin={a.margin} kpi={a.kpi} measures={measures} categoryEvaluations={evaluationsShown} measuresDone={a.measures_done} extraInputs={a.extra_inputs} measureLog={a.measure_log} budget={a.budget} id={a.id} gsc={a.gsc} ga4={a.ga4} snsPlan={a.sns_plan} adReview={a.ad_review} publicAds={a.public_ads} />
    </Shell>
  );
}
