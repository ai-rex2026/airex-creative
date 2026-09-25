"use client";

import { useState } from "react";
import { buildAiSearchPrompt, completedChecks, formatDate, formatDateTime, mentionTally } from "@/lib/meo-ops/logic";
import type { AiContentSuggestion, AiContentTechnique, AiSearchCheck, AiSourceCoverageStatus, AiSourcePlatform } from "@/lib/meo-ops/types";
import { Btn, cn, GuardNotes, Icon, Input } from "./ui";

/**
 * AI検索タブの部品（本体 features/meo/components/ai-search/* の移植）。
 * スコアに丸めず「n回中m回」「何番目」のまま出す（丸めると根拠を説明できなくなるため）。
 */

export function AiSearchRunPanel({
  area,
  category,
  onAreaChange,
  onCategoryChange,
  onRun,
  isRunning,
  remainingRuns,
}: {
  area: string;
  category: string;
  onAreaChange: (v: string) => void;
  onCategoryChange: (v: string) => void;
  onRun: () => void;
  isRunning: boolean;
  remainingRuns: number | null;
}) {
  const canRun = area.trim() !== "" && category.trim() !== "" && !isRunning && (remainingRuns ?? 0) > 0;
  return (
    <section className="rounded-2xl border border-[#E8E5E0] bg-white p-5">
      <h3 className="disp text-sm font-bold text-[#2E2D29]">AIに聞いてみる</h3>
      <p className="mt-1 text-sm text-[#8B877F]">実際にAIへ質問を投げて、お店が候補に挙がるかを確認します</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="ai-search-area" className="text-xs font-semibold text-[#6B6862]">
            エリア
          </label>
          <Input id="ai-search-area" value={area} onChange={(e) => onAreaChange(e.target.value)} placeholder="渋谷区" className="mt-1.5" />
        </div>
        <div>
          <label htmlFor="ai-search-category" className="text-xs font-semibold text-[#6B6862]">
            業種
          </label>
          <Input id="ai-search-category" value={category} onChange={(e) => onCategoryChange(e.target.value)} placeholder="美容室" className="mt-1.5" />
        </div>
      </div>
      {/* 何を測っているかを隠さないため、実際に投げる質問文をそのまま出す */}
      <div className="mt-4 rounded-xl bg-[#F7F6F3] p-3.5">
        <p className="text-xs font-semibold text-[#6B6862]">実際に投げる質問</p>
        <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-[#2E2D29]">
          {area && category ? buildAiSearchPrompt(area, category) : "エリアと業種を入力すると質問文が表示されます"}
        </p>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-[#A5A198]">{remainingRuns === null ? "残り回数を確認しています" : `今月あと ${remainingRuns} 回まで確認できます`}</p>
        <Btn onClick={onRun} disabled={!canRun}>
          <Icon name={isRunning ? "loader" : "search"} />
          {isRunning ? "確認中..." : "AI検索で確認する"}
        </Btn>
      </div>
    </section>
  );
}

const ENGINE: Record<AiSearchCheck["engine"], string> = {
  gemini: "Gemini（Google検索あり）",
  claude: "Claude（web検索あり）",
};

export function AiSearchResultCard({ check, storeName }: { check: AiSearchCheck; storeName: string }) {
  const [showAnswer, setShowAnswer] = useState(false);

  if (check.status === "pending" || check.status === "running") {
    return (
      <section className="rounded-2xl border border-[#E8E5E0] bg-white p-5">
        <div className="flex items-center gap-3">
          <Icon name="loader" className="h-5 w-5 text-[#2E2D29]" />
          <div>
            <p className="text-sm font-semibold text-[#2E2D29]">AIに問い合わせています</p>
            <p className="mt-0.5 text-xs text-[#8B877F]">検索と回答の生成に30〜60秒ほどかかります。完了すると自動で表示されます</p>
          </div>
        </div>
      </section>
    );
  }

  if (check.status === "failed") {
    return (
      <section className="rounded-2xl border border-[#E8D9D1] bg-[#FCF8F6] p-5">
        <div className="flex items-start gap-3">
          <Icon name="alert" className="mt-0.5 h-5 w-5 shrink-0 text-[#A8705A]" />
          <div>
            <p className="text-sm font-semibold text-[#2E2D29]">確認に失敗しました</p>
            <p className="mt-0.5 text-xs text-[#8B877F]">{check.errorMessage || "時間をおいて再度お試しください"}</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-[#E8E5E0] bg-white">
      <div className="border-b border-[#F0EEEA] px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-[#A5A198]">
            {formatDateTime(check.executedAt)}・{ENGINE[check.engine]}
          </p>
          <p className="text-xs text-[#A5A198]">
            「{check.queryArea} {check.queryCategory}」で質問
          </p>
        </div>
        {check.mentioned ? (
          <p className="disp mt-3 text-xl font-black text-[#2E2D29]">
            候補に挙がりました
            {check.rank != null && <span className="ml-2 text-sm font-bold text-[#6B6862]">{check.rank}番目</span>}
          </p>
        ) : (
          <p className="disp mt-3 flex items-center gap-2 text-xl font-black text-[#A8705A]">
            <Icon name="minusCircle" className="h-5 w-5" />
            候補に挙がりませんでした
          </p>
        )}
      </div>

      {check.listedStores.length > 0 && (
        <div className="px-5 py-4">
          <p className="text-xs font-semibold text-[#6B6862]">AIが挙げたお店</p>
          <ol className="mt-2.5 space-y-1.5">
            {check.listedStores.map((name, i) => {
              const isOwn = check.rank === i + 1 || name === storeName;
              return (
                <li
                  key={`${check.id}-${i}-${name}`}
                  className={cn("flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm", isOwn ? "bg-[#F4F3F0] font-semibold text-[#2E2D29]" : "text-[#57544E]")}
                >
                  <span className="w-4 shrink-0 text-xs text-[#A5A198]">{i + 1}</span>
                  {name}
                  {isOwn && <span className="rounded-full bg-[#2E2D29] px-2 py-0.5 text-[10px] font-bold text-white">自店</span>}
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {check.rawAnswer && (
        <div className="border-t border-[#F0EEEA]">
          <button
            type="button"
            onClick={() => setShowAnswer((v) => !v)}
            className="flex w-full items-center justify-between px-5 py-3 text-sm font-medium text-[#6B6862] hover:text-[#2E2D29]"
          >
            AIの回答全文
            <Icon name={showAnswer ? "chevronUp" : "chevronDown"} />
          </button>
          {showAnswer && (
            <div className="space-y-4 px-5 pb-5">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-[#57544E]">{check.rawAnswer}</p>
              {check.citedSources.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-[#6B6862]">AIが根拠にしたページ</p>
                  <ul className="mt-1.5 space-y-1">
                    {check.citedSources.map((s) => (
                      <li key={s.url} className="truncate text-xs">
                        <a href={s.url} target="_blank" rel="noreferrer noopener" className="text-[#8A5340] hover:underline">
                          {s.title || s.domain}
                        </a>
                        <span className="ml-1.5 text-[#A5A198]">{s.domain}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {check.searchQueries.length > 0 && <p className="text-xs text-[#A5A198]">AIが検索した語: {check.searchQueries.join(" / ")}</p>}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export function AiMentionTally({ checks }: { checks: AiSearchCheck[] }) {
  const { hits, total } = mentionTally(checks);
  if (total === 0) return null;
  const done = [...completedChecks(checks)].reverse();
  return (
    <section className="rounded-2xl border border-[#E8E5E0] bg-white p-5">
      <h3 className="disp text-sm font-bold text-[#2E2D29]">これまでの結果</h3>
      <p className="disp mt-2 text-2xl font-black text-[#2E2D29]">
        {total}回中 {hits}回<span className="ml-2 text-sm font-normal text-[#8B877F]">候補に挙がりました</span>
      </p>
      <ol className="mt-4 flex flex-wrap gap-1.5">
        {done.map((c) => (
          <li
            key={c.id}
            title={`${formatDate(c.executedAt)}：${c.mentioned ? `${c.rank ?? "-"}番目に掲載` : "掲載なし"}`}
            className={cn("h-7 w-7 rounded-lg text-center text-xs font-bold leading-7", c.mentioned ? "bg-[#2E2D29] text-white" : "bg-[#F0EEEA] text-[#A5A198]")}
          >
            {c.mentioned ? (c.rank ?? "○") : "−"}
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-[#A5A198]">※ 数字は掲載順位です。AIの回答は毎回同じとは限らないため、1回の結果ではなく推移で見てください</p>
    </section>
  );
}

const SOURCE_STATUS: Record<AiSourceCoverageStatus, { label: string; icon: string; className: string }> = {
  listed: { label: "掲載あり", icon: "check", className: "bg-[#F4F3F0] text-[#26251F]" },
  notFound: { label: "掲載を確認できず", icon: "x", className: "bg-[#F8F1ED] text-[#A8705A]" },
  unknown: { label: "未確認", icon: "circleDashed", className: "bg-[#F7F6F3] text-[#A5A198]" },
};

/** AIが参照する媒体のカバレッジ。引用実績から逆算するので「未確認」は「未掲載」ではない */
export function AiSourceCoverageCard({ platforms }: { platforms: AiSourcePlatform[] }) {
  if (platforms.length === 0) return null;
  return (
    <section className="rounded-2xl border border-[#E8E5E0] bg-white p-5">
      <h3 className="disp text-sm font-bold text-[#2E2D29]">AIが見ている参照元</h3>
      <p className="mt-1 text-sm text-[#8B877F]">AIは自社サイトだけでなく外部の掲載サイトを根拠にします。掲載が無い媒体は候補に挙がりにくくなります</p>
      <ul className="mt-4 divide-y divide-[#F0EEEA]">
        {platforms.map((p) => {
          const s = SOURCE_STATUS[p.status];
          return (
            <li key={p.key} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-[#2E2D29]">{p.label}</p>
                <p className="mt-0.5 truncate text-xs text-[#A5A198]">
                  {p.usedBy}が参照することが多い媒体
                  {p.citedCount > 0 && `・引用 ${p.citedCount}回`}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold", s.className)}>
                  <Icon name={s.icon} className="h-3 w-3" />
                  {s.label}
                </span>
                {p.status !== "listed" && p.manageUrl && (
                  <a href={p.manageUrl} target="_blank" rel="noreferrer" className="text-[#6B6862] hover:text-[#2E2D29]" aria-label={`${p.label}を開く`}>
                    <Icon name="external" />
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-xs leading-relaxed text-[#A5A198]">
        ※ 「未確認」は、まだAIがその媒体を引用していないため掲載の有無を判定できていない状態です。未掲載とは限りません。
        どのAIがどの媒体を参照しているかは各社が公表しておらず、観測に基づく目安です。
      </p>
    </section>
  );
}

const TECHNIQUE: Record<AiContentTechnique, { label: string; icon: string }> = {
  statistics: { label: "具体的な数字を入れる", icon: "chart" },
  quotation: { label: "お客様の声を引用する", icon: "quote" },
  citeSources: { label: "出典を明記する", icon: "link" },
};

const TARGET: Record<AiContentSuggestion["target"], string> = {
  gbpDescription: "ビジネスの説明",
  gbpPost: "最新情報の投稿",
  siteSchema: "自社サイトの構造化データ",
};

/** 引用されやすさの改善提案。「◯%改善します」とは表示しない。数字の出所は必ず添える */
export function AiContentSuggestionCard({ suggestion }: { suggestion: AiContentSuggestion }) {
  const t = TECHNIQUE[suggestion.technique];
  return (
    <article className="rounded-2xl border border-[#E8E5E0] bg-white p-5">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F4F3F0] px-2.5 py-1 text-xs font-semibold text-[#26251F]">
          <Icon name={t.icon} className="h-3 w-3" />
          {t.label}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F7F6F3] px-2.5 py-1 text-xs font-medium text-[#6B6862]">
          <Icon name="file" className="h-3 w-3" />
          {TARGET[suggestion.target]}
        </span>
      </div>
      <h4 className="mt-3 text-sm font-bold text-[#2E2D29]">{suggestion.title}</h4>
      <p className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-[#F7F6F3] p-3.5 text-sm leading-relaxed text-[#2E2D29]">{suggestion.body}</p>
      {suggestion.sourceNote && <p className="mt-2.5 text-xs text-[#A5A198]">数字の出所：{suggestion.sourceNote}</p>}
      {suggestion.guardHits.length > 0 && (
        <div className="mt-2.5">
          <GuardNotes hits={suggestion.guardHits} />
        </div>
      )}
    </article>
  );
}

/** 失敗した実測。実行はバックグラウンドなので、何も出さないと月次枠だけ減ったように見える */
export function AiSearchFailureNotice({ check }: { check: AiSearchCheck }) {
  const stalled = check.status !== "failed";
  return (
    <section className="rounded-2xl border border-[#E8D5CB] bg-[#F8F1ED] p-5">
      <div className="flex gap-3">
        <Icon name="alert" className="mt-0.5 h-5 w-5 shrink-0 text-[#A8705A]" />
        <div className="min-w-0 space-y-1.5">
          <p className="text-sm font-bold text-[#8A5340]">{stalled ? "確認の結果が返ってきませんでした" : "AIへの確認に失敗しました"}</p>
          <p className="text-sm leading-relaxed text-[#8B877F]">
            {stalled ? "時間内に結果が届きませんでした。もう一度お試しください。" : "AIの応答を取得できませんでした。時間をおいてもう一度お試しください。"}
          </p>
          {check.errorMessage && <p className="break-words text-xs text-[#A5A198]">理由: {check.errorMessage}</p>}
          <p className="text-xs text-[#A5A198]">
            {check.queryArea}で{check.queryCategory}を探した場合の確認
          </p>
        </div>
      </div>
    </section>
  );
}
