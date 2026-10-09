"use client";

import { MeoPageHeader, SectionTitle, useMeo } from "@/components/meo/Workspace";
import { Icon } from "@/components/meo/ui";
import { PHOTO_TARGET_COUNT, photoBenchmark, storeShortName } from "@/lib/meo-ops/logic";

/**
 * 写真の掲載状況。枚数は Places API 由来で GBP の連携を待たずに取れる。
 * Places が返す写真は1店舗あたり最大10件なので、10枚は「10枚以上」を意味する。
 */
export default function MeoPhotosPage() {
  const { data } = useMeo();
  const { ownCount, competitors } = data.photos;
  const { shortfall, competitorAverage, rank, totalStores } = photoBenchmark(data.photos);
  const storeName = storeShortName(data.store.name);
  // 全員0枚でも幅計算が壊れないよう最低1にする
  const maxCount = Math.max(ownCount ?? 0, ...competitors.map((c) => c.count), 1);

  return (
    <div className="space-y-6">
      <MeoPageHeader icon="images" title="写真" description="Googleマップに載っている写真の枚数と、近隣競合との比較です" />

      <section className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-[#E8E5E0] bg-white p-5">
          <p className="text-xs font-medium text-[#8B877F]">自店舗の掲載枚数</p>
          <p className="disp mt-1.5 text-3xl font-bold text-[#2E2D29]">
            {ownCount ?? "-"}
            {ownCount != null && <span className="ml-1 text-base font-medium">{ownCount >= PHOTO_TARGET_COUNT ? "枚以上" : "枚"}</span>}
          </p>
          {ownCount == null ? (
            <p className="mt-1.5 text-xs text-[#8B877F]">まだ取得できていません</p>
          ) : shortfall > 0 ? (
            <p className="mt-1.5 text-xs text-[#8A5340]">
              目標{PHOTO_TARGET_COUNT}枚まであと{shortfall}枚
            </p>
          ) : (
            <p className="mt-1.5 text-xs text-[#6B6862]">目標の{PHOTO_TARGET_COUNT}枚を満たしています</p>
          )}
        </div>
        <div className="rounded-2xl border border-[#E8E5E0] bg-white p-5">
          <p className="text-xs font-medium text-[#8B877F]">近隣競合の平均</p>
          <p className="disp mt-1.5 text-3xl font-bold text-[#2E2D29]">
            {competitorAverage ?? "-"}
            {competitorAverage != null && <span className="ml-1 text-base font-medium">枚</span>}
          </p>
          <p className="mt-1.5 text-xs text-[#8B877F]">{competitors.length > 0 ? `枚数が取れた競合${competitors.length}件の平均` : "比較できる競合がいません"}</p>
        </div>
        <div className="rounded-2xl border border-[#E8E5E0] bg-white p-5">
          <p className="text-xs font-medium text-[#8B877F]">枚数の順位</p>
          <p className="disp mt-1.5 text-3xl font-bold text-[#2E2D29]">
            {rank ?? "-"}
            {rank != null && <span className="ml-1 text-base font-medium">位</span>}
          </p>
          <p className="mt-1.5 text-xs text-[#8B877F]">{rank != null ? `${totalStores}店舗中（同数は同順位）` : "自店舗の枚数が未取得です"}</p>
        </div>
      </section>

      <section className="space-y-3">
        <SectionTitle>競合との比較</SectionTitle>
        {competitors.length === 0 ? (
          <p className="rounded-2xl border border-[#E8E5E0] bg-white p-5 text-sm text-[#6B6862]">
            近隣競合の写真枚数がまだ取得できていません。店舗を選び直すか、次回の集計で比較できるようになります。
          </p>
        ) : (
          <ul className="space-y-2 rounded-2xl border border-[#E8E5E0] bg-white p-5">
            <Bar name={storeName} count={ownCount} max={maxCount} own />
            {competitors.map((c) => (
              <Bar key={c.name} name={c.name} count={c.count} max={maxCount} />
            ))}
          </ul>
        )}
      </section>

      {/* 枚数だけ出して画像が無い理由を書かないと、読み込み失敗と区別が付かない */}
      <section className="flex items-start gap-3 rounded-2xl border border-dashed border-[#D8D4CC] bg-[#FAF9F7] p-5">
        <Icon name="imageOff" className="mt-0.5 h-5 w-5 shrink-0 text-[#8B877F]" />
        <div className="space-y-1">
          <p className="text-sm font-bold text-[#2E2D29]">写真そのものはまだ表示できません</p>
          <p className="text-sm leading-relaxed text-[#6B6862]">
            いま取得しているのは枚数だけです（Googleマップの公開データは1店舗あたり最大10枚までしか返らないため、10枚は「10枚以上」を意味します）。
            アップロードや並べ替えなど、Googleビジネスプロフィール側を編集する操作にはGBP APIの承認も要ります。
          </p>
        </div>
      </section>
    </div>
  );
}

function Bar({ name, count, max, own = false }: { name: string; count: number | null; max: number; own?: boolean }) {
  return (
    <li className="flex items-center gap-3">
      <span className={`w-32 shrink-0 truncate text-sm ${own ? "font-bold text-[#2E2D29]" : "text-[#57544E]"}`}>
        {name}
        {own && <span className="ml-1 text-xs font-medium text-[#8A5340]">自店舗</span>}
      </span>
      <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-[#F0EEEA]">
        <span className={`block h-full rounded-full ${own ? "bg-[#8A5340]" : "bg-[#C9C4BA]"}`} style={{ width: `${((count ?? 0) / max) * 100}%` }} />
      </span>
      <span className="w-12 shrink-0 text-right text-sm tabular-nums text-[#2E2D29]">{count ?? "-"}</span>
    </li>
  );
}
