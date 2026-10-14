"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { approveOpsPostsAction, markHumanSentAction, runXStepAction, saveXOpsAction, skipOpsPostsAction, type ApproveResult } from "@/app/sns-ops-actions";
import { Btn, Card, ErrorNote, Icon, Input, Label, Switch, Textarea, cn } from "@/components/meo/ui";
import { SectionTitle } from "@/components/meo/Workspace";
import { OpsPostCard } from "@/components/sns/ops/OpsPostCard";
import type { InboxMessage, ObservedPost, OpsPost, PatternReport, XOpsConfig } from "@/lib/sns-ops/ops-types";

type Tab = "posts" | "engage" | "dm" | "analysis" | "settings";
const TABS: { key: Tab; label: string }[] = [
  { key: "posts", label: "投稿案" },
  { key: "engage", label: "リプライ・リポスト" },
  { key: "dm", label: "DM" },
  { key: "analysis", label: "伸びている型・結果" },
  { key: "settings", label: "設定" },
];

const STEP_LABEL: Record<string, string> = { bench: "伸びているアカウントを集める", search: "話題の投稿を集める", own: "自分の投稿の結果", patterns: "型の分析", drafts: "投稿案", images: "画像", engage: "反応の候補", dms: "DM" };

/** X 運用（集める → 型 → 案 → まとめて承認 → 投稿 → 結果を次へ） */
export function XOps({
  posts,
  observed,
  report,
  inbox,
  enabled,
  config,
  brandReady,
  connected,
  scope,
  todaySteps,
  keysCard,
  initialTab,
}: {
  posts: OpsPost[];
  observed: ObservedPost[];
  report: PatternReport | null;
  inbox: InboxMessage[];
  enabled: boolean;
  config: XOpsConfig;
  brandReady: boolean;
  connected: boolean;
  scope: string | null;
  todaySteps: Record<string, { done?: boolean; note?: string; error?: string; at?: string }>;
  keysCard: ReactNode;
  initialTab: string | null;
}) {
  const [tab, setTab] = useState<Tab>(TABS.some((t) => t.key === initialTab) ? (initialTab as Tab) : !connected ? "settings" : "posts");
  const setup = !connected || !config.benchHandles.length || !brandReady;

  return (
    <div className="space-y-5">
      {setup && tab !== "settings" && (
        <div className="flex items-center gap-3 rounded-2xl border border-[#E0D6C8] bg-[#FBF8F3] px-4 py-3 text-sm">
          <Icon name="alert" className="h-5 w-5 shrink-0 text-[#8A5340]" />
          <p className="flex-1 text-[#2E2D29]">
            {!connected ? "X のアカウントを連携してください。" : !brandReady ? "アカウントの持ち主（事業内容）が未設定です。" : "参考にする「伸びているアカウント」を登録してください。"}
          </p>
          {!brandReady && connected ? (
            <Link href="/sns" className="text-xs text-[#3E5C76] underline">事業内容を入れる</Link>
          ) : (
            <button type="button" className="text-xs text-[#3E5C76] underline" onClick={() => setTab("settings")}>設定を開く</button>
          )}
        </div>
      )}
      <nav className="flex gap-1 overflow-x-auto border-b border-[#E8E5E0]">
        {TABS.map((t) => {
          const n = t.key === "posts" ? posts.filter((p) => p.kind === "post" && p.status === "draft").length : t.key === "engage" ? posts.filter((p) => ["reply", "quote", "repost"].includes(p.kind) && p.status === "draft").length : t.key === "dm" ? posts.filter((p) => p.kind === "dm" && p.status === "draft").length : 0;
          return (
            <button key={t.key} type="button" onClick={() => setTab(t.key)} className={cn("shrink-0 border-b-2 px-3 pb-2 pt-1 text-sm", tab === t.key ? "border-[#2E2D29] font-semibold text-[#2E2D29]" : "border-transparent text-[#8B877F] hover:text-[#2E2D29]")}>
              {t.label}
              {n > 0 && <span className="ml-1 rounded-full bg-[#C9A84C] px-1.5 text-[10px] font-semibold text-[#2E2D29]">{n}</span>}
            </button>
          );
        })}
      </nav>

      {tab === "posts" && <PostsTab posts={posts.filter((p) => p.kind === "post")} hasReport={!!report} />}
      {tab === "engage" && <EngageTab posts={posts.filter((p) => ["reply", "quote", "repost"].includes(p.kind))} />}
      {tab === "dm" && <DmTab posts={posts.filter((p) => p.kind === "dm")} inbox={inbox} canDm={/\bdm\.read\b/.test(scope ?? "")} />}
      {tab === "analysis" && <AnalysisTab report={report} observed={observed} />}
      {tab === "settings" && <SettingsTab enabled={enabled} config={config} keysCard={keysCard} todaySteps={todaySteps} />}
    </div>
  );
}

