"use client";

import Link from "next/link";
import { MeoPageHeader, SectionTitle, useMeo } from "@/components/meo/Workspace";
import { AiAdviceBubble, DailyTrendCard, MetricTile, ProfileCompletenessCard, ReviewCard, TodayTodos } from "@/components/meo/parts";
import { Icon } from "@/components/meo/ui";
import { buildMeoTodos, formatMetricsPeriod, meoPath, withMetricPlaceholders } from "@/lib/meo-ops/logic";

/** MEOワークスペースのトップ（店舗ダッシュボード） */
export default function MeoHomePage() {
  const { data, analysisId } = useMeo();
  const periodLabel = formatMetricsPeriod(data.metricsPeriod);
  // 未集計でも枠を固定したいので、定義済みの指標は必ず並べる（未取得は「-」）
  const metrics = withMetricPlaceholders(data.metrics);
  const todos = buildMeoTodos(data);
  const recent = [...data.reviews].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 3);

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <MeoPageHeader icon="home" title="今日やること" description="対応が必要な項目をまとめています" />
        <TodayTodos todos={todos} analysisId={analysisId} />
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* 日次の推移は横に長いほど読み取れるため、広い方に置く */}
        <div className="space-y-5">
          <div className="space-y-3">
            <SectionTitle>パフォーマンス指標{periodLabel && `（${periodLabel}）`}</SectionTitle>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {metrics.slice(0, 6).map((m) => (
                <MetricTile key={m.key} metric={m} />
              ))}
            </div>
            {data.metricsPeriod == null && (
              <p className="text-xs text-[#8B877F]">
                {data.gbpLocationName
                  ? "今月の指標はまだ集計されていません。月がかわるタイミングで自動的に集計されます。"
                  : "表示回数や電話タップなどの指標は、Googleビジネスプロフィールと連携すると月ごとに集計されます（「設定」タブ）。"}
              </p>
            )}
            <Link href={meoPath(analysisId, "/insights")} className="inline-flex items-center gap-1 text-sm font-semibold text-[#2E2D29] hover:text-[#8A5340]">
              分析をくわしく見る
              <Icon name="arrowRight" />
            </Link>
          </div>
          <DailyTrendCard points={data.daily} />
        </div>

        <div className="space-y-3">
          <SectionTitle>プロフィール</SectionTitle>
          <ProfileCompletenessCard checklist={data.checklist} analysisId={analysisId} />
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <SectionTitle>最新のクチコミ</SectionTitle>
          <Link href={meoPath(analysisId, "/reviews")} className="inline-flex items-center gap-1 text-sm font-semibold text-[#2E2D29] hover:text-[#8A5340]">
            すべて見る
            <Icon name="arrowRight" />
          </Link>
        </div>
        {recent.length === 0 ? (
          <p className="rounded-2xl border border-[#E8E5E0] bg-white p-5 text-sm text-[#6B6862]">
            {data.gbpLocationName
              ? "まだクチコミを取り込んでいません。1時間ごとにGoogleから取り込みます。"
              : "Googleビジネスプロフィールと連携すると、クチコミをここで確認・返信できます（「設定」タブ）。"}
          </p>
        ) : (
          <div className="space-y-3">
            {recent.map((r) => (
              <ReviewCard key={r.id} review={r} analysisId={analysisId} compact />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <SectionTitle>AIからの改善提案</SectionTitle>
        <AiAdviceBubble suggestions={data.suggestions.slice(0, 2)} analysisId={analysisId} />
      </section>
    </div>
  );
}
