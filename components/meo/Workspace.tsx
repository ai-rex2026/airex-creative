"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { searchStoreCandidatesAction, selectStoreAction } from "@/app/meo-actions";
import { formatDate, MEO_TABS, meoPath } from "@/lib/meo-ops/logic";
import type { GbpConnectionStatus, MeoStore, MeoWorkspaceData, StoreCandidate } from "@/lib/meo-ops/types";
import { Btn, cn, Dialog, Icon, Input } from "./ui";

/**
 * MEO運用ワークスペースの外枠（本体 app/.../meo/layout.tsx と layout/* の移植）。
 * レポート（読む成果物）とは性質が異なる「毎日の運用画面」として、店舗ヘッダーとタブを常設する。
 * データはサーバー（layout）で読み、ここから配下のページへ配る。
 */

type Ctx = { data: MeoWorkspaceData; analysisId: string };
const MeoContext = createContext<Ctx | null>(null);

export function useMeo(): Ctx {
  const ctx = useContext(MeoContext);
  if (!ctx) throw new Error("useMeo は MeoWorkspace の内側で使用してください");
  return ctx;
}

const TAB_ICON: Record<string, string> = {
  home: "home",
  reviews: "message",
  posts: "megaphone",
  profile: "store",
  photos: "images",
  insights: "chart",
  "ai-search": "bot",
  settings: "settings",
};

export function MeoWorkspace({ data, analysisId, children }: { data: MeoWorkspaceData; analysisId: string; children: ReactNode }) {
  // 店舗が確定していないとダッシュボードは意味を持たない。空の数字を実績と誤解させるか、
  // 別の支店のデータを自店のものとして見せることになるため、選択が済むまで他のUIは出さない
  if (!data.ownPlaceId) {
    return <MeoStoreRequired analysisId={analysisId} storeName={data.store.name} candidates={data.storeCandidates} />;
  }

  // 送信中（pending）は返信済みと同じく対応が済んでいるため、要対応の件数から外す
  const unrepliedCount = data.reviews.filter((r) => r.status !== "replied" && r.status !== "pending").length;

  return (
    <MeoContext.Provider value={{ data, analysisId }}>
      <div className="mx-auto max-w-6xl space-y-5">
        <MeoStoreHeader data={data} analysisId={analysisId} unrepliedCount={unrepliedCount} />
        <MeoTabNav analysisId={analysisId} badges={{ reviews: unrepliedCount }} />
        <div className="pb-10">{children}</div>
      </div>
    </MeoContext.Provider>
  );
}

// ── ヘッダー ─────────────────────────────────
const GBP_STATUS: Record<GbpConnectionStatus, { label: string; icon: string; className: string }> = {
  connected: { label: "GBP連携済み", icon: "checkCircle", className: "bg-[#F4F3F0] text-[#26251F] border-[#E0DBD1]" },
  disconnected: { label: "GBP未連携", icon: "unlink", className: "bg-[#F8F1ED] text-[#8A5340] border-[#ECD9CE]" },
  unclaimed: { label: "GBP未登録", icon: "alertTriangle", className: "bg-[#F8F1ED] text-[#A8705A] border-[#ECD9CE]" },
};

export function GbpStatusBadge({ status }: { status: GbpConnectionStatus }) {
  const s = GBP_STATUS[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold", s.className)}>
      <Icon name={s.icon} className="h-3.5 w-3.5" />
      {s.label}
    </span>
  );
}

