"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { mergeMediaAction, setNoSolicitationAction, updateMediaAction } from "@/app/affiliate-actions";

const input: React.CSSProperties = { width: "100%", padding: "8px 10px", border: "1px solid var(--line, #ddd)", borderRadius: 8, fontSize: 14, background: "#fff" };
const lab: React.CSSProperties = { display: "block", fontSize: 12.5, color: "var(--muted)", margin: "12px 0 4px" };

type M = { id: string; name: string; operator: string; category: string; aspType: string; aspName: string; note: string; noSolicitation: boolean; reason: string };

export function MediaEditor({ media, others }: { media: M; others: { id: string; label: string }[] }) {
  const router = useRouter();
  const [m, setM] = useState(media);
  const [mergeInto, setMergeInto] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof M, v: string) => setM({ ...m, [k]: v });

  const run = async (f: () => Promise<{ ok: boolean; error?: string }>, ok: string, after?: () => void) => {
    setBusy(true);
    const r = await f();
    setBusy(false);
    setMsg(r.ok ? ok : r.error ?? "失敗しました");
    if (r.ok) (after ?? (() => router.refresh()))();
  };

  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <label style={lab}>媒体名</label>
      <input style={input} value={m.name} onChange={(e) => set("name", e.target.value)} />
      <label style={lab}>運営者</label>
      <input style={input} value={m.operator} onChange={(e) => set("operator", e.target.value)} />
      <label style={lab}>カテゴリ</label>
      <input style={input} value={m.category} onChange={(e) => set("category", e.target.value)} />
      <label style={lab}>取引形態</label>
      <select style={input} value={m.aspType} onChange={(e) => set("aspType", e.target.value)}>
        <option value="unknown">不明</option>
        <option value="direct">直接取引</option>
        <option value="asp">ASP経由</option>
      </select>
      {m.aspType === "asp" && (
        <>
          <label style={lab}>ASP名</label>
          <input style={input} value={m.aspName} onChange={(e) => set("aspName", e.target.value)} />
        </>
      )}
      <label style={lab}>メモ</label>
      <textarea style={{ ...input, minHeight: 70 }} value={m.note} onChange={(e) => set("note", e.target.value)} />
      <p style={{ marginTop: 14 }}>
        <button className="btn" disabled={busy} onClick={() => run(() => updateMediaAction(m.id, m), "保存しました")}>保存する</button>
      </p>

      <hr style={{ margin: "20px 0", border: 0, borderTop: "1px solid #eee" }} />
      <b style={{ fontSize: 14 }}>営業お断り</b>
      <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "4px 0 8px" }}>付けると、すべての案件でこのメディアが「対象外」になります。外しても自動では戻りません。</p>
      <input style={input} placeholder="理由（任意）" value={m.reason} onChange={(e) => set("reason", e.target.value)} />
      <p style={{ marginTop: 10 }}>
        <button
          className="btn ghost sm"
          disabled={busy}
          onClick={() => run(() => setNoSolicitationAction(m.id, !m.noSolicitation, m.reason), m.noSolicitation ? "お断りを外しました" : "お断りに設定しました", () => { setM({ ...m, noSolicitation: !m.noSolicitation }); router.refresh(); })}
        >
          {m.noSolicitation ? "営業お断りを外す" : "営業お断りにする"}
        </button>
        {m.noSolicitation && <span style={{ fontSize: 12.5, color: "#b45309", marginLeft: 10 }}>現在：営業お断り</span>}
      </p>

      {others.length > 0 && (
        <>
          <hr style={{ margin: "20px 0", border: 0, borderTop: "1px solid #eee" }} />
          <b style={{ fontSize: 14 }}>別ドメインのメディアに統合</b>
          <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "4px 0 8px" }}>同じメディアが別ドメインで登録されているとき、記事と候補を統合先に移し、このメディアを削除します。</p>
          <div style={{ display: "flex", gap: 8 }}>
            <select style={input} value={mergeInto} onChange={(e) => setMergeInto(e.target.value)}>
              <option value="">統合先を選ぶ</option>
              {others.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            <button
              className="btn ghost sm"
              disabled={busy || !mergeInto}
              onClick={() => { if (confirm("このメディアを統合先にまとめて削除します。よろしいですか？")) run(() => mergeMediaAction(m.id, mergeInto), "統合しました", () => router.push(`/affiliate/media/${mergeInto}`)); }}
            >
              統合する
            </button>
          </div>
        </>
      )}
      {msg && <p style={{ fontSize: 13, marginTop: 12 }}>{msg}</p>}
    </div>
  );
}
