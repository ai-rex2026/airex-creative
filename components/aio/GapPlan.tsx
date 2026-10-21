"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { analyzeAioGapAction, generateAioDraftAction, planAioMonthAction, removeAioPlanItemAction, updateAioPlanItemAction } from "@/app/aio-actions";
import { createAioArticleAction, finishAioArticleAction } from "@/app/aio-content-actions";
import { SectionTitle } from "@/components/meo/Workspace";
import { Btn, Card, ErrorNote, Icon, cn } from "@/components/meo/ui";
import { AIO_DRAFT_KINDS, type AioContentPlan, type AioGapReport, type AioProject } from "@/lib/aio/types";

/**
 * Gap Analysis（競合にあって自社にない情報）と、月次コンテンツ計画（Content Creation の設計）。
 * 計画の各項目から「下書きを作る」を押すと、計画のタイトル・構成に沿って ③ の下書きが作られる。
 */
export function GapPlan({ project, gap, plans, hasResults }: { project: AioProject; gap: AioGapReport | null; plans: AioContentPlan[]; hasResults: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [drafting, setDrafting] = useState<string | null>(null);
  const [planIdx, setPlanIdx] = useState(0);
  const plan = plans[planIdx] ?? null;

  const analyze = async () => {
    setAnalyzing(true);
    setError(null);
    try {
      await analyzeAioGapAction(project.id);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "分析できませんでした");
    } finally {
      setAnalyzing(false);
    }
  };
  const makePlan = async () => {
    setPlanning(true);
    setError(null);
    try {
      await planAioMonthAction(project.id);
      setPlanIdx(0);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "計画を作れませんでした");
    } finally {
      setPlanning(false);
    }
  };
  const draft = async (itemId: string, kind: AioContentPlan["items"][number]["kind"]) => {
    if (!plan) return;
    setDrafting(itemId);
    setError(null);
    try {
      if (kind === "site_article" || kind === "note_article") {
        // 自社サイト記事・note は、運用のタブで画像つき・公開まで扱う
        const it = plan.items.find((i) => i.id === itemId);
        const channel = kind === "site_article" ? "site" : "note";
        const created = await createAioArticleAction(project.id, channel, it ? { title: it.title, target: it.target, outline: it.outline } : null, { planId: plan.id, itemId });
        if (!created.ok) {
          setError(created.error);
          return;
        }
        await finishAioArticleAction(created.id).catch(() => undefined);
        // 自社サイト記事は SEO運用（/seo）に移した（2026-10-21）
        router.push(channel === "site" ? `/seo/${project.id}?tab=site` : `/aio/${project.id}?tab=${channel}`);
        return;
      }
      await generateAioDraftAction(project.id, kind, { planId: plan.id, itemId });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "下書きを作れませんでした");
    } finally {
      setDrafting(null);
    }
  };

  const label = (k: string) => AIO_DRAFT_KINDS.find((d) => d.kind === k)?.label ?? k;

  return (
    <Card>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <SectionTitle>④ ギャップ分析と月次コンテンツ計画</SectionTitle>
          <p className="mt-1 text-xs leading-relaxed text-[#8B877F]">実測の結果から「競合にはあって自社にはない情報」を特定し、来月に作るコンテンツ（PR／自社サイト記事／note／アンケート記事 など）を計画します。公開は人が行います</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Btn variant="outline" size="sm" onClick={analyze} disabled={analyzing || !hasResults} title={!hasResults ? "先に実測してください" : undefined}>
            {analyzing ? <Icon name="loader" /> : <Icon name="search" className="h-3.5 w-3.5" />}
            {gap ? "ギャップ分析をやり直す" : "ギャップ分析を作る"}
          </Btn>
          <Btn size="sm" onClick={makePlan} disabled={planning}>
            {planning ? <Icon name="loader" /> : <Icon name="calendar" className="h-3.5 w-3.5" />}
            来月の計画を作る
          </Btn>
        </div>
      </div>
      {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
      {(analyzing || planning) && <p className="mt-2 text-xs text-[#6B6862]">AI が考えています（1分ほど）</p>}

      {gap && (
        <div className="mt-4 rounded-xl bg-[#FAF9F7] p-4">
          <p className="text-xs text-[#8B877F]">ギャップ分析（{gap.period} の実測より・{new Date(gap.createdAt).toLocaleDateString("ja-JP")}）</p>
          <p className="mt-1 text-sm leading-relaxed text-[#2E2D29]">{gap.summary}</p>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <div>
              <p className="text-xs font-semibold text-[#2E2D29]">競合にあって自社にない情報</p>
              <ul className="mt-1.5 space-y-2">
                {gap.gaps.map((g, i) => (
                  <li key={i} className="rounded-lg border border-[#E8E5E0] bg-white p-2.5">
                    <p className="text-sm font-semibold text-[#2E2D29]">{g.topic}</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-[#6B6862]">{g.evidence}</p>
                    <p className="mt-1 text-xs text-[#2E2D29]">→ {g.idea}<span className="ml-1 rounded-full bg-[#F4F3F0] px-1.5 py-0.5 text-[10px] text-[#6B6862]">{g.media}</span></p>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold text-[#2E2D29]">アプローチする媒体</p>
              <ul className="mt-1.5 space-y-2">
                {gap.mediaTargets.map((m, i) => (
                  <li key={i} className="rounded-lg border border-[#E8E5E0] bg-white p-2.5">
                    <p className="text-sm font-semibold text-[#2E2D29]">{m.domain}</p>
                    <p className="mt-0.5 text-[11px] text-[#6B6862]">{m.reason}</p>
                    <p className="mt-1 text-xs text-[#2E2D29]">→ {m.action}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {plans.length > 0 && plan && (
        <div className="mt-4">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-[#2E2D29]">コンテンツ計画</p>
            {plans.map((p, i) => (
              <button key={p.id} type="button" onClick={() => setPlanIdx(i)} className={cn("rounded-full px-3 py-1 text-xs", i === planIdx ? "bg-[#2E2D29] text-white" : "bg-[#F4F3F0] text-[#6B6862]")}>
                {p.month}
              </button>
            ))}
            <span className="ml-auto text-[11px] text-[#A5A198]">
              {plan.items.filter((i) => i.status !== "planned").length} / {plan.items.length} 本 着手
            </span>
          </div>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-[#8B877F]">
                  <th className="py-2 pr-3 font-medium">週</th>
                  <th className="py-2 pr-3 font-medium">種類</th>
                  <th className="py-2 pr-3 font-medium">タイトル／答える問い</th>
                  <th className="py-2 pr-3 font-medium">状態</th>
                  <th className="py-2 pr-0 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {plan.items.map((it) => (
                  <tr key={it.id} className={cn("border-t border-[#F0EDE8] align-top", it.status === "done" && "opacity-60")}>
                    <td className="py-2 pr-3 text-xs text-[#6B6862]">第{it.week}週</td>
                    <td className="py-2 pr-3"><span className="whitespace-nowrap rounded-full bg-[#F4F3F0] px-2 py-0.5 text-[10px] text-[#6B6862]">{label(it.kind)}</span></td>
                    <td className="py-2 pr-3">
                      <p className="font-medium text-[#2E2D29]">{it.title}</p>
                      <p className="text-[11px] text-[#8B877F]">問い: {it.target}</p>
                      <p className="text-[11px] text-[#A5A198]">{it.outline}</p>
                    </td>
                    <td className="py-2 pr-3 text-xs whitespace-nowrap">
                      {it.status === "planned" ? <span className="text-[#A5A198]">未着手</span> : it.status === "drafted" ? <span className="text-[#8A6A1E]">下書きあり</span> : <span className="text-[#2F6B4A]">掲載済み</span>}
                    </td>
                    <td className="py-2 pr-0 text-right whitespace-nowrap">
                      {it.status === "planned" ? (
                        <Btn size="sm" variant="outline" onClick={() => draft(it.id, it.kind)} disabled={drafting !== null}>
                          {drafting === it.id ? <Icon name="loader" /> : <Icon name="sparkles" className="h-3.5 w-3.5" />}
                          下書きを作る
                        </Btn>
                      ) : it.status === "drafted" ? (
                        <button type="button" className="text-xs text-[#2F6B4A] underline" onClick={() => updateAioPlanItemAction(project.id, plan.id, it.id, { status: "done" }).then(() => router.refresh())}>
                          掲載した
                        </button>
                      ) : (
                        <button type="button" className="text-xs text-[#6B6862] underline" onClick={() => updateAioPlanItemAction(project.id, plan.id, it.id, { status: "drafted" }).then(() => router.refresh())}>
                          戻す
                        </button>
                      )}
                      <button type="button" className="ml-2 text-xs text-[#A5A198] underline" onClick={() => removeAioPlanItemAction(project.id, plan.id, it.id).then(() => router.refresh())}>
                        外す
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-[#A5A198]">「下書きを作る」で作った文章は下の「下書き」に並びます。アンケート記事は設問から先に作り、回収した結果を人が入れて完成させます（結果の数字は AI が作りません）</p>
        </div>
      )}
    </Card>
  );
}
