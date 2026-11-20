/**
 * 重複・類似案の判定（2026-11-20）。AI は呼ばず、文字の2-gram の重なりだけで決める（費用なし・結果が毎回同じ）。
 * 同じ領域の既存の案（判断待ち・承認・保留・却下のすべて）と比べ、似ていれば新しい案は保存しない。
 * 却下した案と同じ内容が、言い換えで戻ってこないようにするためでもある。
 * 領域が違う案どうしは比べない。形（note／code）が違う案は、閾値を少し厳しくする（言い換えではなく別の使い道の可能性があるため）
 */
// 実際の判断待ち58件で調べた値：言い換えの重複は見出し・本文の少なくとも一方が 0.3 前後〜、別の案どうしは最大 0.17
export const DUP_THRESHOLD = 0.28;
export const DUP_THRESHOLD_OTHER_FORM = 0.4;

export type DupRow = { id?: string; area: string; form?: string; title: string; summary?: string; applied_text?: string; impl_note?: string };

const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[\s、。，．,.\-—―・「」『』（）()：:;；！!？?"'“”]/g, "");

function grams(s: string): Set<string> {
  const t = norm(s);
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}

const bodyOf = (r: DupRow) => r.applied_text || r.impl_note || r.summary || "";

function dice(a: string, b: string): number {
  const ga = grams(a);
  const gb = grams(b);
  if (!ga.size || !gb.size) return 0;
  let inter = 0;
  for (const g of ga) if (gb.has(g)) inter++;
  return (2 * inter) / (ga.size + gb.size);
}

/** 2つの案の似かた（0〜1）。見出しどうし・本文どうしの2-gram の Dice 係数の大きい方（見出しだけ言い換えた案も、本文だけ言い換えた案も拾う） */
export function similarity(a: DupRow, b: DupRow): number {
  return Math.max(dice(a.title, b.title), dice(bodyOf(a), bodyOf(b)));
}

/** pool の中から、row と同じ領域で似ている最初の案を返す。無ければ null */
export function findDup<T extends DupRow>(row: DupRow, pool: T[]): { dup: T; score: number } | null {
  let best: { dup: T; score: number } | null = null;
  for (const p of pool) {
    if (p.area !== row.area) continue;
    const th = (p.form ?? "note") === (row.form ?? "note") ? DUP_THRESHOLD : DUP_THRESHOLD_OTHER_FORM;
    const s = similarity(row, p);
    if (s >= th && (!best || s > best.score)) best = { dup: p, score: s };
  }
  return best;
}
