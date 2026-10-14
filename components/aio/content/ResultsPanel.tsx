"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { addAioNoteMetricsAction, fetchAioSiteMetricsAction, reviewAioChannelAction } from "@/app/aio-content-actions";
import { SectionTitle } from "@/components/meo/Workspace";
import { Btn, Card, ErrorNote, Icon, Input, Label, Select, Textarea, cn } from "@/components/meo/ui";
import { PhaseNote, useArticleMaker } from "@/components/aio/content/useArticleMaker";
import type { AioArticle, AioChannel, AioChannelKind, AioContentReview, AioMetric } from "@/lib/aio/content-types";
import type { AioProject } from "@/lib/aio/types";

/**
 * 効果と改善：記事ごとの数字（自社サイト＝Search Console・GA4／note＝手入力・貼り付け）→ 改善案（直す記事・次に書く記事）。
 * 数字は取得・入力した値をそのまま見せ、改善案は見立てとして出す（効果は約束しない）
 */
export function ResultsPanel({
  project,
  channels,
  articles,
  metrics,
  reviews,
  googleConnected,
}: {
  project: AioProject;
  channels: Partial<Record<AioChannelKind, AioChannel>>;
  articles: AioArticle[];
  metrics: AioMetric[];
  reviews: Partial<Record<AioChannelKind, AioContentReview>>;
  googleConnected: boolean;
}) {
  return (
    <div className="space-y-6">
      <SiteResults project={project} channel={channels.site ?? null} metrics={metrics.filter((m) => m.channel === "site")} review={reviews.site ?? null} googleConnected={googleConnected} articles={articles.filter((a) => a.channel === "site")} />
      <NoteResults project={project} metrics={metrics.filter((m) => m.channel === "note")} review={reviews.note ?? null} articles={articles.filter((a) => a.channel === "note")} />
    </div>
  );
}

/** 同じ記事の数字は直近の取得分だけを見せる */
function latestByPage(ms: AioMetric[]) {
  const seen = new Map<string, AioMetric>();
  for (const m of ms) {
    const k = (m.url || m.title).replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, "");
    if (!seen.has(k)) seen.set(k, m);
  }
  return [...seen.values()];
}

function useRun() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<string | void>) => {
    setBusy(key);
    setError(null);
    setInfo(null);
    try {
      const msg = await fn();
      if (msg) setInfo(msg);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy(null);
    }
  };
  return { busy, error, info, run };
}

