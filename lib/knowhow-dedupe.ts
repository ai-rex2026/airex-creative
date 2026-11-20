/**
 * 重複・類似案の判定（2026-11-20）。AI は呼ばず、文字の2-gram の重なりだけで決める（費用なし・結果が毎回同じ）。
 * 同じ領域の既存の案（判断待ち・承認・保留・却下のすべて）と比べ、似ていれば新しい案は保存しない。
 * 却下した案と同じ内容が、言い換えで戻ってこないようにするためでもある。
 * 領域が違う案どうしは比べない。形（note／code）が違う案は、閾値を少し厳しくする（言い換えではなく別の使い道の可能性があるため）
 */
// 実際の判断待ち58件で調べた値（括弧内と「令和◯年◯月」を除いて比べる）：
// 言い換えの重複は見出し 0.30〜1.0、別の案どうしの見出しは最大 0.16。本文は共通の言い回し（出典の名前など）で 0.35 まで上がる別の案があったので、本文だけでは 0.4 以上を要る
export const TITLE_THRESHOLD = 0.3;
export const BODY_THRESHOLD = 0.4;
/** 形（note／code）が違う案は、言い換えではなく別の使い道の可能性があるので、少し厳しくする */
export const OTHER_FORM_PLUS = 0.1;

export type DupRow = { id?: string; area: string; form?: string; title: string; summary?: string; applied_text?: string; impl_note?: string };

const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/（[^）]*）|\([^)]*\)/g, "").replace(/令和\d+年(\d+月)?(\d+日)?/g, "").replace(/[\s、。，．,.\-—―・「」『』（）()：:;；！!？?"'“”]/g, "");

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

/** 2つの案の似かた。見出しどうし・本文どうしの2-gram の Dice 係数を別々に返す */
export function similarity(a: DupRow, b: DupRow): { title: number; body: number } {
  return { title: dice(a.title, b.title), body: dice(bodyOf(a), bodyOf(b)) };
}

/** pool の中から、row と同じ領域で似ている案を返す。見出しが似ている（0.3以上）か、本文が強く似ている（0.4以上）とき。無ければ null */
export function findDup<T extends DupRow>(row: DupRow, pool: T[]): { dup: T; score: number } | null {
  let best: { dup: T; score: number } | null = null;
  for (const p of pool) {
    if (p.area !== row.area) continue;
    const plus = (p.form ?? "note") === (row.form ?? "note") ? 0 : OTHER_FORM_PLUS;
    const s = similarity(row, p);
    const hit = s.title >= TITLE_THRESHOLD + plus || s.body >= BODY_THRESHOLD + plus;
    const score = Math.max(s.title, s.body);
    if (hit && (!best || score > best.score)) best = { dup: p, score };
  }
  return best;
}
