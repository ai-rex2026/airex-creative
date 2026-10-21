"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { deleteAioDraftAction, deleteAioProjectAction, generateAioDraftAction, markAioDraftDoneAction, runAioCheckAction } from "@/app/aio-actions";
import { AioProjectForm } from "@/components/aio/AioProjectForm";
import { PromptMonitor } from "@/components/aio/PromptMonitor";
import { GapPlan } from "@/components/aio/GapPlan";
import { MeoPageHeader, SectionTitle } from "@/components/meo/Workspace";
import { Btn, Card, Dialog, ErrorNote, GuardNotes, Icon, cn } from "@/components/meo/ui";
import { AIO_DRAFT_KINDS, type AioCheck, type AioContentPlan, type AioDraft, type AioDraftKind, type AioGapReport, type AioProject, type AioPrompt } from "@/lib/aio/types";

/**
 * AIO のワークスペース（対象1件）。
 * 上: 「今どうか」= AI に実際に聞いた結果（因果は主張しない。結果をそのまま見せる）
 * 下: 「何をすべきか」= 下書き（人が確認してコピーして使う。自動では公開しない）
 */
// 2026-10-21: 自社サイト記事は SEO運用（/seo）へ移した。内部対策は SEO運用と同じリストを AIO の印で絞って出す
export type AioTab = "note" | "prtimes" | "internal" | "results" | "ai";
export const AIO_TABS: { key: AioTab; label: string; hint: string }[] = [
  { key: "note", label: "note", hint: "note の記事を作って貼って投稿" },
  { key: "prtimes", label: "PR TIMES", hint: "プレスリリースの入稿内容（画像・動画つき）を作る" },
  { key: "internal", label: "内部対策", hint: "自社サイトでやること（SEO と共通）" },
  { key: "results", label: "効果と改善", hint: "記事ごとの数字と改善案" },
  { key: "ai", label: "AIでの見え方", hint: "AIに聞いたとき挙がるか" },
];