function SiteResults({ project, channel, metrics, review, googleConnected, articles }: { project: AioProject; channel: AioChannel | null; metrics: AioMetric[]; review: AioContentReview | null; googleConnected: boolean; articles: AioArticle[] }) {
  const { busy, error, info, run } = useRun();
  const rows = useMemo(() => latestByPage(metrics).sort((a, b) => (b.impressions ?? b.views ?? 0) - (a.impressions ?? a.views ?? 0)), [metrics]);
  const mine = new Set(articles.map((a) => a.id));
  const last = metrics[0];

  return (
    <Card>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <SectionTitle>自社サイトのコラム：記事ごとの数字（直近28日）</SectionTitle>
          <p className="mt-1 text-xs text-[#8B877F]">Search Console（表示・クリック・順位・検索語）と GA4（閲覧数・滞在時間）を、コラムのURLの下にある記事に絞って取り込みます</p>
        </div>
        {googleConnected ? (
          <Btn onClick={() => run("fetch", async () => { const r = await fetchAioSiteMetricsAction(project.id); return `${r.pages}ページ分を取り込みました${r.notes.length ? `（${r.notes.join(" / ")}）` : ""}`; })} disabled={busy !== null} className="shrink-0">
            {busy === "fetch" ? <Icon name="loader" /> : <Icon name="refresh" className="h-4 w-4" />}
            {busy === "fetch" ? "取り込み中" : "数字を取り込む"}
          </Btn>
        ) : (
          <a href="/settings" className="inline-flex h-10 shrink-0 items-center rounded-lg border border-[#E0DBD1] px-4 text-sm text-[#2E2D29] hover:bg-[#FAF9F7]">設定で Google を連携する</a>
        )}
      </div>
      {channel?.analytics?.pathPrefix && <p className="mt-2 text-[11px] text-[#A5A198]">対象：{channel.analytics.pathPrefix} の下・{channel.analytics.gscSite ?? "Search Console 未検出"}・{channel.analytics.ga4Property ?? "GA4 未検出"}{last ? `・取得 ${new Date(last.createdAt).toLocaleDateString("ja-JP")}` : ""}</p>}
      {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
      {info && <p className="mt-3 rounded-xl bg-[#EAF3EE] px-3 py-2 text-xs text-[#2F6B4A]">{info}</p>}

      {rows.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-xs">
            <thead>
              <tr className="border-b border-[#E8E5E0] text-left text-[10px] text-[#8B877F]">
                <th className="py-1.5 pr-2 font-normal">記事</th>
                <th className="px-2 text-right font-normal">表示</th>
                <th className="px-2 text-right font-normal">クリック</th>
                <th className="px-2 text-right font-normal">CTR</th>
                <th className="px-2 text-right font-normal">平均順位</th>
                <th className="px-2 text-right font-normal">閲覧</th>
                <th className="pl-2 text-right font-normal">滞在</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 40).map((m) => (
                <tr key={m.id} className="border-b border-[#F4F3F0] align-top">
                  <td className="max-w-[280px] py-1.5 pr-2">
                    <a href={m.url} target="_blank" rel="noreferrer" className="line-clamp-2 text-[#2E2D29] hover:underline">{m.title || m.url.replace(/^https?:\/\/[^/]+/, "")}</a>
                    {m.articleId && mine.has(m.articleId) && <span className="ml-1 rounded-full bg-[#FBF8F3] px-1.5 text-[9px] text-[#8A5340]">ここで作成</span>}
                    {m.queries.length > 0 && <p className="mt-0.5 truncate text-[10px] text-[#A5A198]">{m.queries.slice(0, 3).map((q) => q.query).join(" / ")}</p>}
                  </td>
                  <td className="px-2 text-right">{m.impressions ?? "–"}</td>
                  <td className="px-2 text-right">{m.clicks ?? "–"}</td>
                  <td className="px-2 text-right">{m.impressions ? `${((100 * (m.clicks ?? 0)) / m.impressions).toFixed(1)}%` : "–"}</td>
                  <td className="px-2 text-right">{m.position ?? "–"}</td>
                  <td className="px-2 text-right">{m.views ?? "–"}</td>
                  <td className="pl-2 text-right">{m.engagementSec !== null ? `${m.engagementSec}秒` : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-4 rounded-xl border border-dashed border-[#D8D4CC] p-5 text-center text-xs text-[#8B877F]">まだ数字がありません</p>
      )}

      <ReviewBlock project={project} kind="site" review={review} canRun={rows.length > 0} />
    </Card>
  );
}

function NoteResults({ project, metrics, review, articles }: { project: AioProject; metrics: AioMetric[]; review: AioContentReview | null; articles: AioArticle[] }) {
  const { busy, error, info, run } = useRun();
  const rows = useMemo(() => latestByPage(metrics), [metrics]);
  const [mode, setMode] = useState<"one" | "paste">("one");
  const posted = articles.filter((a) => a.publishedUrl);
  const [one, setOne] = useState({ article: posted[0]?.id ?? "", title: "", views: "", likes: "", comments: "" });
  const [paste, setPaste] = useState("");
  const n = (s: string) => (s.trim() === "" ? null : Number(s.replace(/[,，]/g, "")));

  return (
    <Card>
      <SectionTitle>note：記事ごとの数字</SectionTitle>
      <p className="mt-1 text-xs text-[#8B877F]">note には数字を取り出す公式の仕組みが無いため、ダッシュボード（アクセス状況）の数字を入れるか、表を貼り付けます</p>
      <div className="mt-3 flex gap-2">
        {(["one", "paste"] as const).map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)} className={cn("rounded-full border px-3 py-1 text-xs", mode === m ? "border-[#2E2D29] bg-[#2E2D29] text-white" : "border-[#E0DBD1] text-[#6B6862]")}>
            {m === "one" ? "1記事ずつ入れる" : "表を貼り付ける・CSV"}
          </button>
        ))}
      </div>
      {mode === "one" ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-[2fr_1fr_1fr_1fr_auto] sm:items-end">
          <div>
            <Label>記事</Label>
            {posted.length ? (
              <Select value={one.article} onChange={(v) => setOne({ ...one, article: v })} options={[...posted.map((a) => ({ value: a.id, label: a.title.slice(0, 40) })), { value: "", label: "（ここで作っていない記事）" }]} />
            ) : null}
            {(!posted.length || !one.article) && <Input className="mt-1" placeholder="記事のタイトル" value={one.title} onChange={(e) => setOne({ ...one, title: e.target.value })} />}
          </div>
          <div><Label>ビュー</Label><Input inputMode="numeric" value={one.views} onChange={(e) => setOne({ ...one, views: e.target.value })} /></div>
          <div><Label>スキ</Label><Input inputMode="numeric" value={one.likes} onChange={(e) => setOne({ ...one, likes: e.target.value })} /></div>
          <div><Label>コメント</Label><Input inputMode="numeric" value={one.comments} onChange={(e) => setOne({ ...one, comments: e.target.value })} /></div>
          <Btn
            disabled={busy !== null || (!one.article && !one.title.trim()) || (one.views === "" && one.likes === "")}
            onClick={() =>
              run("one", async () => {
                const a = posted.find((x) => x.id === one.article);
                await addAioNoteMetricsAction(project.id, { rows: [{ title: a?.title ?? one.title.trim(), url: a?.publishedUrl ?? "", views: n(one.views), likes: n(one.likes), comments: n(one.comments) }] });
                setOne({ ...one, title: "", views: "", likes: "", comments: "" });
                return "記録しました";
              })
            }
          >
            記録
          </Btn>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <Textarea rows={5} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={"タイトル,ビュー,スキ,コメント\n私たちが〇〇を始めた理由,1200,35,2\n（note のアクセス状況の表をそのまま貼っても読み取ります）"} className="font-mono text-xs" />
          <div className="flex items-center justify-between gap-2">
            <label className="text-xs text-[#6B6862] underline">
              CSV ファイルを読む
              <input type="file" accept=".csv,text/csv,text/plain" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setPaste(await f.text()); }} />
            </label>
            <Btn disabled={busy !== null || !paste.trim()} onClick={() => run("paste", async () => { const k = await addAioNoteMetricsAction(project.id, { text: paste }); setPaste(""); return `${k}記事分を記録しました`; })}>
              {busy === "paste" ? <Icon name="loader" /> : null}取り込む
            </Btn>
          </div>
        </div>
      )}
      {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
      {info && <p className="mt-3 rounded-xl bg-[#EAF3EE] px-3 py-2 text-xs text-[#2F6B4A]">{info}</p>}

      {rows.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[480px] text-xs">
            <thead>
              <tr className="border-b border-[#E8E5E0] text-left text-[10px] text-[#8B877F]">
                <th className="py-1.5 pr-2 font-normal">記事</th>
                <th className="px-2 text-right font-normal">ビュー</th>
                <th className="px-2 text-right font-normal">スキ</th>
                <th className="px-2 text-right font-normal">スキ率</th>
                <th className="px-2 text-right font-normal">コメント</th>
                <th className="pl-2 text-right font-normal">記録日</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 40).map((m) => (
                <tr key={m.id} className="border-b border-[#F4F3F0]">
                  <td className="max-w-[280px] truncate py-1.5 pr-2 text-[#2E2D29]">{m.url ? <a href={m.url} target="_blank" rel="noreferrer" className="hover:underline">{m.title || m.url}</a> : m.title}</td>
                  <td className="px-2 text-right">{m.views ?? "–"}</td>
                  <td className="px-2 text-right">{m.likes ?? "–"}</td>
                  <td className="px-2 text-right">{m.views ? `${((100 * (m.likes ?? 0)) / m.views).toFixed(1)}%` : "–"}</td>
                  <td className="px-2 text-right">{m.comments ?? "–"}</td>
                  <td className="pl-2 text-right text-[#A5A198]">{new Date(m.createdAt).toLocaleDateString("ja-JP")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ReviewBlock project={project} kind="note" review={review} canRun={rows.length > 0} />
    </Card>
  );
}

function ReviewBlock({ project, kind, review, canRun }: { project: AioProject; kind: AioChannelKind; review: AioContentReview | null; canRun: boolean }) {
  const { busy, error, run } = useRun();
  const maker = useArticleMaker(project.id);
  const router = useRouter();
  return (
    <div className="mt-5 border-t border-[#F0EDE8] pt-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-[#2E2D29]">改善案</p>
        <Btn variant="outline" size="sm" disabled={busy !== null || !canRun} onClick={() => run("review", () => reviewAioChannelAction(project.id, kind))}>
          {busy === "review" ? <Icon name="loader" /> : <Icon name="sparkles" className="h-3.5 w-3.5" />}
          {busy === "review" ? "考えています（1分ほど）" : review ? "数字から考え直す" : "数字から改善案を出す"}
        </Btn>
      </div>
      {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
      {review ? (
        <div className="mt-3 space-y-3">
          <p className="rounded-xl bg-[#FBF8F3] p-3 text-sm leading-relaxed text-[#2E2D29]">{review.summary}</p>
          {review.working.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-[#2F6B4A]">よく読まれている記事</p>
              <ul className="mt-1 space-y-1">{review.working.map((w, i) => <li key={i} className="text-xs text-[#2E2D29]"><span className="font-semibold">{w.title}</span><span className="text-[#6B6862]">：{w.why}</span></li>)}</ul>
            </div>
          )}
          {review.fixes.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-[#8A5340]">直す記事</p>
              <ul className="mt-1 space-y-1.5">
                {review.fixes.map((f, i) => (
                  <li key={i} className="rounded-lg border border-[#F0EDE8] p-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span className={cn("rounded-full px-1.5 text-[10px]", f.priority === "高" ? "bg-[#FBEDE9] text-[#A8705A]" : f.priority === "中" ? "bg-[#FBF4E4] text-[#8A6A1E]" : "bg-[#F4F3F0] text-[#6B6862]")}>{f.priority}</span>
                      {f.url ? <a href={f.url} target="_blank" rel="noreferrer" className="font-semibold text-[#2E2D29] underline">{f.title}</a> : <span className="font-semibold text-[#2E2D29]">{f.title}</span>}
                    </div>
                    <p className="mt-1 text-[#6B6862]">{f.problem}</p>
                    <p className="mt-0.5 text-[#2E2D29]">→ {f.action}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {review.next.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-[#2E2D29]">次に書く記事</p>
              <ul className="mt-1 space-y-1.5">
                {review.next.map((n, i) => (
                  <li key={i} className="flex items-start gap-2 rounded-lg bg-[#FAF9F7] p-2 text-xs">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-[#2E2D29]">{n.title}</p>
                      <p className="text-[#6B6862]">{n.target ? `${n.target}・` : ""}{n.why}</p>
                    </div>
                    <Btn size="sm" variant="outline" disabled={maker.busy} onClick={() => maker.make(kind, { title: n.title, target: n.target }).then((id) => id && router.push(`?tab=${kind}`))}>
                      この記事を書く
                    </Btn>
                  </li>
                ))}
              </ul>
              <PhaseNote phase={maker.phase} />
              {maker.error && <div className="mt-2"><ErrorNote>{maker.error}</ErrorNote></div>}
            </div>
          )}
          <p className="text-[11px] text-[#A5A198]">※ 数字は取得・入力した値です。改善案は見立てであり、順位や閲覧数の向上を保証するものではありません（{new Date(review.createdAt).toLocaleDateString("ja-JP")}）</p>
        </div>
      ) : (
        <p className="mt-2 text-xs text-[#8B877F]">{canRun ? "数字から、直す記事と次に書く記事を出します" : "数字を入れると、改善案を出せます"}</p>
      )}
    </div>
  );
}
