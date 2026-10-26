"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { AioProjectForm } from "@/components/aio/AioProjectForm";
import { MeoPageHeader } from "@/components/meo/Workspace";
import { Btn, Dialog, cn } from "@/components/meo/ui";
import type { AioProject } from "@/lib/aio/types";

/**
 * SEO運用のワークスペース（2026-10-21 新設）。対象は AIO と同じ「会社（プロジェクト）」で、記事・文体・WordPress 連携を共有する。
 * 対策キーワード（全体レポートから取り込み、書く先と状態と順位を管理）／自社サイト記事（AIO から移設）／サテライトサイト／内部対策（AIO と共通のリスト）／効果と改善
 */
export type SeoTab = "keywords" | "site" | "satellite" | "internal" | "links" | "results";
export const SEO_TABS: { key: SeoTab; label: string; hint: string }[] = [
  { key: "keywords", label: "対策キーワード", hint: "狙う語・書く先・順位" },
  { key: "site", label: "自社サイト記事", hint: "コラムの記事を作って WordPress で公開" },
  { key: "satellite", label: "サテライトサイト", hint: "別ドメインの比較・解説メディア" },
  { key: "internal", label: "内部対策", hint: "自社サイト・LP でやること" },
  { key: "links", label: "内部リンク", hint: "記事どうしのリンクの提案" },
  { key: "results", label: "効果と改善", hint: "Search Console の数字と改善案" },
];

export function SeoWorkspace({ project, tab, children }: { project: AioProject; tab: SeoTab; children: ReactNode }) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="space-y-6">
      <MeoPageHeader
        icon="search"
        title={project.name || "（名称未設定）"}
        description={`「${project.area ? `${project.area}で` : ""}${project.category}」で検索する人に届く記事と、サイトの内部対策を管理する（SEO運用）`}
        action={
          <div className="flex gap-2">
            <Btn variant="outline" size="sm" onClick={() => setEditing(true)}>
              対象の設定
            </Btn>
            <Link href={`/aio/${project.id}`} className="inline-flex h-8 items-center rounded-lg px-3 text-xs text-[#6B6862] hover:bg-[#F4F3F0]">
              AIOへ
            </Link>
            <Link href="/seo" className="inline-flex h-8 items-center rounded-lg px-3 text-xs text-[#6B6862] hover:bg-[#F4F3F0]">
              一覧へ
            </Link>
          </div>
        }
      />
      {editing && (
        <Dialog open={editing} onOpenChange={setEditing} title="対象の設定" className="max-w-2xl">
          <AioProjectForm mode="edit" project={project} onSaved={() => setEditing(false)} />
        </Dialog>
      )}
      <nav className="flex gap-1 overflow-x-auto border-b border-[#E8E5E0]">
        {SEO_TABS.map((t) => (
          <Link
            key={t.key}
            href={`/seo/${project.id}?tab=${t.key}`}
            scroll={false}
            className={cn("shrink-0 border-b-2 px-3 pb-2 pt-1 text-sm", tab === t.key ? "border-[#2E2D29] font-semibold text-[#2E2D29]" : "border-transparent text-[#8B877F] hover:text-[#2E2D29]")}
          >
            {t.label}
            <span className="ml-1.5 hidden text-[10px] font-normal text-[#A5A198] lg:inline">{t.hint}</span>
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
