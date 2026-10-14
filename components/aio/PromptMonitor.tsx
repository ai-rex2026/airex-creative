"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { addAioPromptsAction, deleteAioPromptAction, runAioPromptsNowAction, setAioMonitoringAction, suggestAioPromptsAction, updateAioPromptAction } from "@/app/aio-actions";
import { SectionTitle } from "@/components/meo/Workspace";
import { Btn, Card, Checkbox, Dialog, ErrorNote, Icon, Input, Select, Switch, cn } from "@/components/meo/ui";
import { ownDomainsOf, summarize, type AioPeriodStats } from "@/lib/aio/prompts";
import { AIO_PROMPT_CATEGORY_LABEL, MAX_ACTIVE_PROMPTS, type AioCheck, type AioProject, type AioPrompt, type AioPromptCategory } from "@/lib/aio/types";

/**
 * 対策プロンプトの設計（Prompt Design）と月次モニタリング（Monitoring）。
 * 上: 直近期の数字（言及率・平均順位・引用率・SoV）と月次の推移
 * 中: プロンプト一覧（カテゴリ・最新の結果・エンジン）＋ AI の候補から選んで追加
 * 下: 競合の言及シェア・引用元ドメインのランキング
 */
export function PromptMonitor({ project, prompts, checks, remaining, limit, onRemaining }: { project: AioProject; prompts: AioPrompt[]; checks: AioCheck[]; remaining: number; limit: number; onRemaining: (n: number) => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const summary = useMemo(() => summarize(project, prompts, checks, ownDomainsOf(project)), [project, prompts, checks]);
  const active = prompts.filter((p) => p.active);
  const pendingCount = checks.filter((c) => c.status === "pending" || c.status === "running").length;

  // ── AI 候補 ──
  const [picking, setPicking] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [cands, setCands] = useState<{ text: string; category: AioPromptCategory; on: boolean }[]>([]);
  const suggest = async () => {
    setSuggesting(true);
    setError(null);
    try {
      const r = await suggestAioPromptsAction(project.id);
      setCands(r.map((c) => ({ ...c, on: true })));
      setPicking(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "候補を考えられませんでした");
    } finally {
      setSuggesting(false);
    }
  };
  const [adding, setAdding] = useState(false);
  const addPicked = async () => {
    setAdding(true);
    setError(null);
    try {
      const n = await addAioPromptsAction(project.id, cands.filter((c) => c.on).map(({ text, category }) => ({ text, category })));
      setNotice(`${n}本を対策プロンプトに追加しました`);
      setPicking(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "追加できませんでした");
    } finally {
      setAdding(false);
    }
  };

  // ── 手入力 ──
  const [manual, setManual] = useState("");
  const [manualCat, setManualCat] = useState<AioPromptCategory>("recommend");
  const addManual = async () => {
    if (!manual.trim()) return;
    setError(null);
    try {
      await addAioPromptsAction(project.id, [{ text: manual, category: manualCat }]);
      setManual("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "追加できませんでした");
    }
  };

  // ── 実測・設定 ──
  const [running, setRunning] = useState(false);
  const runAll = async () => {
    setRunning(true);
    setError(null);
    setNotice(null);
    try {
      const r = await runAioPromptsNowAction(project.id);
      onRemaining(r.remaining);
      setNotice(`${r.accepted}本の実測を受け付けました${r.skipped ? `（${r.skipped}本は今月の上限で見送り）` : ""}。順に AI に問い合わせます（10分おきに数本ずつ。全部で1〜2時間）`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "実測を開始できませんでした");
    } finally {
      setRunning(false);
    }
  };
  const [savingMon, setSavingMon] = useState(false);
  const toggleMonitoring = async (v: boolean) => {
    setSavingMon(true);
    try {
      await setAioMonitoringAction(project.id, v);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存できませんでした");
    } finally {
      setSavingMon(false);
    }
  };

  return (
    <Card>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <SectionTitle>① 対策プロンプトと月次モニタリング</SectionTitle>
          <p className="mt-1 text-xs leading-relaxed text-[#8B877F]">見込み客が AI に投げる「問い」を決め（最大{MAX_ACTIVE_PROMPTS}本）、毎月まとめて実測します。AI が推薦するかは「どんな問いに答えられるか」で決まるので、問いごとに結果を追います</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <label className="flex items-center gap-2 text-xs text-[#2E2D29]">
            月次モニタリング（毎月2日に全プロンプトを自動実測）
            <Switch checked={project.monitoringEnabled} onChange={toggleMonitoring} />
            {savingMon && <Icon name="loader" className="h-3.5 w-3.5" />}
          </label>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#8B877F]">手動は今月あと {remaining} / {limit} 回</span>
            <Btn size="sm" onClick={runAll} disabled={running || active.length === 0 || remaining <= 0 || pendingCount > 0}>
              {running ? <Icon name="loader" /> : <Icon name="search" className="h-3.5 w-3.5" />}
              {pendingCount > 0 ? `実測中（残り${pendingCount}本）` : "全プロンプトを今すぐ実測"}
            </Btn>
          </div>
        </div>
      </div>

      {/* 数字 */}
      {summary.latest && (
        <div className="mt-4 grid gap-2 sm:grid-cols-4">
          <Kpi label="言及率" value={summary.latest.mentionRate} prev={summary.previous?.mentionRate ?? null} unit="%" hint={`${summary.latest.mentioned} / ${summary.latest.checks} 本で自社が挙がった`} />
          <Kpi label="平均言及順位" value={summary.latest.avgRank} prev={summary.previous?.avgRank ?? null} unit="位" lowerIsBetter hint="挙がったときの平均の順番" />
          <Kpi label="引用率" value={summary.latest.citationRate} prev={summary.previous?.citationRate ?? null} unit="%" hint="自社サイトが根拠として引用された割合" />
          <Kpi label="SoV（言及シェア）" value={summary.latest.sov} prev={summary.previous?.sov ?? null} unit="%" hint="AI が挙げた事業者の延べ数に占める自社" />
        </div>
      )}
      {summary.history.length > 1 && <Trend history={summary.history} />}

      {notice && <p className="mt-3 text-sm text-[#2F6B4A]">{notice}</p>}
      {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}

      {/* プロンプト一覧 */}
      <div className="mt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-[#2E2D29]">対策プロンプト（{active.length} / {MAX_ACTIVE_PROMPTS}）</p>
          <Btn variant="outline" size="sm" onClick={suggest} disabled={suggesting}>
            {suggesting ? <Icon name="loader" /> : <Icon name="sparkles" className="h-3.5 w-3.5" />}
            AIに20本考えさせる
          </Btn>
        </div>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <Select value={manualCat} onChange={(v) => setManualCat(v as AioPromptCategory)} options={(Object.keys(AIO_PROMPT_CATEGORY_LABEL) as AioPromptCategory[]).map((k) => ({ value: k, label: AIO_PROMPT_CATEGORY_LABEL[k] }))} className="sm:w-32" />
          <Input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="例：港区で広告運用を任せるならどこがいい？" onKeyDown={(e) => e.key === "Enter" && addManual()} />
          <Btn onClick={addManual} disabled={!manual.trim() || active.length >= MAX_ACTIVE_PROMPTS} className="shrink-0">
            <Icon name="plus" className="h-3.5 w-3.5" />
            追加
          </Btn>
        </div>

        {prompts.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-[#D8D4CC] p-4 text-center text-sm text-[#8B877F]">まだありません。「AIに20本考えさせる」から選ぶか、手で入力してください</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-[#8B877F]">
                  <th className="py-2 pr-3 font-medium">プロンプト</th>
                  <th className="py-2 pr-3 font-medium">種類</th>
                  <th className="py-2 pr-3 font-medium">最新の結果</th>
                  <th className="py-2 pr-3 font-medium">AI</th>
                  <th className="py-2 pr-3 font-medium">測定日</th>
                  <th className="py-2 pr-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {prompts.map((p) => (
                  <PromptRow key={p.id} project={project} prompt={p} check={summary.byPrompt.find((b) => b.prompt.id === p.id)?.check ?? checks.find((c) => c.promptId === p.id) ?? null} onChanged={() => router.refresh()} onError={setError} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 競合と引用元 */}
      {(summary.competitors.length > 0 || summary.domains.length > 0) && (
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <div>
            <p className="text-sm font-semibold text-[#2E2D29]">AI が挙げた事業者（{summary.latest?.period}・言及シェア）</p>
            <ul className="mt-2 space-y-1">
              {summary.competitors.map((c) => (
                <li key={c.name} className="flex items-center gap-2 text-sm">
                  <span className={cn("w-28 shrink-0 truncate", c.isOwn ? "font-semibold text-[#2F6B4A]" : "text-[#2E2D29]")}>{c.name}</span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-[#F4F3F0]">
                    <span className={cn("block h-full rounded-full", c.isOwn ? "bg-[#2F6B4A]" : "bg-[#C9A84C]")} style={{ width: `${Math.min(100, c.share * 2)}%` }} />
                  </span>
                  <span className="w-20 shrink-0 text-right text-xs text-[#6B6862]">{c.mentions}回・{c.share}%</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-sm font-semibold text-[#2E2D29]">AI が根拠にした媒体（{summary.latest?.period}）</p>
            <ul className="mt-2 space-y-1">
              {summary.domains.map((d) => (
                <li key={d.domain} className="flex items-center justify-between gap-2 text-sm">
                  <span className={cn("truncate", d.isOwn ? "font-semibold text-[#2F6B4A]" : "text-[#2E2D29]")}>
                    {d.domain}
                    {d.isOwn && <span className="ml-1 rounded-full bg-[#EAF3EE] px-1.5 py-0.5 text-[10px]">自社</span>}
                  </span>
                  <span className="shrink-0 text-xs text-[#6B6862]">{d.count}本で引用</span>
                </li>
              ))}
            </ul>
            {summary.byEngine.length > 0 && (
              <p className="mt-2 text-[11px] text-[#A5A198]">測定AI: {summary.byEngine.map((e) => `${e.engine}（${e.mentioned}/${e.checks}本で言及）`).join("、")}</p>
            )}
          </div>
        </div>
      )}

      <Dialog open={picking} onOpenChange={setPicking} title="AI が考えた対策プロンプト" description="見込み客が実際に AI に投げそうな問いです。測りたいものにチェックして追加してください（登録は最大20本）" className="max-w-2xl">
        <ul className="max-h-[55vh] space-y-1.5 overflow-y-auto pr-1">
          {cands.map((c, i) => (
            <li key={i} className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-[#FAF9F7]">
              <Checkbox checked={c.on} onChange={(v) => setCands((cs) => cs.map((x, j) => (j === i ? { ...x, on: v } : x)))} />
              <span className="shrink-0 rounded-full bg-[#F4F3F0] px-2 py-0.5 text-[10px] text-[#6B6862]">{AIO_PROMPT_CATEGORY_LABEL[c.category]}</span>
              <span className="text-sm text-[#2E2D29]">{c.text}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex items-center justify-between">
          <span className="text-xs text-[#8B877F]">{cands.filter((c) => c.on).length} 本を選択中（空き {Math.max(0, MAX_ACTIVE_PROMPTS - active.length)} 本）</span>
          <div className="flex gap-2">
            <Btn variant="ghost" onClick={() => setPicking(false)} disabled={adding}>やめる</Btn>
            <Btn onClick={addPicked} disabled={adding || cands.every((c) => !c.on)}>
              {adding ? <Icon name="loader" /> : <Icon name="plus" />}
              選んだものを追加
            </Btn>
          </div>
        </div>
      </Dialog>
    </Card>
  );
}

function PromptRow({ project, prompt, check, onChanged, onError }: { project: AioProject; prompt: AioPrompt; check: AioCheck | null; onChanged: () => void; onError: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : "更新できませんでした");
    } finally {
      setBusy(false);
    }
  };
  const result = !check ? (
    <span className="text-xs text-[#A5A198]">未測定</span>
  ) : check.status === "completed" ? (
    check.mentioned ? (
      <span className="rounded-full bg-[#EAF3EE] px-2.5 py-0.5 text-xs font-bold text-[#2F6B4A]">{check.rank}番目</span>
    ) : (
      <span className="rounded-full bg-[#FBEDE9] px-2.5 py-0.5 text-xs text-[#A8705A]">挙がらず</span>
    )
  ) : check.status === "failed" ? (
    <span className="text-xs text-[#A8705A]" title={check.errorMessage ?? ""}>失敗</span>
  ) : (
    <span className="flex items-center gap-1 text-xs text-[#6B6862]"><Icon name="loader" className="h-3 w-3" />確認中</span>
  );
  return (
    <tr className={cn("border-t border-[#F0EDE8]", !prompt.active && "opacity-50")}>
      <td className="py-2 pr-3 text-[#2E2D29]">{prompt.text}</td>
      <td className="py-2 pr-3"><span className="rounded-full bg-[#F4F3F0] px-2 py-0.5 text-[10px] text-[#6B6862]">{AIO_PROMPT_CATEGORY_LABEL[prompt.category]}</span></td>
      <td className="py-2 pr-3">{result}</td>
      <td className="py-2 pr-3 text-xs text-[#8B877F]">{check?.engine ?? "–"}</td>
      <td className="py-2 pr-3 text-xs text-[#8B877F]">{check?.completedAt ? new Date(check.completedAt).toLocaleDateString("ja-JP") : "–"}</td>
      <td className="py-2 pr-0 text-right whitespace-nowrap">
        <button type="button" className="text-xs text-[#6B6862] underline" disabled={busy} onClick={() => act(() => updateAioPromptAction(project.id, prompt.id, { active: !prompt.active }))}>
          {prompt.active ? "外す" : "戻す"}
        </button>
        <button type="button" className="ml-2 text-xs text-[#A5A198] underline" disabled={busy} onClick={() => act(() => deleteAioPromptAction(project.id, prompt.id))}>
          削除
        </button>
      </td>
    </tr>
  );
}

function Kpi({ label, value, prev, unit, hint, lowerIsBetter }: { label: string; value: number | null; prev: number | null; unit: string; hint: string; lowerIsBetter?: boolean }) {
  const diff = value != null && prev != null ? Math.round((value - prev) * 10) / 10 : null;
  const good = diff == null ? null : lowerIsBetter ? diff < 0 : diff > 0;
  return (
    <div className="rounded-xl bg-[#FAF9F7] p-3">
      <p className="text-[11px] text-[#8B877F]">{label}</p>
      <p className="mt-0.5 text-xl font-black text-[#2E2D29]">
        {value == null ? "–" : value}
        <span className="ml-0.5 text-xs font-normal text-[#A5A198]">{unit}</span>
        {diff != null && diff !== 0 && <span className={cn("ml-2 text-xs font-semibold", good ? "text-[#2F6B4A]" : "text-[#A8705A]")}>{diff > 0 ? "▲" : "▼"} {Math.abs(diff)}</span>}
      </p>
      <p className="text-[10px] text-[#A5A198]">{hint}</p>
    </div>
  );
}

function Trend({ history }: { history: AioPeriodStats[] }) {
  const pts = history.slice(-12);
  const w = 420;
  const h = 60;
  const x = (i: number) => 8 + (i / Math.max(1, pts.length - 1)) * (w - 16);
  const y = (v: number | null) => (v == null ? h - 6 : 6 + (1 - v / 100) * (h - 12));
  const line = (key: "mentionRate" | "sov") => pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(" ");
  return (
    <div className="mt-3 overflow-x-auto">
      <svg width={w} height={h + 16} viewBox={`0 0 ${w} ${h + 16}`} aria-label="月次の推移">
        <path d={line("mentionRate")} fill="none" stroke="#2E2D29" strokeWidth="1.5" />
        <path d={line("sov")} fill="none" stroke="#C9A84C" strokeWidth="1.5" strokeDasharray="3 3" />
        {pts.map((p, i) => (
          <text key={p.period} x={x(i)} y={h + 12} fontSize="9" textAnchor="middle" fill="#A5A198">{p.period.slice(2)}</text>
        ))}
      </svg>
      <p className="text-[10px] text-[#A5A198]">― 言及率　- - SoV（月ごと）</p>
    </div>
  );
}
