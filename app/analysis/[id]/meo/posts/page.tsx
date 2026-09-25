"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createPostAction } from "@/app/meo-actions";
import { MeoPageHeader, useMeo } from "@/components/meo/Workspace";
import { FilterPills, PostCard, PostComposer } from "@/components/meo/parts";
import { Btn, ErrorNote, Icon } from "@/components/meo/ui";
import { storeShortName } from "@/lib/meo-ops/logic";
import type { MeoPost, MeoPostInput, MeoPostStatus } from "@/lib/meo-ops/types";

type Filter = "all" | MeoPostStatus;
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "すべて" },
  { key: "draft", label: "下書き" },
  { key: "scheduled", label: "予約中" },
  { key: "published", label: "投稿済み" },
];

/** GBP最新情報の投稿管理 */
export default function MeoPostsPage() {
  const { data, analysisId } = useMeo();
  const router = useRouter();
  const posts = data.posts;
  const [filter, setFilter] = useState<Filter>("all");
  const [composing, setComposing] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleCreate = async (post: MeoPostInput) => {
    setSaveError(null);
    // 絞り込み中でも作成した投稿が見えるように「すべて」に戻す
    setFilter("all");
    try {
      await createPostAction(analysisId, post);
      router.refresh();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "投稿の保存に失敗しました。時間をおいて再度お試しください。");
      throw e;
    }
  };

  // 予約日時（無ければ投稿日時）の新しい順。どちらも無い下書きは末尾に置く
  const time = (p: MeoPost) => p.scheduledAt ?? p.publishedAt ?? "";
  const visible = posts.filter((p) => filter === "all" || p.status === filter).sort((a, b) => time(b).localeCompare(time(a)));
  const counts: Record<Filter, number> = {
    all: posts.length,
    draft: posts.filter((p) => p.status === "draft").length,
    scheduled: posts.filter((p) => p.status === "scheduled").length,
    published: posts.filter((p) => p.status === "published").length,
  };

  return (
    <div className="space-y-5">
      <MeoPageHeader
        icon="megaphone"
        title="投稿管理"
        description="Googleビジネスプロフィールの最新情報をAIで作成し、予約配信します"
        action={
          <Btn onClick={() => setComposing(true)}>
            <Icon name="plus" />
            投稿を作る
          </Btn>
        }
      />
      {composing && (
        <PostComposer
          analysisId={analysisId}
          storeName={storeShortName(data.store.name)}
          websiteUrl={data.store.websiteUrl}
          onCreate={handleCreate}
          onClose={() => setComposing(false)}
        />
      )}
      {saveError && <ErrorNote>{saveError}</ErrorNote>}
      <FilterPills items={FILTERS} value={filter} counts={counts} onChange={setFilter} />
      {visible.length === 0 ? (
        <div className="rounded-2xl border border-[#E8E5E0] bg-white p-10 text-center">
          <p className="text-sm font-medium text-[#2E2D29]">投稿がありません</p>
          <p className="mt-1 text-sm text-[#8B877F]">週1件を目安に投稿しておくと、ローカル検索での露出につながりやすくなります。</p>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {visible.map((p) => (
            <PostCard key={p.id} post={p} />
          ))}
        </div>
      )}
    </div>
  );
}
