"use client";

import { useState } from "react";
import { MeoPageHeader, SectionTitle, useMeo } from "@/components/meo/Workspace";
import { MetricTile, SuggestionCard } from "@/components/meo/parts";
import { cn, Icon } from "@/components/meo/ui";
import { formatMetricsPeriod, withMetricPlaceholders } from "@/lib/meo-ops/logic";

type Compare = "prevMonth" | "prevYear";
const COMPARE_LABEL: Record<Compare, string> = { prevMonth: "前月比", prevYear: "前年同月比" };

/** 活用分析・現場分析・AI改善提案 */
export default function MeoInsightsPage() {
  const { data, analysisId } = useMeo();
  const periodLabel = formatMetricsPeriod(data.metricsPeriod);
  const metrics = withMetricPlaceholders(data.metrics);
  // 比較軸の切り替え。前年同月のデータは未取得のため、現状は表示ラベルのみ切り替える
  const [period, setPeriod] = useState<Compare>("prevMonth");

  const positive = data.fieldTopics.filter((t) => t.sentiment === "positive");
  const negative = data.fieldTopics.filter((t) => t.sentiment === "negative");
  const maxCount = Math.max(...data.fieldTopics.map((t) => t.count), 1);

  return (
    <div className="space-y-6">
      <MeoPageHeader
        icon="chart"
        title="分析"
        description="運用の実施状況と、クチコミから見える現場の傾向を確認します"
        action={
          <div className="flex rounded-xl border border-[#E8E5E0] bg-white p-1">
            {(Object.keys(COMPARE_LABEL) as Compare[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setPeriod(k)}
                className={cn("rounded-lg px-3 py-1.5 text-sm font-medium transition-colors", period === k ? "bg-[#2E2D29] text-white" : "text-[#57544E]")}
              >
                {COMPARE_LABEL[k]}
              </button>
            ))}
          </div>
        }
      />

      <section className="space-y-3">
        <SectionTitle>活用分析{periodLabel && `（${periodLabel}）`}</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {metrics.map((m) => (
            <MetricTile key={m.key} metric={m} comparisonLabel={COMPARE_LABEL[period]} />
          ))}
        </div>
        {data.metricsPeriod == null && (
          <p className="text-xs text-[#8B877F]">
            {data.gbpLocationName
              ? "今月の指標はまだ集計されていません。月がかわるタイミングで自動的に集計されます。"
              : "指標はGoogleビジネスプロフィールと連携すると、月ごとに集計されます（「設定」タブ）。"}
          </p>
        )}
      </section>

      <section className="space-y-3">
        <SectionTitle>現場分析</SectionTitle>
        {data.fieldTopics.length === 0 ? (
          <p className="rounded-2xl border border-[#E8E5E0] bg-white p-5 text-sm text-[#6B6862]">
            クチコミが取り込まれると、評価されている点と改善が求められている点をここにまとめます。
          </p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {[
              { title: "評価されている点", topics: positive, positive: true },
              { title: "改善が求められている点", topics: negative, positive: false },
            ].map((col) => (
              <div key={col.title} className="rounded-2xl border border-[#E8E5E0] bg-white p-5">
                <p className="flex items-center gap-2 text-sm font-semibold text-[#2E2D29]">
                  <Icon name="thumbsUp" className={cn("h-4 w-4", col.positive ? "text-[#26251F]" : "rotate-180 text-[#A8705A]")} />
                  {col.title}
                </p>
                <ul className="mt-4 space-y-4">
                  {col.topics.map((t) => (
                    <li key={t.id}>
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium text-[#2E2D29]">{t.label}</span>
                        <span className="text-xs text-[#8B877F]">{t.count}件</span>
                      </div>
                      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[#F0EEEA]">
                        <div className={cn("h-full rounded-full", col.positive ? "bg-[#2E2D29]" : "bg-[#A8705A]")} style={{ width: `${(t.count / maxCount) * 100}%` }} />
                      </div>
                      <ul className="mt-2 space-y-1">
                        {t.quotes.map((q) => (
                          <li key={q} className="text-xs leading-relaxed text-[#8B877F]">
                            「{q}」
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <SectionTitle>AIからの改善提案</SectionTitle>
        {data.suggestions.length === 0 ? (
          <p className="rounded-2xl border border-[#E8E5E0] bg-white p-5 text-sm text-[#6B6862]">月次の集計がそろうと、次にやるとよいことをここに出します。</p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {data.suggestions.map((s) => (
              <SuggestionCard key={s.id} suggestion={s} analysisId={analysisId} />
            ))}
          </div>
        )}
      </section>

      <p className="text-xs text-[#A5A198]">※ 指標はGoogleビジネスプロフィール連携後に実データへ更新されます。</p>
    </div>
  );
}