function MeoStoreHeader({ data, analysisId, unrepliedCount }: { data: MeoWorkspaceData; analysisId: string; unrepliedCount: number }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const store: MeoStore = data.store;

  return (
    <div className="space-y-4">
      <Link href={`/analysis/${analysisId}/report`} className="inline-flex items-center gap-1.5 text-sm text-[#57544E] transition-colors hover:text-[#2E2D29]">
        <Icon name="arrowLeft" />
        レポートに戻る
      </Link>

      <div className="rounded-2xl border border-[#E8E5E0] bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="disp truncate text-xl font-bold text-[#2E2D29]">{store.name}</h1>
              <GbpStatusBadge status={store.gbpStatus} />
            </div>
            {store.address && (
              <p className="flex items-center gap-1.5 text-sm text-[#6B6862]">
                <Icon name="mapPin" className="h-4 w-4 shrink-0 text-[#A5A198]" />
                <span className="truncate">{store.address}</span>
              </p>
            )}
            {store.category && <p className="text-xs text-[#8B877F]">カテゴリ: {store.category}</p>}

            {/* どの店舗を記録しているかを常に見せる。チェーン店では機械が別の支店を拾っていることがある */}
            <p className="flex flex-wrap items-center gap-2 text-xs text-[#8B877F]">
              <span>
                対象店舗:{" "}
                {data.ownPlaceIdSource === "auto" ? <span className="text-[#8A5340]">自動で特定されました</span> : "選択済み"}
              </span>
              <button
                type="button"
                onClick={() => setDialogOpen(true)}
                className="font-semibold text-[#2E2D29] underline underline-offset-2 transition-colors hover:text-[#8A5340]"
              >
                変更する
              </button>
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-5">
            {store.meoScore != null && (
              <div className="text-right">
                <p className="text-xs font-semibold tracking-wide text-[#8B877F]">MEOスコア</p>
                <p className="disp text-2xl font-black text-[#2E2D29]">
                  {store.meoScore}
                  <span className="ml-0.5 text-xs font-normal text-[#A5A198]">/100</span>
                </p>
              </div>
            )}
            {store.rating != null && (
              <div className="text-right">
                <p className="text-xs font-semibold tracking-wide text-[#8B877F]">クチコミ</p>
                <p className="disp flex items-center justify-end gap-1 text-2xl font-black text-[#2E2D29]">
                  <Icon name="star" filled className="h-4 w-4 text-[#B98A5E]" />
                  {store.rating.toFixed(1)}
                  <span className="text-xs font-normal text-[#A5A198]">/ {store.reviewCount?.toLocaleString() ?? 0}件</span>
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-[#F0EEEA] pt-3 text-xs text-[#8B877F]">
          {unrepliedCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F8F1ED] px-2.5 py-1 font-semibold text-[#A8705A]">
              <Icon name="alert" className="h-3.5 w-3.5" />
              未返信 {unrepliedCount}件
            </span>
          )}
          {store.ratingRank != null && store.competitorCount > 0 && (
            <span>
              エリア内評価順位 {store.ratingRank}位 / {store.competitorCount + 1}店舗
            </span>
          )}
          {store.lastSyncedAt && (
            <span className="inline-flex items-center gap-1.5">
              <Icon name="refresh" className="h-3.5 w-3.5" />
              最終同期 {formatDate(store.lastSyncedAt)}
            </span>
          )}
        </div>
      </div>

      <Dialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title="対象店舗を選ぶ"
        description="クチコミや順位はここで選んだ店舗のものを記録します。同じ系列の別の店舗を選ぶと、集計の対象も切り替わります。"
      >
        <StoreSelectPanel
          analysisId={analysisId}
          initialCandidates={data.storeCandidates}
          currentPlaceId={data.ownPlaceId}
          onSelected={() => setDialogOpen(false)}
        />
      </Dialog>
    </div>
  );
}

function MeoTabNav({ analysisId, badges }: { analysisId: string; badges: Partial<Record<string, number>> }) {
  const pathname = usePathname() ?? "";
  const base = meoPath(analysisId);
  return (
    <nav aria-label="MEO運用メニュー" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0 print:hidden">
      {/* 下線はテーマカラー（ゴールド）。現在地はその濃い方で、線だけを見て場所が分かるようにする */}
      <ul className="flex w-max min-w-full items-center gap-1 border-b-2 border-[#EFE3C4]">
        {MEO_TABS.map((tab) => {
          const href = `${base}${tab.path}`;
          const active = tab.path === "" ? pathname === base : pathname.startsWith(href);
          const badge = badges[tab.key];
          return (
            <li key={tab.key}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-0.5 flex items-center gap-2 whitespace-nowrap border-b-2 px-3.5 py-3 text-sm font-medium transition-colors",
                  active ? "border-[#C9A84C] text-[#2E2D29]" : "border-transparent text-[#6B6862] hover:border-[#E8C97A] hover:text-[#2E2D29]"
                )}
              >
                <Icon name={TAB_ICON[tab.key]} />
                {tab.label}
                {badge != null && badge > 0 && (
                  <span className="rounded-full bg-[#A8705A] px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">{badge}</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// ── 店舗の選択 ────────────────────────────────
function MeoStoreRequired({ analysisId, storeName, candidates }: { analysisId: string; storeName: string; candidates: StoreCandidate[] }) {
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <Link href={`/analysis/${analysisId}/report`} className="inline-flex items-center gap-1.5 text-sm text-[#57544E] transition-colors hover:text-[#2E2D29]">
        <Icon name="arrowLeft" />
        レポートに戻る
      </Link>
      <div className="mx-auto w-full max-w-xl rounded-2xl border border-[#E8E5E0] bg-white p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#F4F3F0]">
            <Icon name="mapPin" className="h-5 w-5 text-[#8A5340]" />
          </div>
          <div className="min-w-0">
            <h1 className="disp text-lg font-bold text-[#2E2D29]">対象の店舗を選んでください</h1>
            <p className="mt-1.5 text-sm leading-relaxed text-[#6B6862]">
              {candidates.length > 0
                ? `${storeName} には複数の店舗が見つかりました。`
                : `${storeName} の店舗をGoogleマップ上で特定できませんでした。`}
              どの店舗を運用するかが決まらないと、クチコミも順位も集計できません。
            </p>
          </div>
        </div>
        <div className="mt-5">
          <StoreSelectPanel analysisId={analysisId} initialCandidates={candidates} />
        </div>
        <p className="mt-4 text-xs leading-relaxed text-[#A5A198]">
          選んだ後に変更することもできます。系列の別店舗に切り替えると、集計の対象も切り替わります。
        </p>
      </div>
    </div>
  );
}

/**
 * 対象店舗を選ぶ本体。チェーン店はサイトが本社ドメインひとつしか無く、URLからは支店を判別できない。
 * 機械が決め打ちすると別の商圏のデータを毎日記録し続けることになるため、人が確定させる。
 */
function StoreSelectPanel({
  analysisId,
  initialCandidates,
  currentPlaceId,
  onSelected,
}: {
  analysisId: string;
  initialCandidates: StoreCandidate[];
  currentPlaceId?: string | null;
  onSelected?: () => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<StoreCandidate[]>(initialCandidates);
  const [error, setError] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [savingPlaceId, setSavingPlaceId] = useState<string | null>(null);
  // 自動検索は1回だけ。件数を条件にすると、利用者の検索が0件だったときに既定の候補で上書きしてしまう
  const autoSearched = useRef(initialCandidates.length > 0);

  const run = (keyword?: string) => {
    setIsSearching(true);
    setError(null);
    searchStoreCandidatesAction(analysisId, keyword)
      .then(setCandidates)
      .catch((e: Error) => setError(e.message))
      .finally(() => setIsSearching(false));
  };

  useEffect(() => {
    if (autoSearched.current) return;
    autoSearched.current = true;
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const select = (placeId: string) => {
    setSavingPlaceId(placeId);
    setError(null);
    selectStoreAction(analysisId, placeId)
      .then(() => {
        onSelected?.();
        router.refresh();
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setSavingPlaceId(null));
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing && query.trim()) run(query.trim());
          }}
          placeholder="店舗名や住所で探す（例: 麺匠 竹虎 六本木）"
        />
        <Btn onClick={() => run(query.trim())} disabled={isSearching || query.trim() === ""} className="shrink-0">
          <Icon name="search" />
          探す
        </Btn>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl bg-[#F8F1ED] p-3">
          <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0 text-[#A8705A]" />
          <p className="text-sm text-[#A8705A]">{error}</p>
        </div>
      )}

      <div className="max-h-72 space-y-2 overflow-y-auto">
        {isSearching && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-[#8B877F]">
            <Icon name="loader" />
            店舗を探しています...
          </div>
        )}
        {!isSearching && candidates.length === 0 && (
          <p className="py-8 text-center text-sm text-[#8B877F]">候補が見つかりませんでした。店舗名や住所を入れて探してみてください。</p>
        )}
        {!isSearching &&
          candidates.map((c) => {
            const isCurrent = c.place_id === currentPlaceId;
            const isSaving = savingPlaceId === c.place_id;
            return (
              <button
                key={c.place_id}
                type="button"
                onClick={() => select(c.place_id)}
                disabled={savingPlaceId !== null}
                className={cn(
                  "flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors disabled:opacity-60",
                  isCurrent ? "border-[#2E2D29] bg-[#F4F3F0]" : "border-[#E8E5E0] bg-white hover:border-[#D8D4CC]"
                )}
              >
                <Icon name="mapPin" className="mt-0.5 h-4 w-4 shrink-0 text-[#A5A198]" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-[#2E2D29]">{c.name || "（名称なし）"}</span>
                  {c.address && <span className="mt-0.5 block text-xs text-[#8B877F]">{c.address}</span>}
                </span>
                {isSaving && <Icon name="loader" className="h-4 w-4 shrink-0 text-[#8B877F]" />}
                {!isSaving && isCurrent && (
                  <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-[#2E2D29]">
                    <Icon name="check" className="h-3.5 w-3.5" />
                    選択中
                  </span>
                )}
              </button>
            );
          })}
      </div>
    </div>
  );
}

// ── ページ共通 ────────────────────────────────
export function MeoPageHeader({ icon, title, description, action }: { icon: string; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#2E2D29] text-white">
          <Icon name={icon} />
        </div>
        <div>
          <h2 className="disp text-lg font-bold text-[#2E2D29]">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-[#8B877F]">{description}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="disp text-sm font-bold text-[#2E2D29]">{children}</h3>;
}
