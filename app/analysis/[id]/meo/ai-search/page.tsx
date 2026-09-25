"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { getAiSearchStatusAction, runAiSearchAction } from "@/app/meo-actions";
import { MeoPageHeader, SectionTitle, useMeo } from "@/components/meo/Workspace";
import {
  AiContentSuggestionCard,
  AiMentionTally,
  AiSearchFailureNotice,
  AiSearchResultCard,
  AiSearchRunPanel,
  AiSourceCoverageCard,
} from "@/components/meo/ai-search-parts";
import { Icon } from "@/components/meo/ui";
import { failedCheck, guessAreaFromAddress, latestCompletedCheck, pendingCheck, storeShortName } from "@/lib/meo-ops/logic";

/**
 * AI検索での見え方を実測する画面。
 * 「この施策をすればAIに出る」という因果は主張せず、実際にAIへ問い合わせた結果をそのまま提示する。
 * 実行は応答後にサーバーで走るので、確認中は数秒おきに読み直して結果を受け取る。
 */
export default function MeoAiSearchPage() {
  const { data, analysisId } = useMeo();
  const router = useRouter();
  const { checks, summary } = data.aiSearch;
  const storeName = storeShortName(data.store.name);

  const [area, setArea] = useState(() => guessAreaFromAddress(data.store.address));
  const [category, setCategory] = useState(data.store.category ?? "");
  const [requestError, setRequestError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // 残り回数はサーバーが持つ（JSTの月で数え、上限の判定もサーバー側）。取得できるまでは実行させない
  const [remaining, setRemaining] = useState<number | null>(null);
  // 受付済みだがまだ一覧に届いていないチェック。空けたままだと2回目を投げられてしまう（1回ごとに実費）
  const [startedId, setStartedId] = useState<string | null>(null);

  const running = pendingCheck(checks);
  const latest = latestCompletedCheck(checks);
  const failed = failedCheck(checks);
  const awaiting = startedId !== null && !checks.some((c) => c.id === startedId);

  const loadStatus = useCallback(async () => {
    const s = await getAiSearchStatusAction(analysisId);
    setRemaining(s.remaining);
    setArea((cur) => cur || s.area);
    setCategory((cur) => cur || s.category);
  }, [analysisId]);

  useEffect(() => {
    loadStatus().catch((e: unknown) => setRequestError(e instanceof Error ? e.message : "AI検索の状態を取得できませんでした"));
  }, [loadStatus]);

  // 確認中は5秒おきに読み直す（結果はサーバーが書き戻す）
  const isRunning = submitting || awaiting || running !== null;
  useEffect(() => {
    if (!running && !awaiting) return;
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [running, awaiting, router]);

  const run = async () => {
    setSubmitting(true);
    setRequestError(null);
    try {
      const r = await runAiSearchAction(analysisId, { area: area.trim(), category: category.trim() });
      setStartedId(r.checkId);
      setRemaining(r.remaining);
      router.refresh();
    } catch (e) {
      setRequestError(e instanceof Error ? e.message : "確認の開始に失敗しました");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <MeoPageHeader icon="bot" title="AI検索" description="ChatGPTなどのAIに聞かれたとき、お店が候補に挙がるかを実際に確認します" />

      <AiSearchRunPanel
        area={area}
        category={category}
        onAreaChange={setArea}
        onCategoryChange={setCategory}
        onRun={run}
        isRunning={isRunning}
        remainingRuns={remaining}
      />

      {requestError && <p className="rounded-xl bg-[#F8F1ED] px-4 py-3 text-sm text-[#A8705A]">{requestError}</p>}

      {!running && failed && <AiSearchFailureNotice check={failed} />}
      {running && <AiSearchResultCard check={running} storeName={storeName} />}

      {latest ? (
        <>
          {!running && (
            <section className="space-y-3">
              <SectionTitle>最新の結果</SectionTitle>
              <AiSearchResultCard check={latest} storeName={storeName} />
            </section>
          )}
          <AiMentionTally checks={checks} />
          <AiSourceCoverageCard platforms={summary.sources} />
        </>
      ) : (
        !running &&
        !failed && (
          <section className="rounded-2xl border border-dashed border-[#D8D4CC] bg-white p-8 text-center">
            <Icon name="bot" className="mx-auto h-8 w-8 text-[#C7C3BA]" />
            <p className="mt-3 text-sm font-medium text-[#2E2D29]">まだ確認していません</p>
            <p className="mt-1 text-sm text-[#8B877F]">上のボタンから、AIにお店が認識されているかを確認できます</p>
          </section>
        )
      )}

      {summary.suggestions.length > 0 && (
        <section className="space-y-3">
          <SectionTitle>AIに引用されやすくするには</SectionTitle>
          <div className="grid gap-3 lg:grid-cols-2">
            {summary.suggestions.map((s) => (
              <AiContentSuggestionCard key={s.id} suggestion={s} />
            ))}
          </div>
        </section>
      )}

      <p className="text-xs leading-relaxed text-[#A5A198]">
        ※ 表示しているのは実際にAIへ問い合わせた結果です。AIの回答は同じ質問でも変わることがあり、掲載順位を保証するものではありません。
      </p>
    </div>
  );
}
