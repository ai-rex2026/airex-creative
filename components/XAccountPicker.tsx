"use client";

import { useEffect, useState, useTransition } from "react";
import {
  xAccountPicker,
  saveXSelection,
  type XPickerAccount,
  type XSelection,
} from "@/app/ad-actions";
import { XPerformance } from "./XPerformance";

/**
 * X 広告：分析する広告アカウントの選択。
 * Ads API の /accounts（lib/ads/x.ts の xAdAccounts）が、このユーザーのトークンでアクセスできる
 * 広告アカウントをすでにフラットな一覧で返すため、Google（AdAccountPicker.tsx）やヤフーLINE広告
 * （YahooAccountPicker.tsx）のような「MCC を開いて配下を辿る」操作は無く、一覧から直接
 * チェックして保存するだけでよい（Microsoft・Meta 広告と同じ考え方）。
 *
 * 広告実績（XPerformance）は、構造的にはこの「広告アカウントの選択」に従属する内容なので、
 * 別セクションとして並べるのではなく同じ .rows カード内に一続きのサブセクションとして
 * 埋め込む（他媒体の *AccountPicker.tsx も同じ構成。app/analysis/new/page.tsx 側では
 * 対応する *Performance は個別に描画しない）。
 */

export function XAccountPicker() {
  const [state, setState] = useState<"loading" | "off" | "ready">("loading");
  const [accounts, setAccounts] = useState<XPickerAccount[]>([]);
  const [picked, setPicked] = useState<Map<string, XSelection>>(new Map());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, startSave] = useTransition();

  useEffect(() => {
    xAccountPicker().then((r) => {
      if (!r.connected) return setState("off");
      setAccounts(r.accounts);
      setPicked(new Map(r.selected.map((s) => [s.id, s])));
      setLoadError(r.error ?? null);
      setState("ready");
    });
  }, []);

  function toggle(a: XPickerAccount) {
    setSaved(false);
    setPicked((cur) => {
      const m = new Map(cur);
      if (m.has(a.id)) m.delete(a.id);
      else m.set(a.id, { id: a.id, name: a.name });
      return m;
    });
  }

  function save() {
    setErr(null);
    setSaved(false);
    startSave(async () => {
      const r = await saveXSelection([...picked.values()].map((s) => ({ id: s.id })));
      if ("error" in r) setErr(r.error);
      else setSaved(true);
    });
  }

  if (state === "off") return null;

  return (
    <div className="rows" style={{ maxWidth: 960, margin: "32px auto 0" }}>
      <div className="rh">広告アカウントの選択（X 広告）</div>
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
      <XPerformance />
    </div>
  );
}
