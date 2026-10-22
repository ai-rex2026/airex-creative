"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addAspAction, deleteAspAction } from "@/app/affiliate-actions";

const input: React.CSSProperties = { padding: "8px 10px", border: "1px solid var(--line, #ddd)", borderRadius: 8, fontSize: 14, background: "#fff" };

export function AspMaster({ rows }: { rows: { id: string; domain: string; asp_name: string }[] }) {
  const router = useRouter();
  const [domain, setDomain] = useState("");
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");
  return (
    <div className="panel" style={{ marginTop: 24 }}>
      <h2>ASPのドメイン対応表</h2>
      <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "6px 0 10px" }}>記事内のリンク先ドメインからASP名を判定するための対応表です。</p>
      <div className="rows">
        {rows.map((r) => (
          <div className="r" key={r.id}>
            <div style={{ flex: 1 }}><b>{r.asp_name}</b><small>{r.domain}</small></div>
            <button className="btn ghost sm" onClick={async () => { await deleteAspAction(r.id); router.refresh(); }}>削除</button>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <input style={{ ...input, flex: 1, minWidth: 160 }} placeholder="ドメイン（例 a8.net）" value={domain} onChange={(e) => setDomain(e.target.value)} />
        <input style={{ ...input, flex: 1, minWidth: 160 }} placeholder="ASP名" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn sm" onClick={async () => { const r = await addAspAction(domain, name); setMsg(r.ok ? "" : r.error); if (r.ok) { setDomain(""); setName(""); router.refresh(); } }}>追加</button>
      </div>
      {msg && <p style={{ color: "#b91c1c", fontSize: 13, marginTop: 8 }}>{msg}</p>}
    </div>
  );
}
