"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { runCitationCheckAction } from "@/app/meo-actions";
import { MeoPageHeader, SectionTitle, useMeo } from "@/components/meo/Workspace";
import { Btn, Card, ErrorNote, Icon, cn } from "@/components/meo/ui";
import type { CitationCheck, CitationSource } from "@/lib/meo-ops/citations";

const STATUS: Record<CitationSource["status"], [string, string]> = {
  match: ["一致", "bg-[#EAF3EE] text-[#2F6B4A]"],
  mismatch: ["ずれあり", "bg-[#FBEDE9] text-[#A8705A]"],
  partial: ["一部のみ", "bg-[#FBF4E4] text-[#8A6A1E]"],
  missing: ["未掲載", "bg-[#F4F3F0] text-[#8B877F]"],
};

/**
 * 情報の一貫性（サイテーション）。基準は Google（Places）の情報。
 * 各媒体の掲載を AI が集めて比べ、ずれを一覧にする。直すのは人（各媒体の管理画面）。
 */
export function CitationCheckView({ storeId, checks, remaining, limit }: { storeId: string; checks: CitationCheck[]; remaining: number; limit: number }) {
  const { data } = useMeo();
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = checks.find((c) => c.status === "completed") ?? null;
  const lastFailed = checks[0]?.status === "failed" ? checks[0] : null;

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      await runCitationCheckAction(storeId);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "確認できませんでした");
    } finally {
      setRunning(false);
    }
  };

  const mismatches = latest ? latest.sources.filter((s) => s.status === "mismatch" || s.status === "partial") : [];
  const missing = latest ? latest.sources.filter((s) => s.status === "missing") : [];

  return (
    <div className="space-y-6">
      <MeoPageHeader icon="checkCircle" title="情報の一貫性" description="公式サイト・各媒体に載っている店名／住所／電話／営業時間が、Googleの情報と同じかを確認します。ずれが無く最新であることが評価の安定につながります" />

      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <SectionTitle>基準（Googleビジネスプロフィール）</SectionTitle>
            <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              <div><dt className="inline text-[#8B877F]">店名：</dt><dd className="inline text-[#2E2D29]">{data.store.name}</dd></div>
              <div><dt className="inline text-[#8B877F]">電話：</dt><dd className="inline text-[#2E2D29]">{data.store.phoneNumber ?? "（未取得）"}</dd></div>
              <div className="sm:col-span-2"><dt className="inline text-[#8B877F]">住所：</dt><dd className="inline text-[#2E2D29]">{data.store.address ?? "（未取得）"}</dd></div>
              <div className="sm:col-span-2"><dt className="inline text-[#8B877F]">公式サイト：</dt><dd className="inline text-[#2E2D29]">{data.store.websiteUrl ?? "（未取得）"}</dd></div>
            </dl>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <Btn onClick={run} disabled={running || remaining <= 0}>
              {running ? <Icon name="loader" /> : <Icon name="search" />}
              {running ? "確認中（2〜3分）" : "各媒体の掲載を確認する"}
            </Btn>
            <span className="text-[11px] text-[#8B877F]">今月あと {remaining} / {limit} 回（web検索つきのAI問い合わせ）</span>
          </div>
        </div>
        {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
        {!error && lastFailed && !latest && <div className="mt-3"><ErrorNote>前回は失敗しました：{lastFailed.errorMessage}</ErrorNote></div>}
      </Card>

      {latest ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Tile label="確認した媒体" value={`${latest.sources.filter((s) => s.status !== "missing").length} 件`} />
            <Tile label="ずれ・不足" value={`${mismatches.length} 件`} tone={mismatches.length ? "ng" : "ok"} />
            <Tile label="未掲載の媒体" value={`${missing.length} 件`} tone={missing.length ? "warn" : "ok"} />
          </div>
          <Card>
            <p className="text-xs text-[#8B877F]">{new Date(latest.createdAt).toLocaleString("ja-JP")} 確認（{latest.engine}）</p>
            {latest.summary && <p className="mt-1 text-sm leading-relaxed text-[#2E2D29]">{latest.summary}</p>}
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-[#8B877F]">
                    <th className="py-2 pr-3 font-medium">媒体</th>
                    <th className="py-2 pr-3 font-medium">判定</th>
                    <th className="py-2 pr-3 font-medium">住所</th>
                    <th className="py-2 pr-3 font-medium">電話</th>
                    <th className="py-2 pr-3 font-medium">営業時間</th>
                    <th className="py-2 pr-3 font-medium">ずれ・やること</th>
                  </tr>
                </thead>
                <tbody>
                  {latest.sources.map((s, i) => {
                    const [t, cls] = STATUS[s.status];
                    return (
                      <tr key={i} className="border-t border-[#F0EDE8] align-top">
                        <td className="py-2 pr-3 whitespace-nowrap">
                          {s.url ? <a href={s.url} target="_blank" rel="noreferrer" className="text-[#2E2D29] underline">{s.name}</a> : <span className="text-[#2E2D29]">{s.name}</span>}
                        </td>
                        <td className="py-2 pr-3"><span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold", cls)}>{t}</span></td>
                        <td className="py-2 pr-3 text-xs text-[#6B6862]">{s.address ?? "–"}</td>
                        <td className="py-2 pr-3 text-xs text-[#6B6862] whitespace-nowrap">{s.phone ?? "–"}</td>
                        <td className="py-2 pr-3 text-xs text-[#6B6862]">{s.hours ?? "–"}</td>
                        <td className="py-2 pr-3 text-xs text-[#2E2D29]">
                          {s.issues.length ? <ul className="list-disc pl-4">{s.issues.map((x, j) => <li key={j}>{x}</li>)}</ul> : s.status === "missing" ? "登録を検討（この媒体の管理画面から）" : "–"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-[#A5A198]">※ web 検索つきの AI が集めた掲載内容をもとに照合しています。見落としや読み違いがあり得るので、修正の前に各媒体のページで実際の表示を確認してください。修正は各媒体の管理画面から行います（このツールからは書き換えません）。</p>
          </Card>
          {checks.filter((c) => c.status === "completed").length > 1 && (
            <p className="text-xs text-[#8B877F]">
              これまでの確認：{checks.filter((c) => c.status === "completed").map((c) => `${new Date(c.createdAt).toLocaleDateString("ja-JP")}（ずれ ${c.sources.filter((s) => s.status === "mismatch" || s.status === "partial").length}件）`).join("、")}
            </p>
          )}
        </>
      ) : (
        !lastFailed && (
          <Card className="border-dashed text-center">
            <Icon name="checkCircle" className="mx-auto h-8 w-8 text-[#C7C3BA]" />
            <p className="mt-3 text-sm font-medium text-[#2E2D29]">まだ確認していません</p>
            <p className="mt-1 text-sm text-[#8B877F]">上のボタンから、各媒体の掲載情報を集めて Google の情報と照合します</p>
          </Card>
        )
      )}
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: "ok" | "ng" | "warn" }) {
  return (
    <div className="rounded-2xl border border-[#E8E5E0] bg-white p-4">
      <p className="text-[11px] text-[#8B877F]">{label}</p>
      <p className={cn("mt-0.5 text-xl font-black", tone === "ok" ? "text-[#2F6B4A]" : tone === "ng" ? "text-[#A8705A]" : tone === "warn" ? "text-[#8A6A1E]" : "text-[#2E2D29]")}>{value}</p>
    </div>
  );
}
