/** 「実データを使って分析している」ことを示すバッジ（セクション見出し用）。2026-10-06 に Report.tsx から切り出し */
export function RealBadge({ label = "実データで分析" }: { label?: string }) {
  return (
    <span className="tag ok" style={{ marginLeft: 10, fontSize: 11, fontWeight: 500, verticalAlign: "middle" }}>
      🟢{label}
    </span>
  );
}
