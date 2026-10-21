"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { addKeywordAction, deleteKeywordAction, estimateKeywordVolumesAction, importReportKeywordsAction, syncKeywordGscAction, updateKeywordAction } from "@/app/seo-keyword-actions";
import { SectionTitle } from "@/components/meo/Workspace";
import { Btn, Card, ErrorNote, Icon, Input, Label, Select, cn } from "@/components/meo/ui";
import { adviceFor, KW_SOURCE_LABEL, KW_STATUS_LABEL, moreThanEstimate, sortKeywords, TARGET_LABEL, type KwKind, type KwPriority, type KwStatus, type KwTarget, type SeoKeyword } from "@/lib/seo/keywords";
import type { AioProject } from "@/lib/aio/types";

type Fail = { ok: false; error: string };

/**
 * SEO運用の「対策キーワード」タブ（2026-10-21 新設）。
 * 全体レポートの対策キーワード・SEO記事設計を取り込み、書く先（自社サイト／サテライト／既存ページ）と状態を管理し、
 * Search Console の実測（表示・クリック・平均順位）で進み具合を見る。月間検索数は AI の推定（実測ではない）
 */
export function KeywordsPanel({ project, keywords, articles, googleConnected, hasSatellite }: { project: AioProject; keywords: SeoKeyword[]; articles: { id: string; title: string; publishedUrl: string | null; publishedAt: string | null; createdAt: string; channel: string }[]; googleConnected: boolean; hasSatellite: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [form, setForm] = useState<{ keyword: string; kind: KwKind; priority: KwPriority; target: KwTarget }>({ keyword: "", kind: "一般", priority: "中", target: "site" });
  const [showClosed, setShowClosed] = useState(false);

  const run = async <T extends { ok: true }>(key: string, fn: () => Promise<T | Fail>, msg?: (r: T) => string) => {
    setBusy(key);
    setError(null);
    setInfo(null);
    const r = await fn();
    setBusy(null);
    if (!r.ok) return setError((r as Fail).error);
    if (msg) setInfo(msg(r as T));
    router.refresh();
  };

  const byId = new Map(articles.map((a) => [a.id, a]));
  const dates = Object.fromEntries(articles.map((a) => [a.id, a.publishedAt ?? a.createdAt]));
  const sorted = sortKeywords(keywords);
  const open = sorted.filter((k) => k.status !== "skip" && k.status !== "published");
  const done = sorted.filter((k) => k.status === "published" || k.status === "skip");
  const noVolume = keywords.filter((k) => !k.volume && k.status !== "skip").length;

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <SectionTitle>対策キーワード（{keywords.length}語）</SectionTitle>
            <p className="mt-1 text-xs leading-relaxed text-[#8B877F]">
              狙う語を決めて、自社サイト記事・サテライトサイトで書き、Search Console の実測で順位を見ます。月間検索数は AI の<b>推定</b>（5段階・実測ではありません）で、優先順位の目安にだけ使います。
              表示・クリック・平均順位は Search Console の実測（直近28日）です。
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Btn variant="outline" size="sm" disabled={busy !== null} onClick={() => run("import", () => importReportKeywordsAction(project.id), (r) => (r.from ? `全体レポート（${new Date(r.from).toLocaleDateString("ja-JP")}）から${r.added}語を取り込みました` : "同じドメインの全体レポートが見つかりませんでした。先に全体レポートを作ると取り込めます"))}>
              {busy === "import" ? <Icon name="loader" /> : null}全体レポートから取り込む
            </Btn>
            {googleConnected ? (
              <Btn variant="outline" size="sm" disabled={busy !== null || !keywords.length && !project.url} onClick={() => run("gsc", () => syncKeywordGscAction(project.id), (r) => `${r.matched}語に Search Console の数字を反映し、候補を${r.added}語足しました${r.notes.length ? `（${r.notes.join(" / ")}）` : ""}`)}>
                {busy === "gsc" ? <Icon name="loader" /> : null}Search Console を反映
              </Btn>
            ) : (
              <Link href="/settings" className="inline-flex h-8 items-center rounded-lg border border-[#E0DBD1] px-3 text-xs text-[#2E2D29] hover:bg-[#FAF9F7]">設定で Google を連携</Link>
            )}
            <Btn variant="outline" size="sm" disabled={busy !== null || noVolume === 0} onClick={() => run("vol", () => estimateKeywordVolumesAction(project.id), (r) => `${r.estimated}語の月間検索数を推定しました（推定です）`)}>
              {busy === "vol" ? <Icon name="loader" /> : null}検索数を推定（AI・{noVolume}語）
            </Btn>
          </div>
        </div>
        {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
        {info && <p className="mt-3 rounded-xl bg-[#EAF3EE] px-3 py-2 text-xs text-[#2F6B4A]">{info}</p>}

        {keywords.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-[#D8D4CC] p-6 text-center text-xs text-[#8B877F]">まだキーワードがありません。「全体レポートから取り込む」か、下から足してください</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <Table rows={open} project={project} busy={busy} run={run} byId={byId} dates={dates} hasSatellite={hasSatellite} />
            {done.length > 0 && (
              <div className="mt-3">
                <button type="button" className="text-xs text-[#6B6862] underline" onClick={() => setShowClosed(!showClosed)}>
                  公開済み・対象外（{done.length}語）を{showClosed ? "閉じる" : "見る"}
                </button>
                {showClosed && <div className="mt-2"><Table rows={done} project={project} busy={busy} run={run} byId={byId} dates={dates} hasSatellite={hasSatellite} /></div>}
              </div>
            )}
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle>キーワードを足す</SectionTitle>
        <div className="mt-3 grid gap-3 sm:grid-cols-[2fr_1fr_1fr_1fr_auto] sm:items-end">
          <div>
            <Label>キーワード</Label>
            <Input value={form.keyword} onChange={(e) => setForm({ ...form, keyword: e.target.value })} placeholder="例：〇〇 費用 相場" />
          </div>
          <div>
            <Label>種類</Label>
            <Select value={form.kind} onChange={(v) => setForm({ ...form, kind: v as KwKind })} options={(["一般", "比較", "地域", "指名"] as const).map((k) => ({ value: k, label: k }))} />
          </div>
          <div>
            <Label>優先度</Label>
            <Select value={form.priority} onChange={(v) => setForm({ ...form, priority: v as KwPriority })} options={(["最高", "高", "中", "低"] as const).map((k) => ({ value: k, label: k }))} />
          </div>
          <div>
            <Label>書く先</Label>
            <Select value={form.target} onChange={(v) => setForm({ ...form, target: v as KwTarget })} options={(["site", "satellite", "existing"] as const).map((k) => ({ value: k, label: TARGET_LABEL[k] }))} />
          </div>
          <Btn disabled={busy !== null || !form.keyword.trim()} onClick={() => run("add", async () => { const r = await addKeywordAction(project.id, form); if (r.ok) setForm({ ...form, keyword: "" }); return r; })}>
            足す
          </Btn>
        </div>
      </Card>
    </div>
  );
}

function Trend({ k }: { k: SeoKeyword }) {
  const pts = k.gsc.slice(0, 4).reverse();
  if (!pts.length) return <span className="text-[#A5A198]">–</span>;
  return (
    <span className="whitespace-nowrap">
      {pts.map((p, i) => {
        const prev = pts[i - 1];
        const up = prev ? p.position < prev.position : null;
        return (
          <span key={p.to} className={cn(i > 0 && "ml-1", up === true && "text-[#2F6B4A]", up === false && "text-[#A0472F]")} title={`${p.to} 時点の直近28日`}>
            {i > 0 ? (up ? "↑" : up === false ? "↓" : "→") : ""}
            {p.position}
          </span>
        );
      })}
    </span>
  );
}

function Table({
  rows,
  project,
  busy,
  run,
  byId,
  dates,
  hasSatellite,
}: {
  rows: SeoKeyword[];
  project: AioProject;
  busy: string | null;
  run: <T extends { ok: true }>(key: string, fn: () => Promise<T | Fail>, msg?: (r: T) => string) => Promise<void>;
  byId: Map<string, { id: string; title: string; publishedUrl: string | null; channel: string }>;
  dates: Record<string, string>;
  hasSatellite: boolean;
}) {
  return (
    <table className="w-full min-w-[920px] text-xs">
      <thead>
        <tr className="border-b border-[#E8E5E0] text-left text-[10px] text-[#8B877F]">
          <th className="py-1.5 pr-2 font-normal">キーワード</th>
          <th className="px-2 font-normal">優先度</th>
          <th className="px-2 font-normal">月間検索数（推定）</th>
          <th className="px-2 text-right font-normal">表示</th>
          <th className="px-2 text-right font-normal">クリック</th>
          <th className="px-2 font-normal">平均順位の推移</th>
          <th className="px-2 font-normal">書く先</th>
          <th className="px-2 font-normal">状態</th>
          <th className="pl-2 font-normal" />
        </tr>
      </thead>
      <tbody>
        {rows.map((k) => {
          const last = k.gsc[0];
          const advice = adviceFor(k, dates);
          const tab = k.target === "satellite" ? "satellite" : "site";
          return (
            <tr key={k.id} className="border-b border-[#F4F3F0] align-top">
              <td className="max-w-[260px] py-2 pr-2">
                <b className="text-[#2E2D29]">{k.keyword}</b>
                <span className="ml-1 rounded-full bg-[#F4F3F0] px-1.5 text-[9px] text-[#6B6862]">{k.kind}</span>
                <p className="mt-0.5 text-[10px] text-[#A5A198]">{KW_SOURCE_LABEL[k.source]}{k.action ? `：${k.action}` : ""}</p>
                {k.articleIds.length > 0 && (
                  <p className="mt-0.5 text-[10px] text-[#6B6862]">
                    記事：
                    {k.articleIds.map((id, i) => {
                      const a = byId.get(id);
                      if (!a) return null;
                      return (
                        <span key={id}>
                          {i > 0 ? "／" : ""}
                          {a.publishedUrl ? <a className="underline" href={a.publishedUrl} target="_blank" rel="noreferrer">{a.title.slice(0, 24)}</a> : <Link className="underline" href={`/seo/${project.id}?tab=${a.channel === "satellite" ? "satellite" : "site"}`}>{a.title.slice(0, 24)}（下書き）</Link>}
                        </span>
                      );
                    })}
                  </p>
                )}
                {advice && <p className={cn("mt-1 rounded-lg px-2 py-1 text-[10px] leading-relaxed", k.articleIds.length > 1 ? "bg-[#FBEDE9] text-[#A0472F]" : "bg-[#FBF4E4] text-[#8A6A1E]")}>{advice}</p>}
              </td>
              <td className="px-2 py-2">
                <Select value={k.priority} onChange={(v) => run(`p:${k.id}`, () => updateKeywordAction(project.id, k.id, { priority: v as KwPriority }))} options={(["最高", "高", "中", "低"] as const).map((p) => ({ value: p, label: p }))} />
              </td>
              <td className="px-2 py-2">
                {k.volume ? (
                  <span>
                    {k.volume}
                    <span className="ml-1 text-[9px] text-[#A5A198]">推定{k.volumeSource === "report" ? "（レポート）" : ""}</span>
                  </span>
                ) : (
                  <span className="text-[#A5A198]">未推定</span>
                )}
                {moreThanEstimate(k) && <p className="mt-0.5 text-[10px] text-[#2F6B4A]">実測の表示が推定より多い</p>}
              </td>
              <td className="px-2 py-2 text-right">{last?.impressions ?? "–"}</td>
              <td className="px-2 py-2 text-right">{last?.clicks ?? "–"}</td>
              <td className="px-2 py-2"><Trend k={k} /></td>
              <td className="px-2 py-2">
                <Select
                  value={k.target}
                  onChange={(v) => run(`t:${k.id}`, () => updateKeywordAction(project.id, k.id, { target: v as KwTarget }))}
                  options={(["site", "satellite", "existing"] as const).filter((t) => hasSatellite || t !== "satellite" || k.target === "satellite").map((t) => ({ value: t, label: TARGET_LABEL[t] }))}
                />
              </td>
              <td className="px-2 py-2">
                <Select value={k.status} onChange={(v) => run(`s:${k.id}`, () => updateKeywordAction(project.id, k.id, { status: v as KwStatus }))} options={(["todo", "writing", "published", "skip"] as const).map((s) => ({ value: s, label: KW_STATUS_LABEL[s] }))} />
              </td>
              <td className="whitespace-nowrap py-2 pl-2 text-right">
                {k.target !== "existing" && k.status !== "skip" && (
                  <Link href={`/seo/${project.id}?tab=${tab}&kw=${k.id}`} className="mr-2 text-[11px] text-[#2E2D29] underline">この語で書く</Link>
                )}
                <button type="button" className="text-[10px] text-[#A5A198] underline" disabled={busy !== null} onClick={() => confirm(`「${k.keyword}」を消しますか？`) && run(`d:${k.id}`, () => deleteKeywordAction(project.id, k.id))}>
                  消す
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
