"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { adoptSuggestionsAction, dismissSuggestionsAction, suggestKeywordsAction } from "@/app/affiliate-actions";

export type SuggestRow = { id: string; keyword: string; search_volume: number | null; source: string; reason: string };

export function SuggestPanel({ campaignId, rows, canVolume }: { campaignId: string; rows: SuggestRow[]; canVolume: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState("");

  const run = async (f: () => Promise<{ ok: boolean; error?: string }>, done?: string) => {
    setBusy(true);
    setMsg("");
    const r = await f();
    setBusy(false);
    setMsg(r.ok ? done ?? "" : r.error ?? "失敗しました");
    setPicked(new Set());
    router.refresh();
  };
  const ids = [...picked];

  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <h2>キーワード候補</h2>
      <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "6px 0 12px" }}>
        AIの提案{canVolume ? "と検索APIの関連キーワード" : ""}を候補として出します。採用したものだけが収集の対象になります。
      </p>
      <button className="btn ghost sm" disabled={busy} onClick={() => run(() => suggestKeywordsAction(campaignId), "候補を追加しました")}>{busy ? "作成中…" : "候補を出す"}</button>
      {msg && <span style={{ fontSize: 13, marginLeft: 10 }}>{msg}</span>}
      {rows.length > 0 && (
        <>
          <div style={{ maxHeight: 300, overflowY: "auto", border: "1px solid var(--line, #ddd)", borderRadius: 8, marginTop: 12 }}>
            {rows.map((r) => (
              <label key={r.id} style={{ display: "flex", gap: 10, padding: "7px 10px", fontSize: 13.5, borderBottom: "1px solid #eee" }}>
                <input type="checkbox" checked={picked.has(r.id)} onChange={() => { const n = new Set(picked); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); setPicked(n); }} />
                <span style={{ flex: 1 }}>{r.keyword}<small style={{ color: "var(--muted)", marginLeft: 8 }}>{r.reason}</small></span>
                <span style={{ color: "var(--muted)" }}>{r.search_volume != null ? `月 ${r.search_volume.toLocaleString()}` : "—"}</span>
              </label>
            ))}
          </div>
          <p style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <button className="btn sm" disabled={busy || !ids.length} onClick={() => run(() => adoptSuggestionsAction(campaignId, ids), "採用しました")}>採用する（{ids.length}）</button>
            <button className="btn ghost sm" disabled={busy || !ids.length} onClick={() => run(() => dismissSuggestionsAction(campaignId, ids), "伏せました")}>伏せる</button>
          </p>
        </>
      )}
    </div>
  );
}
