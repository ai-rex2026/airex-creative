"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCampaignAction, proposeCampaignAction, type CampaignDraft } from "@/app/affiliate-actions";

const input: React.CSSProperties = { width: "100%", padding: "8px 10px", border: "1px solid var(--line, #ddd)", borderRadius: 8, fontSize: 14, background: "#fff" };
const lab: React.CSSProperties = { display: "block", fontSize: 12.5, color: "var(--muted)", margin: "12px 0 4px" };

export function NewCampaign() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<CampaignDraft | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();

  const propose = () =>
    start(async () => {
      setErr("");
      const r = await proposeCampaignAction({ url, text });
      if (!r.ok) return setErr(r.error);
      setDraft(r.draft);
      setNote(r.note ?? "");
      // 初期選択：優先度1〜2のものだけ（収集は1KWごとに外部APIの料金がかかるため）
      setPicked(new Set(r.draft.keywords.filter((k) => k.priority <= 2).map((k) => k.keyword)));
    });

  const create = () =>
    start(async () => {
      if (!draft) return;
      setErr("");
      const r = await createCampaignAction({
        client_name: draft.client_name,
        campaign_name: draft.campaign_name,
        product_name: draft.product_name,
        selling_points: draft.selling_points,
        conversion_point: draft.conversion_point,
        lp_url: url,
        keywords: draft.keywords.filter((k) => picked.has(k.keyword)),
      });
      if (!r.ok) return setErr(r.error);
      router.push(`/affiliate/${r.campaignId}`);
    });

  const set = (k: keyof CampaignDraft, v: string) => draft && setDraft({ ...draft, [k]: v });

  return (
    <div style={{ marginTop: 14 }}>
      {!draft ? (
        <div className="panel">
          <label style={lab}>商品LPのURL</label>
          <input style={input} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/lp" />
          <label style={lab}>商品の説明・メモ（任意。URLが無い場合はこちらだけでも可）</label>
          <textarea style={{ ...input, minHeight: 110 }} value={text} onChange={(e) => setText(e.target.value)} />
          <p style={{ marginTop: 16 }}>
            <button className="btn" disabled={pending || (!url.trim() && !text.trim())} onClick={propose}>
              {pending ? "AIが案件を作っています…" : "AIで案件とKWを作る"}
            </button>
          </p>
        </div>
      ) : (
        <div className="panel">
          {note && <p style={{ fontSize: 12.5, color: "#92400e" }}>{note}</p>}
          <label style={lab}>案件名</label>
          <input style={input} value={draft.campaign_name} onChange={(e) => set("campaign_name", e.target.value)} />
          <label style={lab}>クライアント名</label>
          <input style={input} value={draft.client_name} onChange={(e) => set("client_name", e.target.value)} />
          <label style={lab}>商材名</label>
          <input style={input} value={draft.product_name} onChange={(e) => set("product_name", e.target.value)} />
          <label style={lab}>成果地点</label>
          <input style={input} value={draft.conversion_point} onChange={(e) => set("conversion_point", e.target.value)} />
          <label style={lab}>訴求ポイント</label>
          <textarea style={{ ...input, minHeight: 70 }} value={draft.selling_points} onChange={(e) => set("selling_points", e.target.value)} />

          <label style={lab}>収集するキーワード（{picked.size}/{draft.keywords.length}件を選択。1件ごとに検索APIとAIの利用料がかかります）</label>
          <div style={{ maxHeight: 320, overflowY: "auto", border: "1px solid var(--line, #ddd)", borderRadius: 8 }}>
            {draft.keywords.map((k) => (
              <label key={k.keyword} style={{ display: "flex", gap: 10, padding: "7px 10px", fontSize: 13.5, borderBottom: "1px solid #eee" }}>
                <input
                  type="checkbox"
                  checked={picked.has(k.keyword)}
                  onChange={() => {
                    const n = new Set(picked);
                    if (n.has(k.keyword)) n.delete(k.keyword);
                    else n.add(k.keyword);
                    setPicked(n);
                  }}
                />
                <span style={{ flex: 1 }}>{k.keyword}</span>
                <span style={{ color: "var(--muted)" }}>{k.search_volume != null ? `月 ${k.search_volume.toLocaleString()}` : "—"}</span>
              </label>
            ))}
          </div>
          <p style={{ marginTop: 16, display: "flex", gap: 10 }}>
            <button className="btn" disabled={pending || picked.size === 0} onClick={create}>{pending ? "作成中…" : "案件を作成する"}</button>
            <button className="btn ghost" disabled={pending} onClick={() => setDraft(null)}>やり直す</button>
          </p>
        </div>
      )}
      {err && <p style={{ color: "#b91c1c", fontSize: 13, marginTop: 12 }}>{err}</p>}
    </div>
  );
}
