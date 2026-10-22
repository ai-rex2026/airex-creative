"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteCampaignAction, updateCampaignAction } from "@/app/affiliate-actions";
import type { CampaignBrief } from "@/lib/affiliate/board";

const input: React.CSSProperties = { width: "100%", padding: "8px 10px", border: "1px solid var(--line, #ddd)", borderRadius: 8, fontSize: 14, background: "#fff" };
const lab: React.CSSProperties = { display: "block", fontSize: 12.5, color: "var(--muted)", margin: "12px 0 4px" };

export function InfoForm({ id, brief }: { id: string; brief: CampaignBrief }) {
  const router = useRouter();
  const [f, setF] = useState(brief);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const bind = (k: keyof CampaignBrief) => ({ value: f[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value }) });

  const save = async () => {
    setBusy(true);
    const r = await updateCampaignAction(id, {
      name: f.name, clientName: f.clientName, productName: f.productName, lpUrl: f.lpUrl, unitPrice: f.unitPrice, conversionPoint: f.conversionPoint,
      approvalTerms: f.approvalTerms, sellingPoints: f.sellingPoints, genre: f.genre, referenceUrl: f.referenceUrl, draftUrl: f.draftUrl, brief: f.brief,
    });
    setBusy(false);
    setMsg(r.ok ? "保存しました" : r.error);
    if (r.ok) router.refresh();
  };

  const Field = ({ k, label, area }: { k: keyof CampaignBrief; label: string; area?: boolean }) => (
    <>
      <label style={lab}>{label}</label>
      {area ? <textarea style={{ ...input, minHeight: 70 }} {...bind(k)} /> : <input style={input} {...bind(k)} />}
    </>
  );

  return (
    <div className="panel">
      {Field({ k: "name", label: "案件名" })}
      {Field({ k: "clientName", label: "クライアント名" })}
      {Field({ k: "productName", label: "商材名" })}
      {Field({ k: "genre", label: "ジャンル" })}
      {Field({ k: "lpUrl", label: "商品LPのURL" })}
      {Field({ k: "referenceUrl", label: "参考記事のURL" })}
      {Field({ k: "draftUrl", label: "原稿のURL" })}
      {Field({ k: "unitPrice", label: "単価" })}
      {Field({ k: "conversionPoint", label: "成果地点" })}
      {Field({ k: "approvalTerms", label: "承認条件" })}
      {Field({ k: "sellingPoints", label: "訴求ポイント", area: true })}
      {Field({ k: "brief", label: "メモ", area: true })}
      <p style={{ marginTop: 16, display: "flex", gap: 10, alignItems: "center" }}>
        <button className="btn" disabled={busy} onClick={save}>{busy ? "保存中…" : "保存する"}</button>
        <button
          className="btn ghost"
          disabled={busy}
          onClick={async () => {
            if (!confirm("この案件と収集結果をすべて削除します。よろしいですか？")) return;
            const r = await deleteCampaignAction(id);
            if (r.ok) router.push("/affiliate");
            else setMsg(r.error);
          }}
        >
          案件を削除
        </button>
        {msg && <span style={{ fontSize: 13 }}>{msg}</span>}
      </p>
    </div>
  );
}
