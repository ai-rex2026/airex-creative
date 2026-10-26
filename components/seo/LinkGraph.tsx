"use client";

import type { Edge } from "@/lib/seo/links/text";

/**
 * 内部リンクの構造図（円形）。記事を円周に並べ、リンクを線で結ぶ。
 * 既存のリンクは灰色、追加する提案は金色。どこからもリンクされていない記事は二重の輪で示す。番号は一覧の番号と同じ
 */
export function LinkGraph({ urls, existing, added, size = 360 }: { urls: string[]; existing: Edge[]; added: Edge[]; size?: number }) {
  const n = urls.length;
  const c = size / 2;
  const r = size / 2 - 26;
  const pos = new Map(urls.map((u, i) => {
    const a = (2 * Math.PI * i) / Math.max(1, n) - Math.PI / 2;
    return [u, { x: c + r * Math.cos(a), y: c + r * Math.sin(a) }] as const;
  }));
  const linked = new Set<string>([...existing, ...added].map((e) => e.to));
  const line = (e: Edge, key: string, stroke: string, w: number, op: number) => {
    const a = pos.get(e.from);
    const b = pos.get(e.to);
    if (!a || !b) return null;
    return <line key={key} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={stroke} strokeWidth={w} strokeOpacity={op} />;
  };
  return (
    <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label="内部リンクの構造図" className="h-auto w-full max-w-[420px]">
      <circle cx={c} cy={c} r={r} fill="none" stroke="#E5E2DC" strokeDasharray="2 4" />
      {existing.map((e, i) => line(e, `e${i}`, "#8B857A", 0.8, 0.45))}
      {added.map((e, i) => line(e, `a${i}`, "#C9A84C", 1.8, 0.95))}
      {urls.map((u, i) => {
        const p = pos.get(u)!;
        const orphan = !linked.has(u);
        return (
          <g key={u}>
            {orphan && <circle cx={p.x} cy={p.y} r={10.5} fill="none" stroke="#2E2D29" strokeWidth={1.2} />}
            <circle cx={p.x} cy={p.y} r={7} fill={orphan ? "#FFFFFF" : "#2E2D29"} stroke="#2E2D29" strokeWidth={1} />
            <text x={p.x} y={p.y + 3} textAnchor="middle" fontSize={n > 40 ? 6 : 7.5} fill={orphan ? "#2E2D29" : "#FFFFFF"}>{i + 1}</text>
          </g>
        );
      })}
    </svg>
  );
}