export function AioWorkspace({
  project,
  checks,
  drafts,
  prompts,
  gap,
  plans,
  quota,
  tab = "ai",
  children,
}: {
  project: AioProject;
  checks: AioCheck[];
  drafts: AioDraft[];
  prompts: AioPrompt[];
  gap: AioGapReport | null;
  plans: AioContentPlan[];
  quota: { remaining: number; limit: number };
  tab?: AioTab;
  children?: ReactNode;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // ── 実測 ──
  // 残り回数はサーバーが持つ（JSTの月で数え、上限の判定もサーバー側）。実行後は Action の戻り値で更新する
  const [remaining, setRemaining] = useState<number>(quota.remaining);
  const limit = quota.limit;
  const [submitting, setSubmitting] = useState(false);
  const [startedId, setStartedId] = useState<string | null>(null);
  // ここは「探し方」からの簡易実測（promptId なし）だけを扱う。対策プロンプトの実測は PromptMonitor
  const simple = checks.filter((c) => c.promptId === null);
  const anyPending = checks.some((c) => c.status === "pending" || c.status === "running");
  const running = simple.find((c) => c.status === "pending" || c.status === "running") ?? null;
  const latest = simple.find((c) => c.status === "completed") ?? null;
  const failed = !running && simple[0]?.status === "failed" ? simple[0] : null;
  const awaiting = startedId !== null && !checks.some((c) => c.id === startedId);
  const isRunning = submitting || awaiting || running !== null;

  // 確認中は読み直す。対策プロンプトの一括実測（長時間）は 20 秒おきに緩める
  useEffect(() => {
    if (!running && !awaiting && !anyPending) return;
    const t = setInterval(() => router.refresh(), running || awaiting ? 5000 : 20000);
    return () => clearInterval(t);
  }, [running, awaiting, anyPending, router]);

  const run = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const r = await runAioCheckAction(project.id);
      setStartedId(r.checkId);
      setRemaining(r.remaining);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "実測を開始できませんでした");
    } finally {
      setSubmitting(false);
    }
  };

  // ── 下書き ──
  const [generatingKind, setGeneratingKind] = useState<AioDraftKind | null>(null);
  const generate = async (kind: AioDraftKind) => {
    setGeneratingKind(kind);
    setError(null);
    try {
      await generateAioDraftAction(project.id, kind);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "下書きを作れませんでした");
    } finally {
      setGeneratingKind(null);
    }
  };

  const mentionedCount = simple.filter((c) => c.status === "completed" && c.mentioned).length;
  const completedCount = simple.filter((c) => c.status === "completed").length;
  const citedDomains = latest ? [...new Set(latest.citedSources.map((c) => c.domain).filter(Boolean))] : [];

  return (
    <div className="space-y-6">
      <MeoPageHeader
        icon="bot"
        title={project.name || "（名称未設定）"}
        description={`「${project.area ? `${project.area}で` : ""}${project.category}」を探す人に届く記事をつくり、公開し、数字を見て直す（検索・AI検索の対策）`}
        action={
          <div className="flex gap-2">
            <Btn variant="outline" size="sm" onClick={() => setEditing(true)}>
              対象の設定
            </Btn>
            <Link href={`/seo/${project.id}`} className="inline-flex h-8 items-center rounded-lg px-3 text-xs text-[#6B6862] hover:bg-[#F4F3F0]">
              SEO運用へ
            </Link>
            <Link href="/aio" className="inline-flex h-8 items-center rounded-lg px-3 text-xs text-[#6B6862] hover:bg-[#F4F3F0]">
              一覧へ
            </Link>
          </div>
        }
      />

      {editing && (
        <Dialog open={editing} onOpenChange={setEditing} title="対象の設定" className="max-w-2xl">
          <AioProjectForm mode="edit" project={project} onSaved={() => setEditing(false)} />
          <div className="mt-4 flex justify-end">
            <Btn variant="ghost" size="sm" onClick={() => { setEditing(false); setConfirmDelete(true); }}>
              この対象を削除
            </Btn>
          </div>
        </Dialog>
      )}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete} title="この対象を削除しますか？" description="実測の履歴と下書きもすべて消えます">
        <div className="flex justify-end gap-2">
          <Btn variant="ghost" onClick={() => setConfirmDelete(false)}>やめる</Btn>
          <Btn
            onClick={async () => {
              try {
                await deleteAioProjectAction(project.id);
                router.push("/aio");
              } catch (e) {
                setError(e instanceof Error ? e.message : "削除できませんでした");
                setConfirmDelete(false);
              }
            }}
          >
            削除する
          </Btn>
        </div>
      </Dialog>

      <nav className="flex gap-1 overflow-x-auto border-b border-[#E8E5E0]">
        {AIO_TABS.map((t) => (
          <Link
            key={t.key}
            href={`/aio/${project.id}?tab=${t.key}`}
            scroll={false}
            className={cn("shrink-0 border-b-2 px-3 pb-2 pt-1 text-sm", tab === t.key ? "border-[#2E2D29] font-semibold text-[#2E2D29]" : "border-transparent text-[#8B877F] hover:text-[#2E2D29]")}
          >
            {t.label}
            <span className="ml-1.5 hidden text-[10px] font-normal text-[#A5A198] lg:inline">{t.hint}</span>
          </Link>
        ))}
      </nav>

      {tab !== "ai" ? (
        children
      ) : (
      <>
      <PromptMonitor project={project} prompts={prompts} checks={checks} remaining={remaining} limit={limit} onRemaining={setRemaining} />

      {/* ── 今どうか（探し方での簡易実測） ── */}
      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <SectionTitle>② 今どうか（「探し方」1本での簡易実測）</SectionTitle>
            <p className="mt-1 text-xs text-[#8B877F]">実際に AI に聞いて、挙がった事業者と根拠にした媒体をそのまま記録します。どの AI で測ったかは結果に出ます</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-[#8B877F]">今月あと {remaining} / {limit} 回</span>
            <Btn onClick={run} disabled={isRunning || remaining <= 0}>
              {isRunning ? <Icon name="loader" /> : <Icon name="search" />}
              {isRunning ? "確認中（1〜3分）" : "今すぐ実測する"}
            </Btn>
          </div>
        </div>

        {completedCount > 0 && (
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Stat label="直近の結果" value={latest ? (latest.mentioned ? `${latest.rank}番目に挙がった` : "挙がらなかった") : "–"} tone={latest?.mentioned ? "ok" : "ng"} />
            <Stat label="挙がった回数" value={`${mentionedCount} / ${completedCount} 回`} />
            <Stat label="AIが根拠にした媒体" value={`${citedDomains.length} 媒体`} />
          </div>
        )}

        {failed && <div className="mt-4"><ErrorNote>前回の実測は失敗しました：{failed.errorMessage ?? "原因不明"}</ErrorNote></div>}
        {running && (
          <p className="mt-4 flex items-center gap-2 text-sm text-[#6B6862]">
            <Icon name="loader" /> AI に問い合わせています（{running.engine === "gemini" ? "Gemini" : "Claude"}・web検索つき）。この画面は自動で更新されます
          </p>
        )}

        {latest ? (
          <div className="mt-4 space-y-4">
            <div>
              <p className="text-xs font-semibold text-[#2E2D29]">AIが挙げた事業者（{new Date(latest.completedAt ?? latest.createdAt).toLocaleString("ja-JP")}・{latest.model}）</p>
              <ol className="mt-2 space-y-1">
                {latest.listed.length === 0 && <li className="text-sm text-[#8B877F]">（事業者名を抽出できませんでした）</li>}
                {latest.listed.map((n, i) => (
                  <li key={i} className={cn("flex items-center gap-2 text-sm", latest.rank === i + 1 ? "font-semibold text-[#2F6B4A]" : "text-[#2E2D29]")}>
                    <span className="w-5 text-right text-xs text-[#A5A198]">{i + 1}.</span>
                    {n}
                    {latest.rank === i + 1 && <span className="rounded-full bg-[#EAF3EE] px-2 py-0.5 text-[10px]">自社</span>}
                  </li>
                ))}
              </ol>
            </div>
            {citedDomains.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-[#2E2D29]">AIが根拠にした媒体</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {citedDomains.map((d) => (
                    <span key={d} className={cn("rounded-full px-2.5 py-0.5 text-[11px]", latest.ownSourceDomains.includes(d) ? "bg-[#EAF3EE] text-[#2F6B4A]" : "bg-[#F4F3F0] text-[#6B6862]")}>
                      {d}
                      {latest.ownSourceDomains.includes(d) ? "（自社の根拠）" : ""}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <details className="rounded-xl bg-[#FAF9F7] p-3">
              <summary className="cursor-pointer text-xs text-[#6B6862]">AIの回答全文を見る</summary>
              <div className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-[#2E2D29]">{latest.rawAnswer}</div>
            </details>
            {simple.filter((c) => c.status === "completed").length > 1 && (
              <div>
                <p className="text-xs font-semibold text-[#2E2D29]">これまでの実測</p>
                <ul className="mt-1 space-y-0.5">
                  {simple.filter((c) => c.status === "completed").slice(0, 12).map((c) => (
                    <li key={c.id} className="text-xs text-[#6B6862]">
                      {new Date(c.completedAt ?? c.createdAt).toLocaleDateString("ja-JP")}：{c.mentioned ? `${c.rank}番目` : "挙がらず"}（{c.engine}）
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          !running && !failed && (
            <div className="mt-4 rounded-xl border border-dashed border-[#D8D4CC] p-6 text-center">
              <p className="text-sm font-medium text-[#2E2D29]">まだ実測していません</p>
              <p className="mt-1 text-sm text-[#8B877F]">「今すぐ実測する」を押すと、AI に実際に聞いて結果を記録します</p>
            </div>
          )
        )}
        <p className="mt-3 text-[11px] leading-relaxed text-[#A5A198]">※ 表示しているのは実際に AI へ問い合わせた結果です。AI の回答は同じ質問でも変わることがあり、掲載順位を保証するものではありません。</p>
      </Card>

      {error && <ErrorNote>{error}</ErrorNote>}

      <GapPlan project={project} gap={gap} plans={plans} hasResults={checks.some((c) => c.status === "completed")} />

      {/* ── 何をすべきか ── */}
      <Card>
        <SectionTitle>⑤ 下書きを作る（AIに拾われるための文章）</SectionTitle>
        <p className="mt-1 text-xs text-[#6B6862]">note の記事は上のタブ「note」で、自社サイトの記事は SEO運用の「自社サイト記事」で、画像つき・公開まで作れます。</p>
        <p className="mt-1 text-xs text-[#8B877F]">他社の AIO サービスが施策として売っているものを、ここで AI が下書きします。内容を確認して、コピーして各媒体に載せてください（自動では公開しません）。作成と同時に表現チェックを通します</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {AIO_DRAFT_KINDS.filter((k) => k.kind !== "site_article" && k.kind !== "note_article").filter((k) => !k.recruit || prompts.some((p) => p.active && p.category === "recruit") || drafts.some((d) => d.kind === k.kind)).map((k) => {
            const count = drafts.filter((d) => d.kind === k.kind).length;
            const busy = generatingKind === k.kind;
            return (
              <div key={k.kind} className="flex flex-col rounded-xl border border-[#E8E5E0] p-3">
                <p className="text-sm font-semibold text-[#2E2D29]">{k.label}</p>
                <p className="mt-1 flex-1 text-[11px] leading-relaxed text-[#8B877F]">{k.description}</p>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[11px] text-[#A5A198]">{count ? `${count}件あり` : "未作成"}</span>
                  <Btn size="sm" variant={count ? "outline" : "primary"} onClick={() => generate(k.kind)} disabled={generatingKind !== null}>
                    {busy ? <Icon name="loader" /> : <Icon name="sparkles" className="h-3.5 w-3.5" />}
                    {busy ? "作成中" : count ? "もう1案" : "下書きを作る"}
                  </Btn>
                </div>
              </div>
            );
          })}
        </div>
        {generatingKind && <p className="mt-3 text-xs text-[#6B6862]">AI が下書きを作っています（1〜2分）。できたら下に出ます</p>}
      </Card>

      {drafts.length > 0 && (
        <section className="space-y-3">
          <SectionTitle>下書き</SectionTitle>
          {drafts.map((d) => (
            <AioDraftCard
              key={d.id}
              draft={d}
              onDone={(done) => markAioDraftDoneAction(project.id, d.id, done).then(() => router.refresh())}
              onDelete={() => deleteAioDraftAction(project.id, d.id).then(() => router.refresh())}
            />
          ))}
        </section>
      )}
      </>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "ok" | "ng" }) {
  return (
    <div className="rounded-xl bg-[#FAF9F7] p-3">
      <p className="text-[11px] text-[#8B877F]">{label}</p>
      <p className={cn("mt-0.5 text-base font-bold", tone === "ok" ? "text-[#2F6B4A]" : tone === "ng" ? "text-[#A8705A]" : "text-[#2E2D29]")}>{value}</p>
    </div>
  );
}

const LEVEL_LABEL: Record<string, [string, string]> = {
  red: ["要修正", "bg-[#FBEDE9] text-[#A8705A]"],
  yellow: ["要確認", "bg-[#FBF4E4] text-[#8A6A1E]"],
  green: ["問題なし", "bg-[#EAF3EE] text-[#2F6B4A]"],
};

function AioDraftCard({ draft, onDone, onDelete }: { draft: AioDraft; onDone: (done: boolean) => Promise<void>; onDelete: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const def = AIO_DRAFT_KINDS.find((k) => k.kind === draft.kind);
  const [levelText, levelCls] = LEVEL_LABEL[draft.guard?.level ?? "green"] ?? LEVEL_LABEL.green;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${draft.title}\n\n${draft.body}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* 選択してコピーしてもらう */
    }
  };

  return (
    <Card className={cn(draft.status === "done" && "opacity-70")}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-[#2E2D29] px-2.5 py-0.5 text-[11px] font-semibold text-white">{def?.label ?? draft.kind}</span>
        <span className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-semibold", levelCls)}>表現チェック：{levelText}</span>
        {draft.status === "done" && <span className="rounded-full bg-[#EAF3EE] px-2.5 py-0.5 text-[11px] text-[#2F6B4A]">掲載済み</span>}
        <span className="ml-auto text-[11px] text-[#A5A198]">{new Date(draft.createdAt).toLocaleDateString("ja-JP")}</span>
      </div>
      <p className="mt-2 text-sm font-semibold text-[#2E2D29]">{draft.title}</p>
      <div className={cn("mt-2 whitespace-pre-wrap rounded-xl bg-[#FAF9F7] p-3 text-xs leading-relaxed text-[#2E2D29]", !open && "max-h-40 overflow-hidden")}>{draft.body}</div>
      <button type="button" className="mt-1 text-xs text-[#6B6862] underline" onClick={() => setOpen((v) => !v)}>
        {open ? "折りたたむ" : "全文を見る"}
      </button>
      {draft.guard && draft.guard.hits.length > 0 && <div className="mt-2"><GuardNotes hits={draft.guard.hits} /></div>}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#F0EDE8] pt-3">
        <Btn variant="outline" size="sm" onClick={copy}>
          <Icon name={copied ? "check" : "file"} className="h-3.5 w-3.5" />
          {copied ? "コピーしました" : "本文をコピー"}
        </Btn>
        <div className="ml-auto flex gap-2">
          <Btn variant="ghost" size="sm" onClick={onDelete}>削除</Btn>
          <Btn variant={draft.status === "done" ? "ghost" : "gold"} size="sm" onClick={() => onDone(draft.status !== "done")}>
            <Icon name="check" className="h-3.5 w-3.5" />
            {draft.status === "done" ? "未掲載に戻す" : "掲載した"}
          </Btn>
        </div>
      </div>
    </Card>
  );
}
