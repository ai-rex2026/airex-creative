"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  createAioArticleAction,
  finishAioArticleAction,
  researchComparisonRowAction,
  saveComparisonAction,
  startComparisonAction,
  type CmpTable,
} from "@/app/aio-content-actions";
import { Btn, Icon, Input } from "@/components/meo/ui";
import type { ArticleBrief } from "@/lib/aio/article";
import type { AioChannelKind } from "@/lib/aio/content-types";

export type MakePhase = null | "researching" | "writing" | "finishing";

type MakeArgs = { kind: AioChannelKind; brief: ArticleBrief | null; plan?: { planId: string; itemId: string }; keywordId?: string | null };
export type CmpReview = { args: MakeArgs; table: CmpTable; edits: Record<string, Record<string, string>>; hidden: string[] };

/** 半分以上の会社で空欄の項目（比べられないので、既定で記事から外す。人が戻せる） */
const sparseOf = (t: CmpTable) =>
  t.columns.filter((c) => t.rows.filter((r) => String(r.cells[c]?.value ?? "").trim()).length * 2 < t.rows.length);

/** 同時に集める社数（公式サイトの読み取りと AI 呼び出しを詰め込みすぎない） */
const PARALLEL = 3;

/**
 * 記事づくりの工程（本文を書いて保存 → 表現チェックと画像）を続けて呼ぶ。
 * サテライトは先に「比較表の下調べ」（項目決め → 各社の値。1社ずつ保存）をして、人が表を確かめてから本文を書く。
 * 工程ごとに保存されるので、途中で止まっても続きからやり直せる
 */
export function useArticleMaker(projectId: string) {
  const router = useRouter();
  const [phase, setPhase] = useState<MakePhase>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [review, setReview] = useState<CmpReview | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const write = async (args: MakeArgs, comparisonId: string | null) => {
    setPhase("writing");
    let articleId: string | null = null;
    try {
      const created = await createAioArticleAction(projectId, args.kind, args.brief, args.plan, args.keywordId ?? null, comparisonId);
      if (!created.ok) {
        setError(created.error);
        return null;
      }
      articleId = created.id;
      router.refresh();
      setPhase("finishing");
      const r = await finishAioArticleAction(articleId);
      if (!r.ok) {
        setError(`記事は保存しました。仕上げ（表現チェック・画像）で止まりました：${r.error}。記事のカードの「仕上げる」で続きから再開できます`);
        router.refresh();
        return articleId;
      }
      if (r.failed) setNotice(`画像を${r.failed}枚作れませんでした。${r.imageErrors.length ? `理由：${r.imageErrors.join(" / ")}。` : ""}記事のカードから作り直せます`);
      if (r.guard === "red") setNotice((n) => `${n ? `${n}。` : ""}表現チェックで「要修正」があります。記事のカードで確認してください`);
      router.refresh();
      return articleId;
    } catch (e) {
      setError(e instanceof Error ? e.message : "記事を作れませんでした");
      router.refresh();
      return articleId;
    } finally {
      setPhase(null);
    }
  };

  /** 各社の値を集める（済んだ行は飛ばす）。1社の失敗で他社を止めない */
  const research = async (table: CmpTable) => {
    const todo = table.rows.filter((r) => r.status !== "done");
    let rows = table.rows;
    let done = table.rows.length - todo.length;
    setProgress(`${done}/${table.rows.length}社`);
    for (let i = 0; i < todo.length; i += PARALLEL) {
      const got = await Promise.allSettled(todo.slice(i, i + PARALLEL).map((r) => researchComparisonRowAction(table.id, r.id)));
      got.forEach((g, k) => {
        const id = todo[i + k].id;
        if (g.status === "fulfilled" && g.value.ok) {
          const row = g.value.row;
          rows = rows.map((r) => (r.id === id ? row : r));
        } else {
          const msg = g.status === "fulfilled" ? (g.value.ok ? "" : g.value.error) : "通信に失敗しました";
          rows = rows.map((r) => (r.id === id ? { ...r, error: msg } : r));
        }
        done++;
      });
      setProgress(`${done}/${table.rows.length}社`);
    }
    setProgress(null);
    return { ...table, rows };
  };

  const make = async (kind: AioChannelKind, brief: ArticleBrief | null, plan?: { planId: string; itemId: string }, keywordId?: string | null) => {
    setError(null);
    setNotice(null);
    const args: MakeArgs = { kind, brief, plan, keywordId };
    if (kind !== "satellite") return write(args, null);
    setPhase("researching");
    try {
      const s = await startComparisonAction(projectId, brief);
      if (!s.ok) {
        setError(s.error);
        return null;
      }
      const table = await research(s.table);
      setReview({ args, table, edits: {}, hidden: sparseOf(table) });
      return null;
    } catch (e) {
      setError(e instanceof Error ? e.message : "比較表の下調べができませんでした");
      return null;
    } finally {
      setPhase(null);
      setProgress(null);
    }
  };

  /** 集め切れなかった行だけもう一度集める */
  const retryResearch = async () => {
    if (!review) return;
    setError(null);
    setPhase("researching");
    try {
      const table = await research(review.table);
      setReview({ ...review, table, hidden: sparseOf(table) });
    } finally {
      setPhase(null);
    }
  };

  const editCell = (rowId: string, col: string, value: string) =>
    review && setReview({ ...review, edits: { ...review.edits, [rowId]: { ...(review.edits[rowId] ?? {}), [col]: value } } });

  /** 直した表を保存して、この表で本文を書く */
  const writeFromReview = async () => {
    if (!review) return null;
    setError(null);
    const rows = review.table.rows.map((r) => ({
      id: r.id,
      cells: Object.fromEntries(review.table.columns.map((c) => [c, review.edits[r.id]?.[c] ?? r.cells[c]?.value ?? ""])),
    }));
    const keep = review.table.columns.filter((c) => !review.hidden.includes(c));
    if (!keep.length) {
      setError("記事に使う項目を1つ以上残してください");
      return null;
    }
    const saved = await saveComparisonAction(review.table.id, rows, keep);
    if (!saved.ok) {
      setError(saved.error);
      return null;
    }
    const args = review.args;
    const id = review.table.id;
    setReview(null);
    return write(args, id);
  };

  const toggleColumn = (col: string) =>
    review && setReview({ ...review, hidden: review.hidden.includes(col) ? review.hidden.filter((c) => c !== col) : [...review.hidden, col] });

  return { make, phase, error, notice, busy: phase !== null, review, progress, editCell, toggleColumn, retryResearch, writeFromReview, cancelReview: () => setReview(null) };
}

