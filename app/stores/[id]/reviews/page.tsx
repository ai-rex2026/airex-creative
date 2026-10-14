"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, useTransition } from "react";
import { deleteReplyAction, replyToReviewAction } from "@/app/meo-actions";
import { MeoPageHeader, useMeo } from "@/components/meo/Workspace";
import { FilterPills, ReviewCard } from "@/components/meo/parts";
import { ErrorNote, Icon } from "@/components/meo/ui";
import { meoPath } from "@/lib/meo-ops/logic";
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
  const { data, storeId } = useMeo();
  const router = useRouter();
  const searchParams = useSearchParams();
  // 初期値としてのみ使う。以降はタブ操作で切り替える
  const [filter, setFilter] = useState<Filter>(() => parseFilter(searchParams?.get("filter") ?? null));
  const [saveError, setSaveError] = useState<string | null>(null);
  // 返信・取り消しのあとの読み直しは2〜4秒かかる。終わるまで「更新中」と分かるようにする
  const [refreshing, startRefresh] = useTransition();
  const reload = () => startRefresh(() => router.refresh());

  const handleReply = async (reviewId: string, reply: string) => {
    setSaveError(null);
    try {
      await replyToReviewAction(storeId, reviewId, reply);
      reload();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "返信の送信に失敗しました。時間をおいて再度お試しください。");
      // 入力欄を閉じさせないために失敗を伝える（閉じると書いた返信が消える）
      throw e;
    }
  };

  const handleDelete = async (reviewId: string) => {
    setSaveError(null);
    try {
      await deleteReplyAction(storeId, reviewId);
      reload();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "返信の取り消しに失敗しました。時間をおいて再度お試しください。");
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
      <Link
        href={`${meoPath(storeId)}?sec=fix&open=kit`}
        className="flex items-center gap-3 rounded-2xl border border-[#E0D6C8] bg-[#FBF8F3] px-4 py-3 text-sm hover:border-[#C9A84C]"
      >
        <Icon name="star" className="h-5 w-5 shrink-0 text-[#8A5340]" />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-[#2E2D29]">店頭QRの口コミ画面（口コミを増やす）</span>
          <span className="block text-xs text-[#8B877F]">QRコードの印刷、お客様のスマホに出る画面の確認、POP・会計時のひとことはこちら</span>
        </span>
        <Icon name="arrowRight" className="h-4 w-4 text-[#A5A198]" />
      </Link>
      <FilterPills items={FILTERS} value={filter} counts={counts} onChange={setFilter} />
      {saveError && <ErrorNote>{saveError}</ErrorNote>}
      {refreshing && <p className="text-xs text-[#8B877F]">最新の状態に更新しています…</p>}
      {visible.length === 0 ? (
        <div className="rounded-2xl border border-[#E8E5E0] bg-white p-10 text-center">
          <p className="text-sm font-medium text-[#2E2D29]">該当するクチコミはありません</p>
          <p className="mt-1 text-sm text-[#8B877F]">絞り込みを変えると、他のクチコミを確認できます。</p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((r) => (
            <ReviewCard key={r.id} review={r} storeId={storeId} onReply={handleReply} onDeleteReply={handleDelete} canSend={!!data.gbpLocationName} />
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
