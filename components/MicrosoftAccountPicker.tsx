"use client";

import { useEffect, useState, useTransition } from "react";
import {
  microsoftAccountPicker,
  saveMicrosoftSelection,
  type MicrosoftPickerAccount,
  type MicrosoftSelection,
} from "@/app/ad-actions";

/**
 * Microsoft 広告：分析する広告アカウントの選択。
 * SearchAccounts（lib/ads/microsoft.ts）がアクセスできる広告アカウントをすでにフラットな一覧で
 * 返すため、Google（components/AdAccountPicker.tsx）やヤフーLINE広告（YahooAccountPicker.tsx）の
 * ような「MCC を開いて配下を辿る」操作は無く、一覧から直接チェックして保存するだけでよい。
 */

const badge: React.CSSProperties = {
  display: "inline-block",
  marginLeft: 8,
  padding: "1px 8px",
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 600,
  background: "var(--accent-soft, #e8f0fe)",
  color: "var(--accent, #1a56db)",
  verticalAlign: "middle",
};

export function MicrosoftAccountPicker() {
  const [state, setState] = useState<"loading" | "off" | "ready">("loading");
  const [accounts, setAccounts] = useState<MicrosoftPickerAccount[]>([]);
  const [picked, setPicked] = useState<Map<string, MicrosoftSelection>>(new Map());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, startSave] = useTransition();

  useEffect(() => {
    microsoftAccountPicker().then((r) => {
      if (!r.connected) return setState("off");
      setAccounts(r.accounts);
      setPicked(new Map(r.selected.map((s) => [s.id, s])));
      setLoadError(r.error ?? null);
      setState("ready");
    });
  }, []);

  function toggle(a: MicrosoftPickerAccount) {
    setSaved(false);
    setPicked((cur) => {
      const m = new Map(cur);
      if (m.has(a.id)) m.delete(a.id);
      // customerId はサーバー側で保存時に Microsoft から取り直すので、ここでは空でよい
      else m.set(a.id, { id: a.id, name: a.name, customerId: "" });
      return m;
    });
  }

  function save() {
    setErr(null);
    setSaved(false);
    startSave(async () => {
      const r = await saveMicrosoftSelection([...picked.values()].map((s) => ({ id: s.id })));
      if ("error" in r) setErr(r.error);
      else setSaved(true);
    });
  }

  if (state === "off") return null;

  return (
    <div className="rows" style={{ maxWidth: 620, margin: "32px auto 0" }}>
      <div className="rh">
        広告アカウントの選択（Microsoft 広告）
        <span style={badge}>本番未検証</span>
      </div>
      {state === "loading" && (
        <div className="r">
          <small>アカウントを読み込み中…</small>
        </div>
      )}
      {loadError && (
        <div className="r">
          <small style={{ color: "var(--danger, #b42318)" }}>アカウント一覧を取れませんでした：{loadError}</small>
        </div>
      )}
      {err && (
        <div className="r">
          <small style={{ color: "var(--danger, #b42318)" }}>{err}</small>
        </div>
      )}
      {state === "ready" && accounts.length === 0 && !loadError && (
        <div className="r">
          <small>アカウントを取れていません。設定画面でもう一度連携し直してください。</small>
        </div>
      )}
      {state === "ready" &&
        accounts.map((a) => (
          <div className="r" key={a.id} style={{ gap: 12 }}>
            <label style={{ flex: 1, minWidth: 0, display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
              <input type="checkbox" checked={picked.has(a.id)} onChange={() => toggle(a)} style={{ marginTop: 4 }} />
              <span style={{ minWidth: 0 }}>
                <b>{a.name}</b>
                <small style={{ display: "block" }}>ID: {a.id}</small>
              </span>
            </label>
          </div>
        ))}
      {state === "ready" && accounts.length > 0 && (
        <div className="r" style={{ gap: 12 }}>
          <small style={{ flex: 1 }}>
            {picked.size > 0 ? `${picked.size}件を選択中` : "分析する広告アカウントを選んでください"}
            {saved && "。保存しました"}
          </small>
          <button className="btn sm" onClick={save} disabled={saving}>
            {saving ? "保存中…" : "この選択を保存"}
          </button>
        </div>
      )}
    </div>
  );
}