// ── 共通：まとめて承認 ─────────────────────

function useStep() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<string | void>) => {
    setBusy(key);
    setError(null);
    setInfo(null);
    try {
      const m = await fn();
      if (m) setInfo(m);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy(null);
    }
  };
  return { busy, error, info, run, setInfo };
}

function Notes({ error, info }: { error: string | null; info: string | null }) {
  return (
    <>
      {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
      {info && <p className="mt-3 rounded-xl bg-[#EAF3EE] px-3 py-2 text-xs text-[#2F6B4A]">{info}</p>}
    </>
  );
}

function ApprovalList({ items, empty }: { items: OpsPost[]; empty: string }) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<ApproveResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [when, setWhen] = useState("");
  const drafts = items.filter((p) => p.status === "draft" || p.status === "failed");
  const waiting = items.filter((p) => p.status === "approved");
  const done = items.filter((p) => p.status === "published").slice(0, 20);
  const selectable = drafts.filter((p) => p.guard?.level !== "red");
  const needsHuman = results.filter((r) => r.result === "needs_human");

  const approve = async (sendNow: boolean) => {
    setBusy(sendNow ? "now" : "later");
    setError(null);
    try {
      const r = await approveOpsPostsAction([...sel], { sendNow, scheduledAt: !sendNow && when ? new Date(when).toISOString() : null });
      setResults(r);
      setSel(new Set());
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "承認できませんでした");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      {drafts.length > 0 && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-2xl border border-[#E8E5E0] bg-white/95 px-3 py-2 shadow-sm backdrop-blur">
          <label className="flex items-center gap-1.5 text-xs text-[#2E2D29]">
            <input type="checkbox" className="h-4 w-4 accent-[#2E2D29]" checked={sel.size > 0 && sel.size === selectable.length} onChange={(e) => setSel(e.target.checked ? new Set(selectable.map((p) => p.id)) : new Set())} />
            すべて選ぶ（{sel.size}/{drafts.length}）
          </label>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Btn variant="ghost" size="sm" disabled={!sel.size || busy !== null} onClick={async () => { setBusy("skip"); await skipOpsPostsAction([...sel]); setSel(new Set()); setBusy(null); router.refresh(); }}>
              見送る
            </Btn>
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="h-8 rounded-lg border border-[#E0DBD1] px-2 text-xs" aria-label="予約の日時" />
            <Btn variant="outline" size="sm" disabled={!sel.size || busy !== null} onClick={() => approve(false)}>
              {busy === "later" ? <Icon name="loader" /> : <Icon name="calendar" className="h-3.5 w-3.5" />}
              {when ? "承認して予約" : "承認して自動で送る"}
            </Btn>
            <Btn variant="gold" size="sm" disabled={!sel.size || busy !== null} onClick={() => approve(true)}>
              {busy === "now" ? <Icon name="loader" /> : <Icon name="send" className="h-3.5 w-3.5" />}
              承認して今すぐ送る
            </Btn>
          </div>
        </div>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
      {results.length > 0 && (
        <div className="rounded-2xl border border-[#E8E5E0] bg-[#FAF9F7] p-3 text-xs">
          <p className="font-semibold text-[#2E2D29]">
            送信 {results.filter((r) => r.result === "published").length}件・予約 {results.filter((r) => r.result === "scheduled").length}件・X の画面から送る {needsHuman.length}件・失敗 {results.filter((r) => r.result === "error").length}件
          </p>
          {results.filter((r) => r.result === "error").map((r) => (
            <p key={r.id} className="mt-1 text-[#A8705A]">・{r.message}</p>
          ))}
          {needsHuman.map((r) => (
            <div key={r.id} className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-[#6B6862]">X の規約で API から送れない相手です。本文入りの X の画面を開いて「ポスト」を押してください →</span>
              <a href={r.intentUrl} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-1 rounded-lg bg-[#2E2D29] px-2.5 text-white">
                X で開く <Icon name="external" className="h-3 w-3" />
              </a>
              <button type="button" className="text-[#3E5C76] underline" onClick={async () => { await markHumanSentAction(r.id); setResults(results.filter((x) => x.id !== r.id)); router.refresh(); }}>
                送った
              </button>
            </div>
          ))}
        </div>
      )}
      {drafts.length === 0 && waiting.length === 0 && done.length === 0 && <div className="rounded-2xl border border-dashed border-[#D8D4CC] p-8 text-center text-sm text-[#8B877F]">{empty}</div>}
      {drafts.map((p) => (
        <OpsPostCard key={p.id} post={p} selected={sel.has(p.id)} onSelect={(v) => { const n = new Set(sel); if (v) n.add(p.id); else n.delete(p.id); setSel(n); }} />
      ))}
      {waiting.length > 0 && <p className="pt-2 text-xs font-semibold text-[#3E5C76]">承認済み・送信待ち（{waiting.length}）</p>}
      {waiting.map((p) => (
        <OpsPostCard key={p.id} post={p} selected={false} onSelect={() => undefined} />
      ))}
      {done.length > 0 && <p className="pt-2 text-xs font-semibold text-[#2F6B4A]">送信済み（直近{done.length}件）</p>}
      {done.map((p) => (
        <OpsPostCard key={p.id} post={p} selected={false} onSelect={() => undefined} />
      ))}
    </div>
  );
}

// ── 投稿案 ─────────────────────

function PostsTab({ posts, hasReport }: { posts: OpsPost[]; hasReport: boolean }) {
  const { busy, error, info, run } = useStep();
  const [count, setCount] = useState(3);
  const [theme, setTheme] = useState("");
  return (
    <div className="space-y-5">
      <Card>
        <SectionTitle>投稿案を作る（型・画像・スレッドつき）</SectionTitle>
        <p className="mt-1 text-xs text-[#8B877F]">伸びている型と自分の投稿の結果から、案を作ります。画像（文字は入れません）と、続きをリプライに書くスレッドも作ります。{hasReport ? "" : "先に「伸びている型・結果」で型を分析しておくと、精度が上がります。"}</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Label>テーマ（任意）</Label>
            <Input value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="例：新サービスの使い方、よくある質問、お客様の困りごと" />
          </div>
          <div className="w-24">
            <Label>本数</Label>
            <Input type="number" min={1} max={10} value={count} onChange={(e) => setCount(Number(e.target.value))} />
          </div>
          <Btn disabled={busy !== null} onClick={() => run("drafts", () => runXStepAction("drafts", { count, theme }))}>
            {busy === "drafts" ? <Icon name="loader" /> : <Icon name="sparkles" className="h-4 w-4" />}
            {busy === "drafts" ? "作っています（1〜3分）" : "案を作る"}
          </Btn>
        </div>
        <Notes error={error} info={info} />
      </Card>
      <ApprovalList items={posts} empty="まだ案がありません。上の「案を作る」か、設定で毎日の自動をオンにしてください" />
    </div>
  );
}

// ── 反応 ─────────────────────

function EngageTab({ posts }: { posts: OpsPost[] }) {
  const { busy, error, info, run } = useStep();
  return (
    <div className="space-y-5">
      <Card>
        <SectionTitle>他の投稿へのリプライ・引用・リポスト</SectionTitle>
        <p className="mt-1 text-xs leading-relaxed text-[#8B877F]">
          集めた話題の投稿・伸びているアカウントの投稿から、反応すると良いものと反応の仕方を AI が勧めます。選んでまとめて承認できます。
          X の規約（2026年2月〜）で、他の人へのリプライ・引用を API で送れるのは、相手がこちらをメンション・引用したときだけです。それ以外は承認すると本文入りの X の画面を開くので、そこで「ポスト」を押してください。リポストは API で送ります。
        </p>
        <div className="mt-3 flex gap-2">
          <Btn variant="outline" disabled={busy !== null} onClick={() => run("collect", () => runXStepAction("collect"))}>
            {busy === "collect" ? <Icon name="loader" /> : <Icon name="refresh" className="h-4 w-4" />}投稿を集め直す
          </Btn>
          <Btn disabled={busy !== null} onClick={() => run("engage", () => runXStepAction("engage", { count: 5 }))}>
            {busy === "engage" ? <Icon name="loader" /> : <Icon name="sparkles" className="h-4 w-4" />}
            {busy === "engage" ? "選んでいます" : "反応の候補を出す"}
          </Btn>
        </div>
        <Notes error={error} info={info} />
      </Card>
      <ApprovalList items={posts} empty="まだ候補がありません。「反応の候補を出す」を押してください" />
    </div>
  );
}

// ── DM ─────────────────────

function DmTab({ posts, inbox, canDm }: { posts: OpsPost[]; inbox: InboxMessage[]; canDm: boolean }) {
  const { busy, error, info, run } = useStep();
  const convs = useMemo(() => {
    const m = new Map<string, InboxMessage[]>();
    for (const x of [...inbox].reverse()) m.set(x.conversationId, [...(m.get(x.conversationId) ?? []), x]);
    return [...m.entries()].sort((a, b) => (b[1][b[1].length - 1]?.sentAt ?? "").localeCompare(a[1][a[1].length - 1]?.sentAt ?? ""));
  }, [inbox]);
  return (
    <div className="space-y-5">
      <Card>
        <SectionTitle>DM への返信</SectionTitle>
        <p className="mt-1 text-xs text-[#8B877F]">DM を読み込み、返していない会話に AI が返信案を作ります。クレーム・営業・法的な話は「人の判断が要る」と印を付けます。承認したものだけ送ります。</p>
        {!canDm && <p className="mt-2 rounded-xl bg-[#FBF8F3] px-3 py-2 text-xs text-[#8A5340]">今の連携には DM の権限がありません。設定から X を連携し直してください。</p>}
        <div className="mt-3">
          <Btn disabled={busy !== null || !canDm} onClick={() => run("dms", () => runXStepAction("dms"))}>
            {busy === "dms" ? <Icon name="loader" /> : <Icon name="message" className="h-4 w-4" />}
            {busy === "dms" ? "読み込んでいます" : "DM を読み込んで返信案を作る"}
          </Btn>
        </div>
        <Notes error={error} info={info} />
      </Card>
      <ApprovalList items={posts} empty="返信が要る DM はありません" />
      {convs.length > 0 && (
        <details className="rounded-2xl border border-[#E8E5E0] bg-white p-4">
          <summary className="cursor-pointer text-sm font-semibold text-[#2E2D29]">受信箱（{convs.length}件の会話）</summary>
          <div className="mt-3 space-y-3">
            {convs.slice(0, 30).map(([id, list]) => (
              <div key={id} className="rounded-xl bg-[#FAF9F7] p-3">
                <p className="text-xs font-semibold text-[#2E2D29]">{list.find((m) => !m.fromMe)?.senderName ?? id}</p>
                <div className="mt-1 space-y-1">
                  {list.slice(-5).map((m) => (
                    <p key={m.id} className={cn("whitespace-pre-wrap rounded-lg px-2 py-1 text-xs", m.fromMe ? "ml-8 bg-[#EEF3F8] text-[#2E2D29]" : "mr-8 bg-white text-[#2E2D29]")}>
                      {m.text}
                    </p>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

// ── 分析 ─────────────────────

function AnalysisTab({ report, observed }: { report: PatternReport | null; observed: ObservedPost[] }) {
  const { busy, error, info, run } = useStep();
  const others = observed.filter((o) => o.source !== "own").sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0));
  const own = observed.filter((o) => o.source === "own").sort((a, b) => (b.views ?? 0) - (a.views ?? 0));
  const byId = new Map(observed.map((o) => [o.externalId, o]));
  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <SectionTitle>伸びている型</SectionTitle>
            <p className="mt-1 text-xs text-[#8B877F]">伸びているアカウント・話題の投稿と、自分の投稿の結果から、再現できる型を取り出します（毎日の自動でも更新します）</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Btn variant="outline" size="sm" disabled={busy !== null} onClick={() => run("collect", async () => { const a = await runXStepAction("collect"); const b = await runXStepAction("own").catch((e) => `自分の投稿：${e instanceof Error ? e.message : e}`); return `${a}／${b}`; })}>
              {busy === "collect" ? <Icon name="loader" /> : <Icon name="refresh" className="h-3.5 w-3.5" />}集める
            </Btn>
            <Btn size="sm" disabled={busy !== null} onClick={() => run("patterns", () => runXStepAction("patterns"))}>
              {busy === "patterns" ? <Icon name="loader" /> : <Icon name="sparkles" className="h-3.5 w-3.5" />}型を分析する
            </Btn>
          </div>
        </div>
        <Notes error={error} info={info} />
        {report ? (
          <div className="mt-4 space-y-3">
            <p className="rounded-xl bg-[#FBF8F3] p-3 text-sm leading-relaxed text-[#2E2D29]">{report.summary}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {report.patterns.map((p) => (
                <div key={p.name} className="rounded-xl border border-[#E8E5E0] p-3">
                  <p className="text-sm font-semibold text-[#2E2D29]">{p.name}</p>
                  <p className="mt-1 text-xs leading-relaxed text-[#2E2D29]">{p.howTo}</p>
                  <p className="mt-1 text-xs text-[#6B6862]">なぜ：{p.why}</p>
                  <p className="mt-1 text-xs text-[#8A5340]">自社なら：{p.fit}</p>
                  {p.examples.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {p.examples.map((id) => (
                        <a key={id} href={byId.get(id)?.url ?? `https://x.com/i/status/${id}`} target="_blank" rel="noreferrer" className="text-[10px] text-[#3E5C76] underline">
                          例 @{byId.get(id)?.author ?? id}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {report.ownLearnings.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-[#2E2D29]">自分の投稿から分かったこと（次の案に使います）</p>
                <ul className="mt-1 space-y-1">
                  {report.ownLearnings.map((l, i) => (
                    <li key={i} className="text-xs text-[#2E2D29]">・{l.finding}<span className="text-[#8B877F]">（{l.evidence}）</span> → {l.next}</li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-[11px] text-[#A5A198]">分析：{new Date(report.createdAt).toLocaleString("ja-JP")}。「なぜ」は見立てで、伸びることを保証するものではありません。</p>
          </div>
        ) : (
          <p className="mt-4 text-xs text-[#8B877F]">まだ分析していません</p>
        )}
      </Card>

      <ObservedTable title={`伸びている投稿（反応率の高い順・直近14日・${others.length}件）`} items={others.slice(0, 30)} />
      <ObservedTable title={`自分の投稿の結果（表示の多い順・${own.length}件）`} items={own.slice(0, 30)} />
    </div>
  );
}

function ObservedTable({ title, items }: { title: string; items: ObservedPost[] }) {
  if (!items.length) return null;
  return (
    <Card>
      <SectionTitle>{title}</SectionTitle>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[640px] text-xs">
          <thead>
            <tr className="border-b border-[#E8E5E0] text-left text-[10px] text-[#8B877F]">
              <th className="py-1.5 pr-2 font-normal">投稿</th>
              <th className="px-2 text-right font-normal">表示</th>
              <th className="px-2 text-right font-normal">いいね</th>
              <th className="px-2 text-right font-normal">RP</th>
              <th className="px-2 text-right font-normal">返信</th>
              <th className="pl-2 text-right font-normal">反応率</th>
            </tr>
          </thead>
          <tbody>
            {items.map((o) => (
              <tr key={o.id} className="border-b border-[#F4F3F0] align-top">
                <td className="max-w-[420px] py-1.5 pr-2">
                  <a href={o.url} target="_blank" rel="noreferrer" className="text-[10px] text-[#3E5C76] underline">@{o.author}</a>
                  {o.media.length > 0 && <span className="ml-1 text-[10px] text-[#A5A198]">画像/動画{o.media.length}</span>}
                  <p className="line-clamp-2 text-[#2E2D29]">{o.text}</p>
                </td>
                <td className="px-2 text-right">{o.views ?? "–"}</td>
                <td className="px-2 text-right">{o.likes ?? "–"}</td>
                <td className="px-2 text-right">{o.reposts ?? "–"}</td>
                <td className="px-2 text-right">{o.replies ?? "–"}</td>
                <td className="pl-2 text-right">{o.rate !== null ? `${o.rate}%` : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ── 設定 ─────────────────────

function SettingsTab({ enabled, config, keysCard, todaySteps }: { enabled: boolean; config: XOpsConfig; keysCard: ReactNode; todaySteps: Record<string, { done?: boolean; note?: string; error?: string; at?: string }> }) {
  const { busy, error, info, run } = useStep();
  const [on, setOn] = useState(enabled);
  const [handles, setHandles] = useState(config.benchHandles.join("\n"));
  const [keywords, setKeywords] = useState(config.keywords.join("\n"));
  const [drafts, setDrafts] = useState(config.dailyDrafts);
  const [engage, setEngage] = useState(config.dailyEngage);
  const [rules, setRules] = useState(config.rules);
  const steps = Object.entries(todaySteps);
  return (
    <div className="space-y-5">
      {keysCard}
      <Card>
        <SectionTitle>運用の設定</SectionTitle>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <Label>参考にする伸びているアカウント（1行に1つ・最大10）</Label>
            <Textarea rows={5} value={handles} onChange={(e) => setHandles(e.target.value)} placeholder={"@example_account\nhttps://x.com/another"} />
          </div>
          <div>
            <Label>反応する投稿を探すキーワード（1行に1つ・最大5）</Label>
            <Textarea rows={5} value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder={"業界のキーワード\nお客様の困りごと"} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>毎日の投稿案の数</Label>
              <Input type="number" min={0} max={10} value={drafts} onChange={(e) => setDrafts(Number(e.target.value))} />
            </div>
            <div>
              <Label>毎日の反応の候補の数</Label>
              <Input type="number" min={0} max={10} value={engage} onChange={(e) => setEngage(Number(e.target.value))} />
            </div>
          </div>
          <div>
            <Label>投稿の決まりごと（任意）</Label>
            <Textarea rows={3} value={rules} onChange={(e) => setRules(e.target.value)} placeholder="例：絵文字は1つまで、価格は書かない、敬語で" />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#FAF9F7] px-3 py-2">
          <label className="flex items-center gap-2 text-sm text-[#2E2D29]">
            <Switch checked={on} onChange={setOn} />
            毎日の自動（集める・型の分析・投稿案・画像・反応の候補・DM の返信案）
          </label>
          <span className="text-[11px] text-[#8B877F]">自動で作るのは案まで。送るのは承認したものだけです</span>
        </div>
        <div className="mt-3 flex justify-end">
          <Btn
            disabled={busy !== null}
            onClick={() =>
              run("save", async () => {
                await saveXOpsAction({ enabled: on, config: { benchHandles: handles.split(/[\n,、\s]+/), keywords: keywords.split(/\n+/), dailyDrafts: drafts, dailyEngage: engage, rules } });
                return "保存しました";
              })
            }
          >
            {busy === "save" ? <Icon name="loader" /> : <Icon name="save" className="h-4 w-4" />}保存する
          </Btn>
        </div>
        <Notes error={error} info={info} />
        <p className="mt-3 text-[11px] leading-relaxed text-[#A5A198]">
          ※ 伸びているアカウント・話題の投稿の収集は Apify を使います（1日6回まで）。自分の投稿の数字・投稿・DM は X の公式 API（従量課金）を使います。
        </p>
      </Card>
      {steps.length > 0 && (
        <Card>
          <SectionTitle>今日の自動の進み具合</SectionTitle>
          <ul className="mt-2 space-y-1 text-xs">
            {steps.map(([k, v]) => (
              <li key={k} className={v.done ? "text-[#2F6B4A]" : "text-[#A8705A]"}>
                {v.done ? "✓" : "×"} {STEP_LABEL[k] ?? k}：{v.done ? v.note : v.error}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
