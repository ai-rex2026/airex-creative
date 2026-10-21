"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { addInternalTaskAction, deleteInternalTaskAction, sweepInternalAction, updateInternalTaskAction } from "@/app/seo-actions";
import { SectionTitle } from "@/components/meo/Workspace";
import { Btn, Card, ErrorNote, Icon, Input, Label, Select, Textarea, cn } from "@/components/meo/ui";
import { SCOPE_LABEL, STATUS_LABEL, type InternalPriority, type InternalScope, type InternalStatus, type InternalTask } from "@/lib/seo/internal";
import type { AioProject } from "@/lib/aio/types";

/**
 * 内部対策のタブ（SEO運用・AIO の両方で同じ部品を使う。2026-10-21）。
 * 中身は1つのリストで、SEO運用は「SEO・両方」、AIO は「AIO・両方」を出す。どちらで済みにしても両方で済みになる
 */
export function InternalPanel({ project, tasks, tab }: { project: AioProject; tasks: InternalTask[]; tab: "seo" | "aio" }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [form, setForm] = useState<{ title: string; detail: string; scope: InternalScope; priority: InternalPriority }>({ title: "", detail: "", scope: tab === "seo" ? "seo" : "aio", priority: "中" });
  const [showDone, setShowDone] = useState(false);

  const run = async (key: string, fn: () => Promise<{ ok: true } | { ok: false; error: string }>, ok?: string) => {
    setBusy(key);
    setError(null);
    setInfo(null);
    const r = await fn();
    setBusy(null);
    if (!r.ok) return setError(r.error);
    if (ok) setInfo(ok);
    router.refresh();
  };

  const open = tasks.filter((t) => t.status === "todo" || t.status === "doing");
  const closed = tasks.filter((t) => t.status === "done" || t.status === "skip");

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <SectionTitle>自社サイト・LP の内部対策</SectionTitle>
            <p className="mt-1 text-xs leading-relaxed text-[#8B877F]">
              SEO と AIO で共通の1つのリストです。ここには「{tab === "seo" ? "SEO" : "AIO"}」と「SEO・AIO（両方）」の施策を出しています（{tab === "seo" ? "AIO" : "SEO運用"}のタブと同じリスト。どちらで済みにしても両方で済みになります）。
              「洗い出す」はサイト（{project.url ?? "URL 未設定"}）・robots.txt・llms.txt を読んで判定し、同じドメインの URL レポートの指摘も取り込みます。AI は使いません。
            </p>
          </div>
          <Btn
            className="shrink-0"
            disabled={busy !== null || !project.url}
            onClick={() =>
              run("sweep", async () => {
                const r = await sweepInternalAction(project.id);
                if (!r.ok) return r;
                setInfo(`${r.added}件を追加しました${r.resolved ? `・${r.resolved}件は解消を確認して「済み」にしました` : ""}${r.notes.length ? `（${r.notes.join(" / ")}）` : ""}`);
                return { ok: true };
              })
            }
          >
            {busy === "sweep" ? <Icon name="loader" /> : <Icon name="search" className="h-4 w-4" />}
            {busy === "sweep" ? "読んでいます" : tasks.length ? "洗い出し直す" : "洗い出す"}
          </Btn>
        </div>
        {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
        {info && <p className="mt-3 rounded-xl bg-[#EAF3EE] px-3 py-2 text-xs text-[#2F6B4A]">{info}</p>}

        <div className="mt-4 space-y-2">
          {open.length === 0 ? (
            <p className="rounded-xl border border-dashed border-[#D8D4CC] p-6 text-center text-xs text-[#8B877F]">{tasks.length ? "未対応の施策はありません" : "まだ施策がありません。「洗い出す」を押すか、下から足してください"}</p>
          ) : (
            open.map((t) => <Row key={t.id} t={t} busy={busy} onRun={run} projectId={project.id} />)
          )}
        </div>
        {closed.length > 0 && (
          <div className="mt-4">
            <button type="button" className="text-xs text-[#6B6862] underline" onClick={() => setShowDone(!showDone)}>
              済み・対象外（{closed.length}件）を{showDone ? "閉じる" : "見る"}
            </button>
            {showDone && <div className="mt-2 space-y-2">{closed.map((t) => <Row key={t.id} t={t} busy={busy} onRun={run} projectId={project.id} />)}</div>}
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle>施策を足す</SectionTitle>
        <div className="mt-3 grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
          <div>
            <Label>施策</Label>
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="例：料金ページに FAQ の構造化データを入れる" />
          </div>
          <div>
            <Label>効く先</Label>
            <Select value={form.scope} onChange={(v) => setForm({ ...form, scope: v as InternalScope })} options={(["seo", "aio", "both"] as const).map((k) => ({ value: k, label: SCOPE_LABEL[k] }))} />
          </div>
          <div>
            <Label>優先度</Label>
            <Select value={form.priority} onChange={(v) => setForm({ ...form, priority: v as InternalPriority })} options={(["高", "中", "低"] as const).map((k) => ({ value: k, label: k }))} />
          </div>
        </div>
        <div className="mt-3">
          <Label>内容（任意）</Label>
          <Textarea rows={2} value={form.detail} onChange={(e) => setForm({ ...form, detail: e.target.value })} />
        </div>
        <div className="mt-3 flex justify-end">
          <Btn disabled={busy !== null || !form.title.trim()} onClick={() => run("add", async () => { const r = await addInternalTaskAction(project.id, form); if (r.ok) setForm({ ...form, title: "", detail: "" }); return r; })}>
            {busy === "add" ? <Icon name="loader" /> : null}足す
          </Btn>
        </div>
      </Card>
    </div>
  );
}

const SOURCE_LABEL: Record<InternalTask["source"], string> = { scan: "サイトを読んで判定", checklist: "定番の確認項目", report: "URLレポートから", manual: "手入力" };

function Row({ t, busy, onRun, projectId }: { t: InternalTask; busy: string | null; onRun: (key: string, fn: () => Promise<{ ok: true } | { ok: false; error: string }>) => Promise<void>; projectId: string }) {
  const done = t.status === "done" || t.status === "skip";
  return (
    <div className={cn("rounded-xl border border-[#E8E5E0] p-3", done && "opacity-70")}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", t.priority === "高" ? "bg-[#FBEDE9] text-[#A0472F]" : t.priority === "中" ? "bg-[#FBF4E4] text-[#8A6A1E]" : "bg-[#F4F3F0] text-[#6B6862]")}>優先度 {t.priority}</span>
        <span className="rounded-full bg-[#EEF3F8] px-2 py-0.5 text-[10px] text-[#3E5C76]">{SCOPE_LABEL[t.scope]}</span>
        <b className="flex-1 text-sm text-[#2E2D29]">{t.title}</b>
        <Select
          value={t.status}
          onChange={(v) => onRun(`st:${t.id}`, () => updateInternalTaskAction(projectId, t.id, { status: v as InternalStatus }))}
          options={(["todo", "doing", "done", "skip"] as const).map((k) => ({ value: k, label: STATUS_LABEL[k] }))}
        />
      </div>
      {t.detail && <p className="mt-1.5 text-xs leading-relaxed text-[#6B6862]">{t.detail}</p>}
      <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-[#A5A198]">
        <span>
          {SOURCE_LABEL[t.source]}
          {t.source !== "scan" && t.source !== "manual" ? "（人が確かめて済みにします）" : ""}
          {t.note ? `・${t.note}` : ""}
        </span>
        <button type="button" className="underline" disabled={busy !== null} onClick={() => confirm("この施策を消しますか？") && onRun(`del:${t.id}`, () => deleteInternalTaskAction(projectId, t.id))}>
          消す
        </button>
      </div>
    </div>
  );
}
