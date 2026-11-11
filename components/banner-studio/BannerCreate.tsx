"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/Loading";
import { createBannerProjectAction } from "@/app/banner-actions";

/** バナー制作の新規登録（URL か説明。素材は開いた画面で取り込む） */
export function BannerCreate() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ok = url.trim().length > 0 || desc.trim().length >= 10;

  async function create() {
    setErr(null);
    setBusy(true);
    try {
      const { id } = await createBannerProjectAction({ name, url, description: desc });
      router.push(`/ads/banners/${id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
      <input className="input" placeholder="名前（例：〇〇 春のキャンペーン）" value={name} onChange={(e) => setName(e.target.value)} />
      <input className="input" placeholder="LP・サイトの URL（任意）" value={url} onChange={(e) => setUrl(e.target.value)} />
      <textarea className="input" rows={4} placeholder="商品・サービスの説明（誰に・何を・強み・価格や条件など。URL が無いときは10字以上）" value={desc} onChange={(e) => setDesc(e.target.value)} />
      {err && <div className="alert">{err}</div>}
      <div>
        <button className="btn" disabled={busy || !ok} onClick={create}>
          {busy ? <Spinner label="作成しています" /> : "作成して素材の取り込みへ"}
        </button>
      </div>
    </div>
  );
}
