import Link from "next/link";
import { EXCEL_COLUMNS, SOURCE_LABEL, isGoogleSource, type BoardGroup, type BoardKeyword, type BoardRow } from "@/lib/affiliate/board";
import { TARGET_STATUS, statusTone } from "@/lib/affiliate/domain";

type Grouped = { id: BoardGroup; sheet: string; desc: string; rows: BoardRow[] }[];

const TONE: Record<string, string> = {
  "bg-emerald-100 text-emerald-800": "#d1fae5",
  "bg-zinc-200 text-zinc-600": "#e4e4e7",
  "bg-amber-100 text-amber-800": "#fef3c7",
  "bg-slate-100 text-slate-700": "#f1f5f9",
};

export function BoardView({ campaignId, grouped, keywords }: { campaignId: string; grouped: Grouped; keywords: BoardKeyword[] }) {
  const slotCols = EXCEL_COLUMNS.filter((c) => /^p\d+$/.test(c.key));
  const exportHref = (fmt: string) => `/api/affiliate/export?campaignId=${campaignId}&format=${fmt}`;
  const nonGoogle = keywords.filter((k) => k.snapshotId && !isGoogleSource(k.source));

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <a className="btn sm" href={exportHref("xlsx")}>Excelでダウンロード</a>
        <a className="btn ghost sm" href={exportHref("csv")}>CSV</a>
        <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
          KW {keywords.length}件（収集済み {keywords.filter((k) => k.snapshotId).length}件）
        </span>
      </div>
      {nonGoogle.length > 0 && (
        <p style={{ fontSize: 12.5, color: "#92400e", background: "#fef3c7", padding: "8px 12px", borderRadius: 8, marginTop: 10 }}>
          次のKWは Google の検索結果ではなく Claude の検索で収集したため、順位の意味が異なります：{nonGoogle.map((k) => `${k.keyword}（${SOURCE_LABEL[k.source] ?? k.source}）`).join("、")}
        </p>
      )}
      {grouped.map((g) => (
        <div className="panel" key={g.id} style={{ marginTop: 16, overflowX: "auto" }}>
          <h2>{g.sheet}（{g.rows.length}）</h2>
          <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "4px 0 10px" }}>{g.desc}</p>
          {g.rows.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--muted)" }}>該当なし</p>
          ) : (
            <table style={{ borderCollapse: "collapse", fontSize: 12.5, minWidth: 900 }}>
              <thead>
                <tr>
                  {["No.", "KW", "順位", "枠", "メディア", "記事", "自社", "種類", "ASP", "状態", ...slotCols.map((c) => c.label)].map((h, i) => (
                    <th key={i} style={{ textAlign: "left", padding: "6px 8px", borderBottom: "1px solid #ddd", whiteSpace: "nowrap", color: "var(--muted)", fontWeight: 500 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r) => (
                  <tr key={r.entryId} style={{ borderBottom: "1px solid #eee", verticalAlign: "top" }}>
                    <td style={{ padding: "6px 8px" }}>{r.no}</td>
                    <td style={{ padding: "6px 8px" }}>{r.keyword}</td>
                    <td style={{ padding: "6px 8px" }}>{r.rank ?? ""}</td>
                    <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{r.resultTypeLabel}</td>
                    <td style={{ padding: "6px 8px" }}>
                      {r.mediaId ? <Link href={`/affiliate/media/${r.mediaId}?c=${campaignId}`}>{r.mediaName || r.mediaDomain}</Link> : r.mediaName}
                    </td>
                    <td style={{ padding: "6px 8px", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.articleUrl ? <a href={r.articleUrl} target="_blank" rel="noreferrer" title={r.articleTitle}>{r.articleTitle || r.articleUrl}</a> : ""}
                    </td>
                    <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{r.group === "candidate" ? "" : r.listed ? `あり${r.ownRankInArticle ? `（${r.ownRankInArticle}位）` : ""}` : "なし"}</td>
                    <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{[r.articleKind, r.slotKind].filter(Boolean).join(" / ")}</td>
                    <td style={{ padding: "6px 8px" }}>{r.asp}</td>
                    <td style={{ padding: "6px 8px" }}>
                      <span style={{ background: TONE[statusTone(r.status)] ?? "#f1f5f9", padding: "2px 8px", borderRadius: 999, whiteSpace: "nowrap" }}>{r.statusLabel || TARGET_STATUS[r.status] || r.status}</span>
                    </td>
                    {r.top.map((l, i) => (
                      <td key={i} style={{ padding: "6px 8px", whiteSpace: "nowrap", fontWeight: l?.is_own ? 700 : 400, background: l?.is_own ? "#fef9c3" : undefined }}>{l ? l.service_name : ""}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </div>
  );
}
