"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  addPostDraftAction,
  applyDescriptionDraftAction,
  kitStepsAction,
  nextSeriesAction,
  patchStepAction,
  runKitStepAction,
  runWinnersAction,
  saveKitInputAction,
  savePlanStateAction,
} from "@/app/meo-kit-actions";
import { MeoPageHeader, SectionTitle, useMeo } from "@/components/meo/Workspace";
import { Btn, Card, ErrorNote, GuardNotes, Icon, Input, Label, Textarea, cn } from "@/components/meo/ui";
import { buildPlan, type PlanItem } from "@/lib/meo-ops/kit/plan";
import { hpbSalonUrl } from "@/lib/meo-ops/kit/text";
import type { KitData, KitInput, KitResults, KitStepId, PlanState } from "@/lib/meo-ops/kit/types";
import { meoPath } from "@/lib/meo-ops/logic";
import { BeforeAfter, CopyBox, CopyButton } from "./CopyBox";
import { Qr } from "./Qr";

/**
 * MEO のホーム上部（オルコネレックスの作り）。
 * URL を入れるだけで、上に「今の数字」、その下に「やること」が並び、各項目を開くと「今 → こう変える → なぜ」と貼る文章が出る。
 * 見せ方はオルコネの管理画面に合わせて「直すところ／集客スコア／AI・マップでの見え方／毎朝やること／ほかにできること」に分ける。
 */

type Sec = "fix" | "score" | "seen" | "auto" | "more";
const SECTIONS: [Sec, string][] = [
  ["fix", "直すところ"],
  ["score", "集客スコア"],
  ["seen", "AI・マップでの見え方"],
  ["auto", "毎朝やること"],
  ["more", "ほかにできること"],
];
/** すぐ直すもの（「直すところ」に出す） */
const MAIN = new Set(["hpb-catch", "hpb-intro", "hpb-coupon", "gbp-desc", "greviews", "gbp-profile", "gbp-menu", "series", "gbp-posts", "kit"]);
/** 一覧に出さないもの（別の欄で出す） */
const HIDE = new Set(["winners", "measure"]);

type Patch = <K extends "hpb" | "meo" | "kit" | "coupon" | "aio" | "series">(step: K, value: NonNullable<KitResults[K]>) => void;

export function KitHome({ storeId, data }: { storeId: string; data: KitData }) {
  const router = useRouter();
  const { data: ws } = useMeo();
  const [results, setResults] = useState<KitResults>(data.results);
  const [synced, setSynced] = useState(data.results);
  // サーバーから新しい結果が来たら差し替える（画面で直した途中の文章より、保存済みの最新を優先）
  if (synced !== data.results) {
    setSynced(data.results);
    setResults(data.results);
  }
  const [running, setRunning] = useState<{ steps: { id: KitStepId; label: string; progress: string }[]; at: number } | null>(null);
  const [runErrors, setRunErrors] = useState<Record<string, string>>({});
  const [sec, setSec] = useState<Sec>("fix");
  const [plan, setPlan] = useState<PlanState>(data.plan);

  const failed = Object.entries(data.steps).filter(([k, v]) => v?.status === "failed" && k !== "winners" && k !== "series");
  const hasKit = !!results.diagnose;

  const runAll = async (input: KitInput, only?: KitStepId[]) => {
    setRunErrors({});
    try {
      await saveKitInputAction(storeId, input);
    } catch (e) {
      setRunErrors({ input: e instanceof Error ? e.message : "保存できませんでした" });
      return;
    }
    const all = await kitStepsAction(storeId);
    const steps = only ? all.filter((s) => only.includes(s.id)) : all;
    const errs: Record<string, string> = {};
    for (let i = 0; i < steps.length; i++) {
      setRunning({ steps, at: i });
      const r = await runKitStepAction(storeId, steps[i].id);
      if (!r.ok) {
        errs[steps[i].id] = r.error ?? "できませんでした";
        // 店の情報が読めなかったら、その先は作れない
        if (steps[i].id === "scan" || steps[i].id === "diagnose") break;
      }
      router.refresh();
    }
    setRunErrors(errs);
    setRunning(null);
    router.refresh();
  };

  const patch: Patch = (step, value) => {
    setResults((r) => ({ ...r, [step]: value }));
    patchStepAction(storeId, step, value).catch(() => {});
  };
  const setItem = (id: string, v: "todo" | "done" | "skip") => {
    const next = { ...plan, [id]: v };
    setPlan(next);
    savePlanStateAction(storeId, next).catch(() => {});
  };

  if (running) return <Progress running={running} />;
  if (!hasKit) return <Entry storeId={storeId} data={data} errors={runErrors} onRun={(input) => runAll(input)} />;

  const pending = ws.checklist.filter((c) => !c.done).length;
  const items = buildPlan(results, data.kind, { unreplied: data.unrepliedReviews, profilePending: pending }).filter((i) => !HIDE.has(i.id));
  const main = items.filter((i) => MAIN.has(i.id));
  const more = items.filter((i) => !MAIN.has(i.id));
  const ctx = { storeId, data, results, patch, refresh: () => router.refresh() };

  return (
    <div className="space-y-5">
      <MeoPageHeader
        icon="sparkles"
        title="やること"
        description="お店のページを読んで、直すところと貼るだけの文章を出しています。文章は言葉のチェック済みですが、載せる前に内容を確認してください"
        action={
          <Btn variant="outline" size="sm" onClick={() => runAll(data.input)}>
            <Icon name="refresh" className="h-3.5 w-3.5" />
            作り直す
          </Btn>
        }
      />
      <Numbers data={data} />
      {(failed.length > 0 || Object.keys(runErrors).length > 0) && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#ECD9CE] bg-[#F8F1ED] px-4 py-3 text-sm text-[#A8705A]">
          <span>できなかった所があります（{[...new Set([...failed.map(([k]) => k), ...Object.keys(runErrors)])].length}件）。</span>
          <Btn size="sm" variant="outline" onClick={() => runAll(data.input, [...new Set([...failed.map(([k]) => k as KitStepId), ...(Object.keys(runErrors) as KitStepId[])])])}>
            できなかった所をやり直す
          </Btn>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {SECTIONS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setSec(id)}
            className={cn("rounded-full px-3.5 py-1.5 text-xs font-semibold", sec === id ? "bg-[#2E2D29] text-white" : "bg-[#F4F3F0] text-[#6B6862] hover:bg-[#ECEAE5]")}
          >
            {label}
            {id === "auto" && data.pendingCount > 0 && <span className="ml-1 rounded-full bg-[#C9A84C] px-1.5 text-[10px] text-[#2E2D29]">{data.pendingCount}</span>}
          </button>
        ))}
      </div>

      {sec === "fix" && (
        <div className="space-y-2">
          <p className="text-xs text-[#8B877F]">上から順に直してください。項目を押すと、今の文章と直した文章が開きます。直して載せたら、集客スコアの「採点し直す」で点数が変わります。</p>
          {main.map((i, n) => (
            <PlanCard key={i.id} item={i} n={n} state={plan[i.id] ?? "todo"} onState={(v) => setItem(i.id, v)} ctx={ctx} />
          ))}
        </div>
      )}
      {sec === "score" && <ScoreView ctx={ctx} />}
      {sec === "seen" && <SeenView ctx={ctx} />}
      {sec === "auto" && <AutoSummary storeId={storeId} data={data} />}
      {sec === "more" && (
        <div className="space-y-2">
          {more.map((i, n) => (
            <PlanCard key={i.id} item={i} n={n} state={plan[i.id] ?? "todo"} onState={(v) => setItem(i.id, v)} ctx={ctx} />
          ))}
          <Fold title="お店の情報" sub="ツールが読み取った内容（文章はここから作っています）">
            <DiagnoseView results={results} />
          </Fold>
          <Fold title="読み取るページを変える" sub="URL・補足・ホットペッパーの URL を直して作り直す">
            <InputForm data={data} onRun={(input) => runAll(input)} submitLabel="この内容で作り直す" />
          </Fold>
        </div>
      )}
    </div>
  );
}

