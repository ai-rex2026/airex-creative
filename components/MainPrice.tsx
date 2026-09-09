"use client";

import { useState, useTransition } from "react";
import { setMainPrice } from "@/app/actions";
import type { PriceItem, PriceScan } from "@/lib/pricing";
import { Spinner } from "./Loading";

/**
 * 損益分岐CPAの土台にする商材を選び直す。
 *
 * 自動で拾った価格は最頻の桁帯から選んでいるが、
 * 掲載価格が幅広いサイトでは実際の主力と違うことがある。
 * 初期値はそのままに、あとから押し替えられるようにする。
 */
export function MainPrice({
  id,
  pricing,
  onChange,
}: {
  id: string;
  pricing: PriceScan;
  onChange: (p: PriceScan) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [yen, setYen] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, start] = useTransition();

  function pick(item: PriceItem) {
    setErr(null);
    start(async () => {
      try {
        onChange(await setMainPrice(id, item));
        setOpen(false);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    });
  }

  function pickManual() {
    const n = Number(yen.replace(/[^\d]/g, ""));
    if (!n) return;
    pick({ name: name.trim() || "手入力の価格", yen: n });
  }

  // 同じ価格が何度も出るサイトがあるので、名前と金額で重複を落とす
  const seen = new Set<string>();
  const list = pricing.items.filter((x) => {
    const k = `${x.name}/${x.yen}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return (
    <>
      <div className="r">
        <div style={{ flex: 1, minWidth: 0 }}>
          <b>{pricing.main?.name}</b>
          <small>主力商材として採用した価格</small>
        </div>
        <span className="tag">{pricing.main?.yen.toLocaleString()}円</span>
        <button className="linkbtn" onClick={() => setOpen(!open)} disabled={busy}>
          {busy ? <Spinner label="変更中" /> : open ? "閉じる" : "変える"}
        </button>
      </div>

      {open && (
        <div className="pickprice">
          <p>掲載価格から選び直せます。ここで選んだ価格で損益分岐CPAを計算し直します。</p>
          <div className="opts">
            {list.slice(0, 24).map((x, i) => (
              <button
                key={i}
                className={pricing.main && x.name === pricing.main.name && x.yen === pricing.main.yen ? "on" : ""}
                onClick={() => pick(x)}
                disabled={busy}
              >
                <b>{x.name}</b>
                <span>{x.yen.toLocaleString()}円</span>
              </button>
            ))}
          </div>
          <div className="manual">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="商材名（任意）" />
            <input
              value={yen}
              onChange={(e) => setYen(e.target.value)}
              placeholder="価格（円）"
              inputMode="numeric"
              onKeyDown={(e) => { if (e.key === "Enter") pickManual(); }}
            />
            <button className="btn" onClick={pickManual} disabled={busy || !yen.trim()}>
              この価格にする
            </button>
          </div>
          <small>サイトに載っていない価格でも入れられます。実際の主力商材に合わせてください。</small>
        </div>
      )}
      {err && <div className="alert" style={{ marginTop: 10 }}>{err}</div>}
    </>
  );
}