export function PhaseNote({ phase, progress }: { phase: MakePhase; progress?: string | null }) {
  if (!phase) return null;
  return (
    <p className="mt-3 text-xs text-[#6B6862]">
      {phase === "researching"
        ? `⓪ 記事のテーマに合う比較項目を決め、各社の公式サイトと検索で値を集めています（1社1〜2分${progress ? `・${progress}` : ""}）…`
        : phase === "writing"
          ? "① 既存記事のトンマナに合わせて本文を書いています（1〜3分）…"
          : "② 表現チェックと、文字の入らない画像（アイキャッチ＋本文中）を作っています（1〜2分）…"}
    </p>
  );
}

const VIA: Record<string, string> = { site: "公式", search: "検索", manual: "手入力" };

/** 比較表の下調べの確認・修正。直してから「この表で記事を書く」 */
export function ComparisonReview({ maker }: { maker: ReturnType<typeof useArticleMaker> }) {
  const r = maker.review;
  if (!r) return null;
  const { rows } = r.table;
  const columns = r.table.columns.filter((c) => !r.hidden.includes(c));
  const filled = rows.reduce((n, row) => n + columns.filter((c) => (r.edits[row.id]?.[c] ?? row.cells[c]?.value ?? "").trim()).length, 0);
  const failed = rows.filter((x) => x.status !== "done");
  return (
    <div className="mt-4 rounded-xl border border-[#E8E5E0] p-3">
      <p className="text-xs font-semibold text-[#2E2D29]">比較表の下調べ（{filled}/{rows.length * columns.length}マス）</p>
      <p className="mt-1 text-[11px] leading-relaxed text-[#8B877F]">
        公式サイトと検索で集めた値です。違う値・空欄は直してから「この表で記事を書く」を押してください。記事の比較表とランキングはこの表の値だけで書き、空欄は「確認できませんでした」になります。
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="text-[#8B877F]">記事に使う項目（押すと外す／戻す。半分以上の会社で空欄の項目は外してあります）：</span>
        {r.table.columns.map((c) => {
          const off = r.hidden.includes(c);
          return (
            <button key={c} type="button" onClick={() => maker.toggleColumn(c)} className={`rounded-full border px-2 py-0.5 ${off ? "border-[#E8E5E0] text-[#A5A198] line-through" : "border-[#2E2D29] text-[#2E2D29]"}`}>
              {c}
            </button>
          );
        })}
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-xs">
          <thead>
            <tr>
              <th className="border-b border-[#E8E5E0] p-1.5 text-left font-semibold">商品・サービス</th>
              {columns.map((c) => (
                <th key={c} className="border-b border-[#E8E5E0] p-1.5 text-left font-semibold">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="align-top">
                <td className="border-b border-[#F0EEEA] p-1.5">
                  {row.name}
                  {row.error && <p className="mt-0.5 text-[10px] text-[#B4532A]">{row.error}</p>}
                </td>
                {columns.map((c) => {
                  const cell = row.cells[c];
                  return (
                    <td key={c} className="border-b border-[#F0EEEA] p-1">
                      <Input value={r.edits[row.id]?.[c] ?? cell?.value ?? ""} onChange={(e) => maker.editCell(row.id, c, e.target.value)} placeholder="空欄" className="h-8 text-xs" />
                      {cell && !(c in (r.edits[row.id] ?? {})) && (
                        <p className="mt-0.5 truncate text-[10px] text-[#A5A198]" title={cell.source ?? ""}>
                          {VIA[cell.via] ?? ""}
                          {cell.source ? `：${cell.source.replace(/^https?:\/\/(www\.)?/, "")}` : ""}
                        </p>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        <button type="button" className="text-xs text-[#8B877F] underline" disabled={maker.busy} onClick={maker.cancelReview}>やめる</button>
        {failed.length > 0 && (
          <Btn variant="outline" size="sm" disabled={maker.busy} onClick={maker.retryResearch}>
            集め切れなかった{failed.length}社をもう一度集める
          </Btn>
        )}
        <Btn size="sm" disabled={maker.busy} onClick={maker.writeFromReview}>
          {maker.busy ? <Icon name="loader" /> : null}
          この表で記事を書く
        </Btn>
      </div>
    </div>
  );
}
