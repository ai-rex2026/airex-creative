"use client";

import { useEffect, useState, useTransition } from "react";
import { yahooAccountPicker, saveYahooSelection } from "@/app/ad-actions";
import type { AdAccount } from "@/lib/ads/accounts";

/**
 * ヤフーLINE広告：分析する広告アカウントの選択。
 * BaseAccountService/get の一覧はすでにフラット（MCC・広告アカウントが1階層で並ぶ）なので、
 * Google（components/AdAccountPicker.tsx）のような「MCC を開いて配下を取る」操作はない。
 * MCC（管理者アカウント）はラベルとして出すだけで、選べるのは配下の広告アカウントだけ。
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

export function YahooAccountPicker() {
  const [state, setState] = useState<"loading" | "off" | "ready">("loading");
  const [accounts, setAccounts] = useState<AdAccount[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, startSave] = useTransition();

  useEffect(() => {
    yahooAccountPicker().then((r) => {
      if (!r.connected) return setState("off");
      setAccounts(r.accounts);
      setPicked(new Set(r.selected.map((s) => s.id)));
      setState("ready");
    });
  }, []);

  function toggle(a: AdAccount) {
    setSaved(false);
    setPicked((cur) => {
      const s = new Set(cur);
      if (s.has(a.id)) s.delete(a.id);
      else s.add(a.id);
      return s;
    });
  }

  function save() {
    setErr(null);
    setSaved(false);
    startSave(async () => {
      const r = await saveYahooSelection([...picked]);
      if ("error" in r) setErr(r.error);
      else setSaved(true);
    });
  }

  if (state === "off") return null;

  const selectable = accounts.filter((a) => !a.manager);

  return (
    <div className="rows" style={{ maxWidth: 620, margin: "32px auto 0" }}>
      <div className="rh">広告アカウントの選択（ヤフーLINE広告）</div>
      {state === "loading" && (
        <div className="r">
          <small>アカウントを読み込み中…</small>
        </div>
      )}
      {err && (
        <div className="r">
          <small style={{ color: "var(--danger, #b42318)" }}>{err}</small>
        </div>
      )}
      {state === "ready" && accounts.length === 0 && (
        <div className="r">
          <small>アカウントを取れていません。設定画面でもう一度連携し直してください。</small>
        </div>
      )}
      {state === "ready" &&
        accounts.map((a) => (
          <div className="r" key={a.id} style={{ gap: 12 }}>
            {a.manager ? (
              <div style={{ flex: 1, minWidth: 0 }}>
                <b>{a.name}</b>
                <span style={badge}>MCC（管理者アカウント）</span>
                <small>ID: {a.id}。MCC自体は実績を持たないため選べません</small>
              </div>
            ) : (
              <label style={{ flex: 1, minWidth: 0, display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
                <input type="checkbox" checked={picked.has(a.id)} onChange={() => toggle(a)} style={{ marginTop: 4 }} />
                <span style={{ minWidth: 0 }}>
                  <b>{a.name}</b>
                  <small style={{ display: "block" }}>ID: {a.id}</small>
                </span>
              </label>
            )}
          </div>
        ))}
      {state === "ready" && selectable.length > 0 && (
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
