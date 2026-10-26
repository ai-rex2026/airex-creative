"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { buildLinkCandidatesAction, collectLinkBatchAction, judgeLinkBatchAction, retryLinkPagesAction, setLinkSuggestionAction, startLinkCollectAction } from "@/app/seo-link-actions";
import { SectionTitle } from "@/components/meo/Workspace";
import { Btn, Card, ErrorNote, Icon } from "@/components/meo/ui";
import { LinkGraph } from "@/components/seo/LinkGraph";
import { ACCEPT_CONFIDENCE, ACCEPT_PROBABILITY } from "@/lib/seo/links/judge";
import { inOutCounts, type Edge } from "@/lib/seo/links/text";
import type { LinkPageView, LinkSuggestionView } from "@/lib/seo/links/store";
import type { AioProject } from "@/lib/aio/types";

/**
 * 内部リンクの提案（2026-10-27）。記事を集める → 通常のコードで候補を絞る → AI が「本当にリンクすべきか」だけを判定する。
 * 設置は人が行う（本文は自動で書き換えない）。確率と確信度は AI の自己申告で、実測ではない
 */
export function LinksPanel({ project, pages, suggestions }: { project: AioProject; pages: LinkPageView[]; suggestions: LinkSuggestionView[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [view, setView] = useState<"before" | "after">("after");

  const read = pages.filter((p) => p.fetched);
  const failed = pages.filter((p) => !p.fetched && p.error);
  const list = suggestions.filter((s) => s.status === "suggested" || s.status === "accepted" || s.status === "dismissed");
  const pending = suggestions.filter((s) => s.status === "pending").length;

  const urls = read.map((p) => p.url);
  const index = new Map(urls.map((u, i) => [u, i + 1]));
  const titleOf = new Map(pages.map((p) => [p.url, p.title]));
  const existing: Edge[] = read.flatMap((p) => p.links.filter((l) => index.has(l)).map((to) => ({ from: p.url, to })));
  const added: Edge[] = list.filter((s) => s.status !== "dismissed" && index.has(s.from) && index.has(s.to)).map((s) => ({ from: s.from, to: s.to }));
  const before = inOutCounts(urls, existing);
  const after = inOutCounts(urls, [...existing, ...added]);
  const orphanBefore = urls.filter((u) => (before.get(u)?.in ?? 0) === 0).length;
  const orphanAfter = urls.filter((u) => (after.get(u)?.in ?? 0) === 0).length;

  const run = async () => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      setStep("記事を集めています");
      const s = await startLinkCollectAction(project.id);
      if (!s.ok) throw new Error(s.error);
      const notes = [...s.notes];

      // 未読の記事を数件ずつ読む。1回ごとに保存されるので、途中で閉じても続きから再開できる
      for (let guard = 0; guard < 60; guard++) {
        setStep("記事を読んでいます");
        const r = await collectLinkBatchAction(project.id);
        if (!r.ok) throw new Error(r.error);
        if (r.remaining === 0) break;
        if (r.done === 0 && r.failed === 0) break;
      }

      setStep("リンクの候補を絞っています");
      const b = await buildLinkCandidatesAction(project.id);
      if (!b.ok) throw new Error(b.error);
      if (b.docs < 2) notes.push("本文を読めた記事が2件に満たないため、候補を作れません");

      // 未判定の組を数件ずつ判定する。判定できた分は1組ごとに保存される
      let adopted = 0;
      for (let guard = 0; guard < 80; guard++) {
        setStep("リンクすべきかを判定しています");
        const j = await judgeLinkBatchAction(project.id);
        if (!j.ok) throw new Error(j.error);
        adopted += j.adopted;
        if (j.remaining === 0) break;
        if (j.judged === 0) {
          notes.push(`判定が進まなかったため止めました${j.error ? `（${j.error}）` : ""}。もう一度押すと続きから行います`);
          break;
        }
      }
      setInfo(`今回 ${adopted} 件のリンクを提案しました${notes.length ? `（${notes.join(" / ")}）` : ""}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "分析できませんでした");
    } finally {
      setBusy(false);
      setStep("");
      router.refresh();
    }
  };

  const mark = async (id: string, status: "suggested" | "accepted" | "dismissed") => {
    const r = await setLinkSuggestionAction(project.id, id, status);
    if (!r.ok) return setError(r.error);
    router.refresh();
  };
  const copy = async (s: LinkSuggestionView) => {
    const text = `【内部リンクの追加】\n記事：${titleOf.get(s.from) ?? s.from}\n${s.from}\n\n本文の次の文の「${s.anchor}」に、次のページへのリンクを張る\n文：${s.sentence}\nリンク先：${titleOf.get(s.to) ?? s.to}\n${s.to}`;
    try {
      await navigator.clipboard.writeText(text);
      setInfo("作業メモをコピーしました");
    } catch {
      setError("コピーできませんでした。手で選択してください");
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <SectionTitle>内部リンクの提案</SectionTitle>
            <p className="mt-1 text-xs leading-relaxed text-[#8B877F]">
              サイト（{project.url ?? "URL 未設定"}）の記事の本文と既存のリンクを読み、「この記事からこの記事へリンクを張るとよい」箇所と、使う語句（アンカー）を提案します。
              記事の組み合わせはコードで絞り、「本当にリンクすべきか」だけを AI が判定します。本文は自動では書き換えません。リンクを入れるのは人が行います。
            </p>
          </div>
          <Btn className="shrink-0" disabled={busy || !project.url} onClick={run}>
            {busy ? <Icon name="loader" /> : <Icon name="link" className="h-4 w-4" />}
            {busy ? step : pages.length ? "続きから分析する" : "分析する"}
          </Btn>
        </div>
        {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
        {info && <p className="mt-3 rounded-xl bg-[#F6EFD9] px-3 py-2 text-xs text-[#6E5518]">{info}</p>}
        {busy && <p className="mt-3 text-xs text-[#8B877F]">この画面を開いたままにしてください。1件ずつ保存するので、閉じても続きから再開できます。</p>}

        {pages.length > 0 && (
          <dl className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
            <Stat label="読めた記事" value={`${read.length} / ${pages.length}`} />
            <Stat label="判定待ちの組" value={String(pending)} />
            <Stat label="提案されたリンク" value={String(list.filter((s) => s.status !== "dismissed").length)} />
            <Stat label="リンクされていない記事" value={`${orphanBefore} → ${orphanAfter}`} />
          </dl>
        )}
        {failed.length > 0 && (
          <p className="mt-3 text-xs text-[#6B6862]">
            読めなかった記事が {failed.length} 件あります（{failed[0].error}など）。
            <button type="button" className="ml-1 underline" onClick={async () => { await retryLinkPagesAction(project.id); router.refresh(); }}>
              もう一度読む対象に戻す
            </button>
          </p>
        )}
      </Card>

      {read.length >= 2 && (
        <Card>
          <div className="flex items-center justify-between gap-3">
            <SectionTitle>リンク構造の現在と改善後</SectionTitle>
            <div className="flex gap-1 text-xs">
              {(["before", "after"] as const).map((v) => (
                <button key={v} type="button" onClick={() => setView(v)} className={`rounded-md border px-3 py-1 ${view === v ? "border-[#2E2D29] bg-[#2E2D29] text-white" : "border-[#E5E2DC] bg-white text-[#6B6862]"}`}>
                  {v === "before" ? "現在" : "改善後（提案を入れた場合）"}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-3 grid gap-4 md:grid-cols-[minmax(0,420px)_1fr]">
            <div>
              <LinkGraph urls={urls} existing={existing} added={view === "after" ? added : []} />
              <p className="mt-2 text-[11px] leading-relaxed text-[#8B877F]">灰色の線＝いまあるリンク／金色の線＝提案するリンク／二重の輪＝どこからもリンクされていない記事。番号は右の一覧と同じです。</p>
            </div>
            <div className="max-h-[420px] overflow-auto">
              <table className="w-full min-w-[420px] text-xs">
                <thead>
                  <tr className="border-b border-[#E5E2DC] text-left text-[10px] text-[#8B877F]">
                    <th className="py-1.5 pr-2 font-normal">#</th>
                    <th className="px-2 font-normal">記事</th>
                    <th className="px-2 text-right font-normal">被リンク</th>
                    <th className="pl-2 text-right font-normal">発リンク</th>
                  </tr>
                </thead>
                <tbody>
                  {urls.map((u, i) => {
                    const b = before.get(u)!;
                    const a = after.get(u)!;
                    return (
                      <tr key={u} className="border-b border-[#F4F3F0]">
                        <td className="py-1.5 pr-2 text-[#8B877F]">{i + 1}</td>
                        <td className="px-2 text-[#2E2D29]"><a href={u} target="_blank" rel="noreferrer" className="hover:underline">{titleOf.get(u)}</a></td>
                        <td className="px-2 text-right tabular-nums">{b.in}{a.in !== b.in && <span className="font-bold text-[#9A7A2A]"> → {a.in}</span>}</td>
                        <td className="pl-2 text-right tabular-nums">{b.out}{a.out !== b.out && <span className="font-bold text-[#9A7A2A]"> → {a.out}</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </Card>
      )}

      <Card>
        <SectionTitle>提案されたリンク</SectionTitle>
        <p className="mt-1 text-xs leading-relaxed text-[#8B877F]">
          推奨の確率が {Math.round(ACCEPT_PROBABILITY * 100)}% 以上で、確信度が {Math.round(ACCEPT_CONFIDENCE * 100)}% 以上のものだけを出しています。どちらも AI の自己申告で、実測した値ではありません。
          リンクを入れたら「入れた」、見送るなら「見送り」を押してください（記録のみで、サイトは変わりません）。
        </p>
        <div className="mt-3 space-y-3">
          {list.length === 0 ? (
            <p className="rounded-xl border border-dashed border-[#D8D4CC] p-6 text-center text-xs text-[#8B877F]">{pages.length ? "基準を満たす提案はまだありません" : "まだ分析していません。「分析する」を押してください"}</p>
          ) : (
            list.map((s) => (
              <div key={s.id} className={`rounded-xl border p-4 ${s.status === "dismissed" ? "border-[#EEECE7] bg-[#FAFAF7] opacity-70" : "border-[#E5E2DC] bg-white"}`}>
                <div className="flex flex-wrap items-center gap-2 text-xs text-[#6B6862]">
                  <span className="font-semibold text-[#2E2D29]">{titleOf.get(s.from) ?? s.from}</span>
                  <Icon name="arrowRight" className="h-3.5 w-3.5" />
                  <span className="font-semibold text-[#2E2D29]">{titleOf.get(s.to) ?? s.to}</span>
                  {s.status === "accepted" && <span className="rounded-md bg-[#F6EFD9] px-2 py-0.5 text-[#6E5518]">入れた</span>}
                  {s.status === "dismissed" && <span className="rounded-md bg-[#EEECE7] px-2 py-0.5">見送り</span>}
                </div>
                <p className="mt-2 text-sm leading-relaxed text-[#2E2D29]">
                  <Highlight sentence={s.sentence} anchor={s.anchor} />
                </p>
                <p className="mt-1 text-[11px] text-[#8B877F]">
                  アンカー：<b className="text-[#2E2D29]">{s.anchor}</b>／役割：{s.role}／確率 {pct(s.probability)}・確信度 {pct(s.confidence)}（AI の自己申告）
                </p>
                {s.reason && <p className="mt-1 text-[11px] text-[#6B6862]">{s.reason}</p>}
                <div className="mt-2 flex flex-wrap gap-2">
                  <Btn size="sm" variant="outline" onClick={() => copy(s)}>作業メモをコピー</Btn>
                  {s.status !== "accepted" && <Btn size="sm" onClick={() => mark(s.id, "accepted")}>入れた</Btn>}
                  {s.status !== "dismissed" && <Btn size="sm" variant="outline" onClick={() => mark(s.id, "dismissed")}>見送り</Btn>}
                  {s.status !== "suggested" && <Btn size="sm" variant="ghost" onClick={() => mark(s.id, "suggested")}>元に戻す</Btn>}
                </div>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}

const pct = (n: number | null) => (n == null ? "–" : `${Math.round(n * 100)}%`);

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#E5E2DC] px-3 py-2">
      <dt className="text-[10px] text-[#8B877F]">{label}</dt>
      <dd className="mt-0.5 text-sm font-bold tabular-nums text-[#2E2D29]">{value}</dd>
    </div>
  );
}

function Highlight({ sentence, anchor }: { sentence: string; anchor: string }) {
  const i = anchor ? sentence.indexOf(anchor) : -1;
  if (i < 0) return <>{sentence}</>;
  return (
    <>
      {sentence.slice(0, i)}
      <mark className="bg-[#F6EFD9] px-0.5 text-[#6E5518] underline decoration-[#C9A84C] underline-offset-4">{anchor}</mark>
      {sentence.slice(i + anchor.length)}
    </>
  );
}
