/** 強・標準・弱を3本の棒で見せる（強=3本、標準=2本、弱=1本。分析不可は点線）。色の信号機にしない */
const FILLED: Record<string, number> = { 強: 3, 標準: 2, 弱: 1 };

export function ScoreBars({ score }: { score: string | null }) {
  const n = score ? FILLED[score] ?? 0 : 0;
  return (
    <span className={`bars${score ? "" : " na"}`} aria-hidden="true">
      {[0, 1, 2].map((i) => <i key={i} className={i < n ? "f" : undefined} />)}
    </span>
  );
}