type Ctx = { storeId: string; data: KitData; results: KitResults; patch: Patch; refresh: () => void };

// ── 入口（まだ何も作っていないとき） ─────────────────
function Entry({ storeId, data, errors, onRun }: { storeId: string; data: KitData; errors: Record<string, string>; onRun: (input: KitInput) => void }) {
  void storeId;
  const errList = Object.values(errors);
  return (
    <Card className="border-[#E0D6C8] bg-[#FBF8F3]">
      <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        <div>
          <p className="text-xs font-semibold text-[#8A5340]">{data.kind === "beauty" ? "美容室・理容室・ネイル・エステ" : data.kind === "food" ? "居酒屋・カフェ・ラーメン・レストラン" : "店舗・教室・サービス業"}</p>
          <h2 className="disp mt-2 text-2xl font-bold leading-snug text-[#2B2622]">
            お店のURLを入れるだけ。
            <br />
            やることが出てきます。
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-[#6B6862]">
            {data.kind === "beauty" ? "ホットペッパー・Googleマップ・口コミ・AI検索。" : "Googleマップ・口コミ・AI検索。"}
            文章はできあがった状態で出るので、コピーして貼るだけです。今の数字（AI検索・マップ順位・口コミ）も一緒に並べます。
          </p>
          <p className="mt-3 text-xs text-[#A5A198]">3〜4分かかります。途中で閉じても、できた所までは残ります。</p>
        </div>
        <div>
          <InputForm data={data} onRun={onRun} submitLabel="やることを出す" />
          {errList.length > 0 && (
            <div className="mt-3 space-y-1">
              {errList.map((e, i) => (
                <ErrorNote key={i}>{e}</ErrorNote>
              ))}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function InputForm({ data, onRun, submitLabel }: { data: KitData; onRun: (input: KitInput) => void; submitLabel: string }) {
  const [url, setUrl] = useState(data.input.url);
  const [note, setNote] = useState(data.input.note);
  const [hpb, setHpb] = useState(data.input.hpbUrl);
  const [showNote, setShowNote] = useState(!!data.input.note);
  const placeholder = data.kind === "beauty" ? "ホットペッパービューティーのURL（おすすめ）、またはサロンのHP" : data.kind === "food" ? "食べログ・Googleマップ・お店のHPのURL" : "お店のHP・Googleマップ・ポータルサイトのURL";
  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor="kit-url">お店のURL</Label>
        <Input id="kit-url" className="mt-1" type="url" placeholder={placeholder} value={url} onChange={(e) => setUrl(e.target.value)} />
        <p className="mt-1 text-[11px] text-[#A5A198]">空のままでも、Googleに登録された店名と住所から web で調べて作ります</p>
      </div>
      {data.kind === "beauty" && !hpbSalonUrl(url) && (
        <div>
          <Label htmlFor="kit-hpb">ホットペッパーのURL（分かれば）</Label>
          <Input id="kit-hpb" className="mt-1" type="url" placeholder="https://beauty.hotpepper.jp/slnH000000000/" value={hpb} onChange={(e) => setHpb(e.target.value)} />
        </div>
      )}
      {showNote ? (
        <div>
          <Label htmlFor="kit-note">補足（URLが無い・読めないとき、強みや看板メニューなど）</Label>
          <Textarea id="kit-note" className="mt-1 min-h-20" value={note} onChange={(e) => setNote(e.target.value)} placeholder="例：駅から徒歩2分。白髪ぼかしが得意。平日は21時まで" />
        </div>
      ) : (
        <button type="button" className="text-xs font-semibold text-[#8A5340] underline" onClick={() => setShowNote(true)}>
          URLが無い／補足を書く
        </button>
      )}
      <Btn className="w-full" onClick={() => onRun({ ...data.input, url: url.trim(), note: note.trim(), hpbUrl: hpb.trim() })}>
        <Icon name="sparkles" />
        {submitLabel}
      </Btn>
    </div>
  );
}

function Progress({ running }: { running: { steps: { id: KitStepId; label: string; progress: string }[]; at: number } }) {
  const pct = Math.round((running.at / Math.max(1, running.steps.length)) * 100);
  return (
    <Card className="border-[#E0D6C8] bg-[#FBF8F3]">
      <h2 className="disp text-xl font-bold text-[#2B2622]">お店を見ています</h2>
      <p className="mt-1 text-sm text-[#6B6862]">{running.steps[running.at]?.progress ?? "準備しています"}…</p>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#EDE6DB]">
        <div className="h-full rounded-full bg-[#B8865B] transition-all" style={{ width: `${Math.max(4, pct)}%` }} />
      </div>
      <ol className="mt-4 space-y-1.5">
        {running.steps.map((s, i) => (
          <li key={s.id} className={cn("flex items-center gap-2 text-sm", i < running.at ? "text-[#2F6B4A]" : i === running.at ? "font-semibold text-[#2E2D29]" : "text-[#A5A198]")}>
            {i < running.at ? <Icon name="checkCircle" className="h-4 w-4" /> : i === running.at ? <Icon name="loader" /> : <Icon name="circle" className="h-4 w-4" />}
            {s.progress}
          </li>
        ))}
      </ol>
    </Card>
  );
}

// ── 今の数字 ──────────────────────────────────
function Numbers({ data }: { data: KitData }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {data.numbers.map((n) => (
        <div key={n.key} className="rounded-2xl border border-[#E8E5E0] bg-white p-4" title={n.note}>
          <p className="text-xs text-[#8B877F]">{n.label}</p>
          <p className="disp mt-1 text-lg font-bold text-[#2E2D29]">{n.value}</p>
          <p className="mt-1 flex items-center gap-1 text-[11px] text-[#A5A198]">
            {n.delta === "up" && <Icon name="arrowUpRight" className="h-3.5 w-3.5 text-[#2F6B4A]" />}
            {n.delta === "down" && <Icon name="arrowDownRight" className="h-3.5 w-3.5 text-[#B5523B]" />}
            {n.prev ? `前回 ${n.prev}` : "前回の記録なし"}
          </p>
        </div>
      ))}
    </div>
  );
}

// ── やることのカード ──────────────────────────────
function PlanCard({ item, n, state, onState, ctx }: { item: PlanItem; n: number; state: "todo" | "done" | "skip"; onState: (v: "todo" | "done" | "skip") => void; ctx: Ctx }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cn("rounded-2xl border bg-white", open ? "border-[#D9CFC1]" : "border-[#E8E5E0]", state === "done" && "opacity-70")}>
      <div className="flex cursor-pointer items-start gap-3 p-4" onClick={() => setOpen((o) => !o)}>
        <span className={cn("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold", state === "done" ? "bg-[#E8F2EC] text-[#2F6B4A]" : "bg-[#F4EFE8] text-[#8C6239]")}>
          {state === "done" ? <Icon name="check" className="h-3.5 w-3.5" /> : n + 1}
        </span>
        <div className="min-w-0 flex-1">
          <p className={cn("text-sm font-semibold text-[#2E2D29]", state === "done" && "line-through")}>
            {item.title}
            {item.repeat && <span className="ml-2 rounded-full bg-[#F4F3F0] px-2 py-0.5 text-[10px] font-normal text-[#6B6862]">{item.repeat}</span>}
          </p>
          <p className="mt-0.5 text-xs text-[#8B877F]">
            {item.where}　約{item.minutes}分
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {state === "done" ? (
            <Btn size="sm" variant="ghost" onClick={() => onState("todo")}>
              やった を取り消す
            </Btn>
          ) : (
            <Btn
              size="sm"
              variant="outline"
              onClick={() => {
                onState("done");
                setOpen(false);
              }}
            >
              やった
            </Btn>
          )}
          <button type="button" onClick={() => setOpen((o) => !o)} className="text-[#A5A198]" aria-label={open ? "閉じる" : "開く"}>
            <Icon name={open ? "chevronUp" : "chevronDown"} />
          </button>
        </span>
      </div>
      {open && (
        <div className="space-y-3 border-t border-[#F0EDE8] p-4">
          <p className="text-sm leading-relaxed text-[#6B6862]">{item.why}</p>
          {item.ready ? <ItemBody item={item} ctx={ctx} /> : <p className="text-sm text-[#A5A198]">この項目の文章がまだできていません。上の「作り直す」か「できなかった所をやり直す」を押してください。</p>}
        </div>
      )}
    </div>
  );
}

function Fold({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl border border-[#E8E5E0] bg-white">
      <button type="button" className="flex w-full items-start gap-3 p-4 text-left" onClick={() => setOpen((o) => !o)}>
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#F4F3F0] text-xs text-[#8B877F]">・</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-[#2E2D29]">{title}</span>
          <span className="mt-0.5 block text-xs text-[#8B877F]">{sub}</span>
        </span>
        <Icon name={open ? "chevronUp" : "chevronDown"} className="h-4 w-4 text-[#A5A198]" />
      </button>
      {open && <div className="border-t border-[#F0EDE8] p-4">{children}</div>}
    </div>
  );
}

function ItemBody({ item, ctx }: { item: PlanItem; ctx: Ctx }) {
  const { storeId, results: r, patch } = ctx;
  const h = r.hpb;
  const m = r.meo;
  switch (item.render) {
    case "hpb-catch":
      return h ? (
        <>
          <HpbSource ctx={ctx} />
          <BeforeAfter c={h.catch} storeId={storeId} onChange={(c) => patch("hpb", { ...h, catch: c })} />
        </>
      ) : null;
    case "hpb-intro":
      return h ? <BeforeAfter c={h.intro} storeId={storeId} onChange={(c) => patch("hpb", { ...h, intro: c })} /> : null;
    case "hpb-coupon":
      return h ? (
        <div className="space-y-3">
          <BeforeAfter c={h.couponName} storeId={storeId} onChange={(c) => patch("hpb", { ...h, couponName: c })} />
          <BeforeAfter c={h.couponDesc} storeId={storeId} onChange={(c) => patch("hpb", { ...h, couponDesc: c })} />
        </div>
      ) : null;
    case "gbp-desc":
      return m ? <DescView ctx={ctx} /> : null;
    case "gbp-posts":
      return m ? <PostsView ctx={ctx} /> : null;
    case "gbp-menu":
      return m?.menu ? (
        <div className="space-y-4">
          {m.menu.map((p, i) => (
            <CopyBox key={i} c={p} storeId={storeId} onChange={(c) => patch("meo", { ...m, menu: m.menu!.map((x, j) => (j === i ? c : x)) })} />
          ))}
        </div>
      ) : null;
    case "series":
      return <SeriesView ctx={ctx} />;
    case "gbp-profile":
      return <ProfileView ctx={ctx} />;
    case "kit":
      return <KitView ctx={ctx} />;
    case "greviews":
      return (
        <div className="flex flex-wrap gap-2">
          <Link href={meoPath(storeId, "/reviews")}>
            <Btn size="sm">
              <Icon name="reply" className="h-3.5 w-3.5" />
              クチコミに返信する
            </Btn>
          </Link>
          <Link href={meoPath(storeId, "/auto")}>
            <Btn size="sm" variant="outline">
              <Icon name="bot" className="h-3.5 w-3.5" />
              返信文を毎日自動で作る
            </Btn>
          </Link>
        </div>
      );
    case "coupon":
      return r.coupon ? (
        <div className="space-y-3">
          {r.coupon.items.map((c, i) => {
            const t = `${c.title}\n${c.body}\n条件：${c.condition}\n有効期限：${c.expiry}`;
            return (
              <div key={i} className="rounded-xl border border-[#E8E5E0] p-3">
                <p className="text-sm font-semibold text-[#2E2D29]">{c.title}</p>
                <p className="mt-1 text-sm text-[#6B6862]">{c.body}</p>
                <p className="mt-1 text-xs text-[#8B877F]">
                  条件：{c.condition}　有効期限：{c.expiry}
                </p>
                <div className="mt-2">
                  <CopyButton text={t} />
                </div>
              </div>
            );
          })}
        </div>
      ) : null;
    case "insta":
      return (
        <Link href="/sns">
          <Btn size="sm">
            <Icon name="sparkles" className="h-3.5 w-3.5" />
            SNS運用で投稿案を作る
          </Btn>
        </Link>
      );
    case "aio-ask":
      return <AioAsk ctx={ctx} />;
    case "aio-faq":
      return r.aio ? (
        <div className="space-y-3">
          {r.aio.faq.map((f, i) => (
            <div key={i} className="rounded-xl border border-[#E8E5E0] p-3">
              <p className="text-sm font-semibold text-[#2E2D29]">Q. {f.q}</p>
              <p className="mt-1 text-sm leading-relaxed text-[#6B6862]">A. {f.a}</p>
            </div>
          ))}
          <CopyButton text={r.aio.faq.map((f) => `Q. ${f.q}\nA. ${f.a}`).join("\n\n")} label="全部コピー" />
          {r.aio.words.length > 0 && (
            <div className="rounded-xl bg-[#FAF9F7] p-3">
              <p className="text-xs font-semibold text-[#2E2D29]">口コミで言われたい言葉</p>
              <ul className="mt-1.5 space-y-1">
                {r.aio.words.map((w, i) => (
                  <li key={i} className="text-xs text-[#6B6862]">
                    「{w.word}」— {w.why}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : null;
    case "aio-jsonld":
      return r.aio ? (
        <div className="space-y-2">
          <pre className="max-h-72 overflow-auto rounded-xl bg-[#2E2D29] p-3 text-[11px] leading-relaxed text-[#F4F3F0]">{r.aio.jsonld}</pre>
          {r.aio.jsonldMissing.length > 0 && <p className="text-xs text-[#8A6A1E]">Google の登録情報に無かったので入れていない項目：{r.aio.jsonldMissing.join("・")}</p>}
          <CopyButton text={r.aio.jsonld} label="コードをコピー" />
          <p className="text-[11px] text-[#A5A198]">サイトの &lt;head&gt; か本文の最後に貼ります。制作会社にこのままお渡しください。</p>
        </div>
      ) : null;
    case "guard":
      return <GuardView ctx={ctx} />;
    default:
      return null;
  }
}

function HpbSource({ ctx }: { ctx: Ctx }) {
  const p = ctx.results.hpbpage;
  if (!p) return null;
  return (
    <p className="rounded-lg bg-[#F4F3F0] px-3 py-2 text-xs text-[#6B6862]">
      {p.url ? (
        <>
          読んだホットペッパーのページ：
          <a href={p.url} target="_blank" rel="noreferrer" className="underline">
            {p.title || p.url}
          </a>
          {p.note && `（${p.note}）`}
        </>
      ) : (
        p.note
      )}
    </p>
  );
}

function DescView({ ctx }: { ctx: Ctx }) {
  const m = ctx.results.meo!;
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const apply = async () => {
    setState("saving");
    try {
      await applyDescriptionDraftAction(ctx.storeId, m.description.text);
      setState("saved");
    } catch {
      setState("error");
    }
  };
  return (
    <div className="space-y-3">
      <BeforeAfter c={m.description} storeId={ctx.storeId} onChange={(c) => ctx.patch("meo", { ...m, description: c })} beforeLabel="今の説明文（プロフィールの下書き）" />
      <div className="flex flex-wrap items-center gap-2">
        <Btn size="sm" onClick={apply} disabled={state === "saving" || !!m.description.over}>
          {state === "saving" ? <Icon name="loader" /> : <Icon name="save" className="h-3.5 w-3.5" />}
          プロフィールの下書きに入れる
        </Btn>
        {state === "saved" && (
          <Link href={meoPath(ctx.storeId, "/profile")} className="text-xs font-semibold text-[#2F6B4A] underline">
            入れました。プロフィールタブで Google に反映する
          </Link>
        )}
        {state === "error" && <span className="text-xs text-[#B5523B]">入れられませんでした</span>}
      </div>
    </div>
  );
}

function PostsView({ ctx }: { ctx: Ctx }) {
  const m = ctx.results.meo!;
  const [added, setAdded] = useState<Record<number, "saving" | "done" | "error">>({});
  const add = async (i: number, text: string) => {
    setAdded((a) => ({ ...a, [i]: "saving" }));
    try {
      await addPostDraftAction(ctx.storeId, m.calendar[i]?.theme || `第${i + 1}週のお知らせ`, text);
      setAdded((a) => ({ ...a, [i]: "done" }));
      ctx.refresh();
    } catch {
      setAdded((a) => ({ ...a, [i]: "error" }));
    }
  };
  return (
    <div className="space-y-4">
      <table className="w-full text-sm">
        <tbody>
          {m.calendar.map((c, i) => (
            <tr key={i} className="border-t border-[#F0EDE8]">
              <td className="w-20 py-1.5 text-xs text-[#8B877F]">{c.week}</td>
              <td className="py-1.5 text-[#2E2D29]">{c.theme}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {m.posts.map((p, i) => (
        <div key={i} className="space-y-2">
          <CopyBox c={p} storeId={ctx.storeId} onChange={(c) => ctx.patch("meo", { ...m, posts: m.posts.map((x, j) => (j === i ? c : x)) })} />
          <Btn size="sm" variant="outline" onClick={() => add(i, p.text)} disabled={!!added[i] && added[i] !== "error"}>
            {added[i] === "saving" ? <Icon name="loader" /> : <Icon name="plus" className="h-3.5 w-3.5" />}
            {added[i] === "done" ? "投稿タブの下書きに入れました" : "投稿タブの下書きに入れる"}
          </Btn>
        </div>
      ))}
      <Link href={meoPath(ctx.storeId, "/posts")} className="inline-flex items-center gap-1 text-xs font-semibold text-[#2E2D29] underline">
        投稿タブで日付を決めて公開する
        <Icon name="arrowRight" className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}

function SeriesView({ ctx }: { ctx: Ctx }) {
  const s = ctx.results.series;
  const blog = ctx.data.kind === "beauty";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const next = async () => {
    setBusy(true);
    setError(null);
    try {
      await nextSeriesAction(ctx.storeId);
      ctx.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "作れませんでした");
    } finally {
      setBusy(false);
    }
  };
  const latest = s?.posts[s.posts.length - 1];
  const nextTheme = s?.themes.find((t) => !s.posts.some((p) => p.theme === t.title));
  const addDraft = async () => {
    if (!latest) return;
    try {
      await addPostDraftAction(ctx.storeId, latest.title, latest.body.slice(0, 1400));
      setAdded(latest.createdAt);
      ctx.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "入れられませんでした");
    }
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Btn size="sm" onClick={next} disabled={busy}>
          {busy ? <Icon name="loader" /> : <Icon name="sparkles" className="h-3.5 w-3.5" />}
          {s?.posts.length ? "次の1本を作る" : "1年分のテーマを決めて、1本目を作る"}
        </Btn>
        {nextTheme && <span className="text-xs text-[#8B877F]">次のテーマ：{nextTheme.title}</span>}
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      {latest && (
        <div className="space-y-2 rounded-xl border border-[#E8E5E0] p-3">
          <p className="text-xs text-[#8B877F]">テーマ：{latest.theme}</p>
          <CopyBox c={{ field: "題名", text: latest.title, count: latest.title.length }} storeId={ctx.storeId} />
          <CopyBox c={{ field: "本文", text: latest.body, count: latest.count, limit: blog ? 1000 : 1500, over: latest.count > (blog ? 1000 : 1500) }} storeId={ctx.storeId} />
          <GuardNotes hits={latest.hits} />
          {!blog && (
            <Btn size="sm" variant="outline" onClick={addDraft} disabled={added === latest.createdAt}>
              <Icon name="plus" className="h-3.5 w-3.5" />
              {added === latest.createdAt ? "投稿タブの下書きに入れました" : "投稿タブの下書きに入れる"}
            </Btn>
          )}
        </div>
      )}
      {s && s.themes.length > 0 && (
        <details className="text-xs text-[#6B6862]">
          <summary className="cursor-pointer font-semibold">1年分のテーマ（{s.posts.length} / {s.themes.length} 本 作成済み）</summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            {s.themes.map((t, i) => (
              <li key={i} className={s.posts.some((p) => p.theme === t.title) ? "text-[#A5A198] line-through" : ""}>
                {t.title}（{t.angle}）
              </li>
            ))}
          </ol>
        </details>
      )}
      {blog && <p className="text-[11px] text-[#A5A198]">SALON BOARD → ブログ で貼り付けてください。毎週1本ずつ出すのがおすすめです。</p>}
    </div>
  );
}

function ProfileView({ ctx }: { ctx: Ctx }) {
  const { data: ws } = useMeo();
  const pending = ws.checklist.filter((c) => !c.done);
  return (
    <div className="space-y-3">
      {pending.length > 0 ? (
        <ul className="space-y-1.5">
          {pending.map((c) => (
            <li key={c.key} className="flex items-start gap-2 text-sm">
              <Icon name="circleDashed" className="mt-0.5 h-4 w-4 shrink-0 text-[#C9A84C]" />
              <span>
                <span className="font-semibold text-[#2E2D29]">{c.label}</span>
                <span className="ml-1 text-xs text-[#8B877F]">{c.description}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-[#2F6B4A]">プロフィールの項目はそろっています。写真は月に数枚ずつ足すと、動いているお店に見えます。</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Link href={meoPath(ctx.storeId, "/profile")}>
          <Btn size="sm">プロフィールを整える</Btn>
        </Link>
        <Link href={meoPath(ctx.storeId, "/photos")}>
          <Btn size="sm" variant="outline">
            写真を見る
          </Btn>
        </Link>
      </div>
    </div>
  );
}

function KitView({ ctx }: { ctx: Ctx }) {
  const k = ctx.results.kit!;
  const { data } = ctx;
  const [email, setEmail] = useState(data.input.shopEmail);
  const [staff, setStaff] = useState(data.input.staff.join("、"));
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const pageUrl = useMemo(() => {
    const qs = new URLSearchParams({ n: data.storeName });
    if (data.reviewUrl) qs.set("g", data.reviewUrl);
    if (email.trim()) qs.set("e", email.trim());
    return qs;
  }, [data.storeName, data.reviewUrl, email]);
  const staffList = staff.split(/[、,\s]+/).map((s) => s.trim()).filter(Boolean).slice(0, 5);
  const save = async () => {
    setState("saving");
    setErr(null);
    try {
      await saveKitInputAction(ctx.storeId, { ...data.input, shopEmail: email.trim(), staff: staffList });
      setState("saved");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "保存できませんでした");
      setState("error");
    }
  };
  return (
    <div className="space-y-4">
      {!data.reviewUrl && <ErrorNote>Google の店舗が決まっていないため、口コミのリンクを作れません。「設定」タブで店舗を選んでください。</ErrorNote>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="kit-email">低い評価の声を受け取るメール</Label>
          <Input id="kit-email" className="mt-1" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="shop@example.com" />
        </div>
        <div>
          <Label htmlFor="kit-staff">担当者ごとのQR（名前を「、」区切りで）</Label>
          <Input id="kit-staff" className="mt-1" value={staff} onChange={(e) => setStaff(e.target.value)} placeholder="山田、佐藤" />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Btn size="sm" variant="outline" onClick={save} disabled={state === "saving"}>
          {state === "saving" ? <Icon name="loader" /> : <Icon name="save" className="h-3.5 w-3.5" />}
          保存する
        </Btn>
        {state === "saved" && <span className="text-xs text-[#2F6B4A]">保存しました</span>}
        {err && <span className="text-xs text-[#B5523B]">{err}</span>}
      </div>
      {origin && data.reviewUrl && (
        <div className="flex flex-wrap gap-3">
          <Qr value={`${origin}/review?${pageUrl.toString()}`} label="お店の口コミ画面" />
          {staffList.map((s) => {
            const q = new URLSearchParams(pageUrl);
            q.set("s", s);
            return <Qr key={s} value={`${origin}/review?${q.toString()}`} label={`担当 ${s}`} />;
          })}
        </div>
      )}
      <p className="text-[11px] leading-relaxed text-[#A5A198]">
        QRを読むと、お客様のスマホで口コミ画面が開きます。どの評価の方にも Google への道筋を出し、星3以下の方には「お店に直接伝える」を先に出します（評価によって Google への案内を隠すことはしません）。
        {origin && (
          <a href={`${origin}/review?${pageUrl.toString()}`} target="_blank" rel="noreferrer" className="ml-1 underline">
            口コミ画面を開いてみる
          </a>
        )}
      </p>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-2">
          <SectionTitle>POP の文面</SectionTitle>
          {k.pop.map((p, i) => (
            <CopyBox key={i} c={{ field: `案${i + 1}`, text: p, count: Array.from(p).length, limit: 60, over: Array.from(p).length > 60 }} storeId={ctx.storeId} />
          ))}
        </div>
        <div className="space-y-2">
          <SectionTitle>会計時のひとこと</SectionTitle>
          {k.talk.map((p, i) => (
            <CopyBox key={i} c={{ field: `案${i + 1}`, text: p, count: Array.from(p).length, limit: 80, over: Array.from(p).length > 80 }} storeId={ctx.storeId} />
          ))}
        </div>
        <div className="space-y-2">
          <SectionTitle>LINE・メールで送る文</SectionTitle>
          <CopyBox c={{ field: "依頼文", text: k.line, count: Array.from(k.line).length, limit: 150, over: Array.from(k.line).length > 150 }} storeId={ctx.storeId} onChange={(c) => ctx.patch("kit", { ...k, line: c.text })} />
        </div>
      </div>
    </div>
  );
}

function AioAsk({ ctx }: { ctx: Ctx }) {
  const a = ctx.results.aio;
  if (!a) return null;
  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-[#FAF9F7] p-3">
        <p className="text-xs font-semibold text-[#8B877F]">「{ctx.data.storeName}ってどんなお店？」と聞いたときの AI の答え{a.current.engine && `（${a.current.engine === "gemini" ? "Gemini" : "Claude"}）`}</p>
        <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-[#2E2D29]">{a.current.answer || "（答えを取れませんでした）"}</p>
      </div>
      {a.current.missing.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-[#2E2D29]">AIがまだ知らない強み</p>
          <ul className="mt-1 space-y-1">
            {a.current.missing.map((x, i) => (
              <li key={i} className="flex items-start gap-1.5 text-sm text-[#6B6862]">
                <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#C9A84C]" />
                {x}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[11px] text-[#A5A198]">説明文・よくある質問・口コミへの返信でこの強みに触れると、AI が拾える場所が増えます</p>
        </div>
      )}
      {a.current.sources.length > 0 && (
        <details className="text-xs text-[#8B877F]">
          <summary className="cursor-pointer">AIが見たページ（{a.current.sources.length}）</summary>
          <ul className="mt-1 space-y-0.5">
            {a.current.sources.map((s, i) => (
              <li key={i} className="break-all">
                {s}
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="text-[11px] text-[#A5A198]">{a.current.note}</p>
    </div>
  );
}

function GuardView({ ctx }: { ctx: Ctx }) {
  const g = ctx.results.guard;
  if (!g) return null;
  if (!g.hits.length) return <p className="text-sm text-[#2F6B4A]">{g.checked}か所の文章を確かめました。注意が要る言葉は見つかりませんでした。</p>;
  return (
    <div className="space-y-2">
      <p className="text-xs text-[#8B877F]">{g.checked}か所の文章を確かめ、{g.hits.length}件の注意が見つかりました。載せる前に言い換えてください。</p>
      {g.hits.map((h, i) => (
        <div key={i} className="rounded-xl border border-[#ECD9CE] bg-[#F8F1ED] p-3 text-xs leading-relaxed text-[#6B6862]">
          <p className="font-semibold text-[#8A5340]">
            {h.where}：「{h.text}」（{h.law}）
          </p>
          <p className="mt-0.5">{h.reason}</p>
          <p className="mt-0.5">→ {h.suggestion}</p>
        </div>
      ))}
    </div>
  );
}

// ── 集客スコア ─────────────────────────────────
function ScoreView({ ctx }: { ctx: Ctx }) {
  const s = ctx.results.score;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rerun = async () => {
    setBusy(true);
    setError(null);
    try {
      for (const step of ["scan", ...(ctx.data.kind === "beauty" ? ["hpbpage"] : []), "score"] as KitStepId[]) {
        const r = await runKitStepAction(ctx.storeId, step);
        if (!r.ok) throw new Error(r.error ?? "採点できませんでした");
      }
      ctx.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "採点できませんでした");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <SectionTitle>集客スコア</SectionTitle>
          <p className="mt-1 text-xs text-[#8B877F]">今のページを評価の基準ごとに 100点満点で採点し、点の低いところから直すところを出しています{s && `（${s.source}・${new Date(s.at).toLocaleDateString("ja-JP")}）`}</p>
        </div>
        <Btn size="sm" variant="outline" onClick={rerun} disabled={busy}>
          {busy ? <Icon name="loader" /> : <Icon name="refresh" className="h-3.5 w-3.5" />}
          ページを読み直して採点し直す
        </Btn>
      </div>
      {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
      {s ? (
        <>
          <div className="mt-4 flex items-end gap-4">
            <p className="disp text-5xl font-bold text-[#2E2D29]">{s.total}</p>
            <p className="pb-1 text-sm text-[#8B877F]">/ 100点</p>
            <span className="mb-1 rounded-lg bg-[#2E2D29] px-3 py-1 text-lg font-bold text-white">{s.rank}</span>
          </div>
          <p className="mt-2 text-sm text-[#6B6862]">{s.advice}</p>
          <div className="mt-4 space-y-3">
            {[...s.items].sort((a, b) => a.score - b.score).map((it) => (
              <div key={it.label}>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="font-semibold text-[#2E2D29]">{it.label}</span>
                  <span className="tabular-nums text-xs text-[#8B877F]">
                    {it.score}点（重み{it.weight}）
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#F0EDE8]">
                  <div className={cn("h-full rounded-full", it.score >= 80 ? "bg-[#2F6B4A]" : it.score >= 50 ? "bg-[#C9A84C]" : "bg-[#B5523B]")} style={{ width: `${Math.max(3, it.score)}%` }} />
                </div>
                <p className="mt-1 text-xs text-[#6B6862]">{it.reason}</p>
                {it.score < 80 && it.fix && <p className="text-xs text-[#8A5340]">→ {it.fix}</p>}
              </div>
            ))}
          </div>
          {s.keywords.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {s.keywords.map((k) => (
                <span key={k.word} className={cn("rounded-full px-2.5 py-0.5 text-xs", k.found ? "bg-[#E8F2EC] text-[#2F6B4A]" : "bg-[#F4F3F0] text-[#A5A198]")}>
                  {k.found ? "✓ " : ""}
                  {k.word}
                </span>
              ))}
              <span className="text-[11px] text-[#A5A198]">狙う語（「キーワード順位」に登録した語）がページに入っているか</span>
            </div>
          )}
        </>
      ) : (
        <p className="mt-3 text-sm text-[#A5A198]">まだ採点していません</p>
      )}
    </Card>
  );
}

// ── AI・マップでの見え方 ───────────────────────────
function SeenView({ ctx }: { ctx: Ctx }) {
  const { data: ws } = useMeo();
  const last = ws.aiSearch.checks.find((c) => c.status === "completed");
  const w = ctx.results.winners;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await runWinnersAction(ctx.storeId);
      if (!r.ok) throw new Error(r.error ?? "調べられませんでした");
      ctx.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "調べられませんでした");
    } finally {
      setBusy(false);
    }
  };
  const target = ctx.data.aiListed.length ? ctx.data.aiListed : ctx.data.placeCompetitors;
  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle>AIに聞いたとき</SectionTitle>
        {last ? (
          <div className="mt-2 space-y-1 text-sm">
            <p className="text-[#8B877F]">「{last.prompt}」（{new Date(last.executedAt).toLocaleDateString("ja-JP")}）</p>
            <p className={last.mentioned ? "text-[#2F6B4A]" : "text-[#B5523B]"}>
              {last.mentioned ? `このお店は${last.rank ?? "?"}番目に挙がりました。` : "このお店は挙がりませんでした。"}
              {last.listedStores.length > 0 && <span className="ml-1 text-xs text-[#8B877F]">{last.mentioned ? "先に挙がった店" : "代わりに挙がった店"}：{last.listedStores.slice(0, 3).join("、")}</span>}
            </p>
          </div>
        ) : (
          <p className="mt-2 text-sm text-[#A5A198]">まだ測っていません。</p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href={meoPath(ctx.storeId, "/ai-search")}>
            <Btn size="sm" variant="outline">
              <Icon name="bot" className="h-3.5 w-3.5" />
              AI検索で測る・推移を見る
            </Btn>
          </Link>
          <Link href={meoPath(ctx.storeId, "/keywords")}>
            <Btn size="sm" variant="outline">
              <Icon name="mapPin" className="h-3.5 w-3.5" />
              マップの順位を見る
            </Btn>
          </Link>
        </div>
      </Card>

      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <SectionTitle>AIが先に挙げている店との差</SectionTitle>
            <p className="mt-1 text-xs text-[#8B877F]">{target.length ? `比べる店：${target.slice(0, 3).join("、")}（${ctx.data.aiListed.length ? "AI検索で先に挙がった店" : "近くの同業"}）` : "先に「AI検索」で測るか、店舗情報を更新すると比べる店が決まります"}</p>
          </div>
          <Btn size="sm" onClick={run} disabled={busy || !target.length}>
            {busy ? <Icon name="loader" /> : <Icon name="search" className="h-3.5 w-3.5" />}
            {w ? "調べ直す" : "ページを読んで差を出す"}
          </Btn>
        </div>
        {busy && <p className="mt-2 text-xs text-[#6B6862]">相手のページを読んで、このお店との差を調べています（1〜3分）</p>}
        {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
        {w && (
          <div className="mt-4 space-y-4">
            <div className="grid gap-3 lg:grid-cols-3">
              {w.items.map((x, i) => (
                <div key={i} className="rounded-xl border border-[#E8E5E0] p-3">
                  <p className="text-sm font-semibold text-[#2E2D29]">{x.url ? <a href={x.url} target="_blank" rel="noreferrer" className="underline">{x.name}</a> : x.name}</p>
                  <ul className="mt-1.5 space-y-1">
                    {x.works.map((t, j) => (
                      <li key={j} className="text-xs text-[#6B6862]">・{t}</li>
                    ))}
                  </ul>
                  <p className="mt-1.5 text-[11px] text-[#A5A198]">{x.evidence}</p>
                </div>
              ))}
            </div>
            {w.gaps.length > 0 && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-[#8B877F]">
                    <th className="py-1.5 pr-3 font-medium">差</th>
                    <th className="py-1.5 pr-3 font-medium">このお店</th>
                    <th className="py-1.5 font-medium">相手</th>
                  </tr>
                </thead>
                <tbody>
                  {w.gaps.map((g, i) => (
                    <tr key={i} className="border-t border-[#F0EDE8] align-top">
                      <td className="py-1.5 pr-3 font-semibold text-[#2E2D29]">{g.point}</td>
                      <td className="py-1.5 pr-3 text-xs text-[#6B6862]">{g.ours}</td>
                      <td className="py-1.5 text-xs text-[#6B6862]">{g.theirs}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {w.actions.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-[#2E2D29]">今月やること</p>
                <ol className="mt-1.5 space-y-2">
                  {w.actions.map((a, i) => (
                    <li key={i} className="rounded-lg bg-[#FAF9F7] p-2.5 text-sm">
                      <p className="font-semibold text-[#2E2D29]">
                        {i + 1}. {a.title}
                      </p>
                      <p className="text-xs text-[#8B877F]">{a.where}</p>
                      <p className="mt-0.5 text-xs text-[#6B6862]">{a.detail}</p>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            <p className="text-[11px] text-[#A5A198]">{w.note}</p>
          </div>
        )}
      </Card>
    </div>
  );
}

// ── 毎朝やること（自動で回す）の要約 ─────────────────────
function AutoSummary({ storeId, data }: { storeId: string; data: KitData }) {
  const a = data.auto;
  const on = a.replies || a.posts;
  return (
    <Card>
      <SectionTitle>毎朝やること</SectionTitle>
      <p className="mt-1 text-xs leading-relaxed text-[#8B877F]">
        Googleマップをつなぐと、口コミへの返信文（基準を満たすものはそのまま送り、それ以外はお店の確認待ち）と週1回の投稿を、毎朝10時にまとめて作ります。マップ順位とAI検索は毎月自動で測ります。
      </p>
      <ul className="mt-3 space-y-1.5 text-sm">
        <li className="flex items-center gap-2">
          <Icon name={a.replies ? "checkCircle" : "circle"} className={cn("h-4 w-4", a.replies ? "text-[#2F6B4A]" : "text-[#C9C4BA]")} />
          口コミの返信文：{a.replies ? (a.autoSendMinStars ? `星${a.autoSendMinStars}以上は送る・それ以外は確認待ち` : "作って確認待ちに入れる") : "オフ"}
        </li>
        <li className="flex items-center gap-2">
          <Icon name={a.posts ? "checkCircle" : "circle"} className={cn("h-4 w-4", a.posts ? "text-[#2F6B4A]" : "text-[#C9C4BA]")} />
          週1回の投稿：{a.posts ? `${"日月火水木金土"[a.postWeekday]}曜日に作る・${a.autoPublishPosts ? "チェックを通れば公開" : "確認待ちに入れる"}` : "オフ"}
        </li>
        <li className="flex items-center gap-2">
          <Icon name="checkCircle" className="h-4 w-4 text-[#2F6B4A]" />
          マップ順位（毎月1日）・AI検索（毎月）の計測
        </li>
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Link href={meoPath(storeId, "/auto")}>
          <Btn size="sm">
            <Icon name="bot" className="h-3.5 w-3.5" />
            {on ? "設定と確認待ちを見る" : "自動で回す設定をする"}
          </Btn>
        </Link>
        {data.pendingCount > 0 && <span className="text-xs font-semibold text-[#8A6A1E]">確認待ちが {data.pendingCount}件 あります</span>}
      </div>
    </Card>
  );
}

function DiagnoseView({ results }: { results: KitResults }) {
  const d = results.diagnose;
  if (!d) return null;
  const row = (k: string, v: React.ReactNode) => (
    <div className="grid gap-1 border-t border-[#F0EDE8] py-2 sm:grid-cols-[120px_1fr]">
      <span className="text-xs text-[#8B877F]">{k}</span>
      <span className="text-sm text-[#2E2D29]">{v}</span>
    </div>
  );
  return (
    <div>
      {row("店名", d.name)}
      {row("地域", d.area)}
      {row("主力", d.product)}
      {row("客層", d.audience)}
      {row("強み", d.strengths.join(" / "))}
      {row("買わない理由", d.objections.join(" / "))}
      {row("訴求軸", d.angles.map((a) => a.name).join(" / "))}
      {row("語り口", d.tone)}
      {results.scan && row("読んだページ", results.scan.via === "page" ? results.scan.finalUrl : "（web 検索で集めた情報）")}
    </div>
  );
}

