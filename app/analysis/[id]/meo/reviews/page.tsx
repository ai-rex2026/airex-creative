"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { replyToReviewAction } from "@/app/meo-actions";
import { MeoPageHeader, useMeo } from "@/components/meo/Workspace";
import { FilterPills, ReviewCard } from "@/components/meo/parts";
import { ErrorNote } from "@/components/meo/ui";
import type { MeoReview } from "@/lib/meo-ops/types";

type Filter = "all" | "unreplied" | "needsUpdate" | "lowRating";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "すべて" },
  { key: "unreplied", label: "未返信" },
  { key: "needsUpdate", label: "再返信推奨" },
  { key: "lowRating", label: "星3以下" },
];

function parseFilter(v: string | null): Filter {
  return FILTERS.some((f) => f.key === v) ? (v as Filter) : "unreplied";
}

function matches(r: MeoReview, f: Filter) {
  if (f === "unreplied") return r.status === "unreplied";
  if (f === "needsUpdate") return r.status === "needsUpdate";
  if (f === "lowRating") return r.rating <= 3;
  return true;
}

/** クチコミ管理。未返信の絞り込みとAI返信をこの1画面で完結させる */
function Reviews() {
  const { data, analysisId } = useMeo();
  const router = useRouter();
  const searchParams = useSearchParams();
  // 初期値としてのみ使う。以降はタブ操作で切り替える
  const [filter, setFilter] = useState<Filter>(() => parseFilter(searchParams?.get("filter") ?? null));
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleReply = async (reviewId: string, reply: string) => {
    setSaveError(null);
    try {
      await replyToReviewAction(analysisId, reviewId, reply);
      router.refresh();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "返信の送信に失敗しました。時間をおいて再度お試しください。");
      // 入力欄を閉じさせないために失敗を伝える（閉じると書いた返信が消える）
      throw e;
    }
  };

  const reviews = data.reviews;
  const visible = reviews.filter((r) => matches(r, filter)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const counts: Record<Filter, number> = {
    all: reviews.length,
    unreplied: reviews.filter((r) => r.status === "unreplied").length,
    needsUpdate: reviews.filter((r) => r.status === "needsUpdate").length,
    lowRating: reviews.filter((r) => r.rating <= 3).length,
  };

  return (
    <div className="space-y-5">
      <MeoPageHeader icon="message" title="クチコミ管理" description="Googleのクチコミを確認し、AIの下書きを使って返信します" />
      {!data.gbpLocationName && (
        <p className="rounded-xl border border-dashed border-[#D8D4CC] bg-[#FAF9F7] px-4 py-3 text-sm text-[#6B6862]">
          クチコミの取り込みと返信の送信には、Googleビジネスプロフィールとの連携が必要です。「設定」タブから連携してください。
        </p>
      )}
      <FilterPills items={FILTERS} value={filter} counts={counts} onChange={setFilter} />
      {saveError && <ErrorNote>{saveError}</ErrorNote>}
      {visible.length === 0 ? (
        <div className="rounded-2xl border border-[#E8E5E0] bg-white p-10 text-center">
          <p className="text-sm font-medium text-[#2E2D29]">該当するクチコミはありません</p>
          <p className="mt-1 text-sm text-[#8B877F]">絞り込みを変えると、他のクチコミを確認できます。</p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((r) => (
            <ReviewCard key={r.id} review={r} analysisId={analysisId} onReply={handleReply} canSend={!!data.gbpLocationName} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function MeoReviewsPage() {
  return (
    <Suspense>
      <Reviews />
    </Suspense>
  );
}
