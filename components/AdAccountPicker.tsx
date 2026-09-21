"use client";

import { useEffect, useState, useTransition } from "react";
import {
  googleAccountPicker,
  googleChildAccounts,
  saveGoogleSelection,
  type AdPickerAccount,
  type AdSelection,
} from "@/app/ad-actions";

/**
 * Google 広告：分析する広告アカウントの選択。
 * MCC（管理者アカウント）は一覧に「MCC」と表示し、開くと配下のアカウントが出る。
 * MCC そのものは選べない（実績を持たないため）。選べるのは配下のアカウントだけ。
 */

type Node = AdPickerAccount & {
  /** このアカウントを開くとき／選ぶときに使う、最上位の MCC */
  root: string | null;
  open?: boolean;
  loading?: boolean;
  error?: string;
  children?: Node[];
};

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

export function AdAccountPicker() {
  const [state, setState] = useState<"loading" | "off" | "ready">("loading");
  const [nodes, setNodes] = useState<Node[]>([]);
  const [picked, setPicked] = useState<Map<string, AdSelection>>(new Map());
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, startSave] = useTransition();

  useEffect(() => {
    googleAccountPicker().then((r) => {
      if (!r.connected) return setState("off");
      setNodes(r.accounts.map((a) => ({ ...a, root: a.manager ? a.id : null })));
      setPicked(new Map(r.selected.map((s) => [s.id, s])));
      if (r.error) setErr(`アカウント一覧を取れませんでした：${r.error}`);
      setState("ready");
    });
  }, []);

  /** path は nodes 内の位置（インデックスの列） */
  function update(path: number[], fn: (n: Node) => Node) {
    const walk = (list: Node[], depth: number): Node[] =>
      list.map((n, i) => {
        if (i !== path[depth]) return n;
        if (depth === path.length - 1) return fn(n);
        return { ...n, children: walk(n.children ?? [], depth + 1) };
      });
    setNodes((cur) => walk(cur, 0));
  }

  async function toggleOpen(n: Node, path: number[]) {
    if (n.open) return update(path, (x) => ({ ...x, open: false }));
    if (n.children) return update(path, (x) => ({ ...x, open: true }));
    update(path, (x) => ({ ...x, open: true, loading: true, error: undefined }));
    const r = await googleChildAccounts(n.id, n.root);
    update(path, (x) => ({
      ...x,
      loading: false,
      error: r.error,
      children: r.error ? undefined : r.accounts.map((a) => ({ ...a, root: n.root ?? n.id })),
    }));
  }

  function toggle(n: Node) {
    setSaved(false);
    setPicked((cur) => {
      const m = new Map(cur);
      if (m.has(n.id)) m.delete(n.id);
      else m.set(n.id, { id: n.id, name: n.name, loginCustomerId: n.root });
      return m;
    });
  }

  function save() {
    setErr(null);
    setSaved(false);
    startSave(async () => {
      const r = await saveGoogleSelection([...picked.values()].map((s) => ({ id: s.id, loginCustomerId: s.loginCustomerId })));
      if ("error" in r) setErr(r.error);
      else setSaved(true);
    });
  }

  if (state === "off") return null;

  const row = (n: Node, path: number[], depth: number): React.ReactNode => (
    <div key={`${path.join("-")}-${n.id}`}>
      <div className="r" style={{ paddingLeft: 16 + depth * 24, gap: 12 }}>
        {n.manager ? (
          <div style={{ flex: 1, minWidth: 0 }}>
            <b>{n.name}</b>
            <span style={badge}>MCC（管理者アカウント）</span>
            <small>ID: {n.id}。開くと、配下の広告アカウントを選べます</small>
          </div>
        ) : (
          <label style={{ flex: 1, minWidth: 0, display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
            <input type="checkbox" checked={picked.has(n.id)} onChange={() => toggle(n)} style={{ marginTop: 4 }} />
            <span style={{ minWidth: 0 }}>
              <b>{n.name}</b>
              <small style={{ display: "block" }}>ID: {n.id}</small>
            </span>
          </label>
        )}
        {n.manager && (
          <button className="btn ghost sm" onClick={() => toggleOpen(n, path)} disabled={n.loading}>
            {n.loading ? "読み込み中…" : n.open ? "閉じる" : "配下を開く"}
          </button>
        )}
      </div>
      {n.manager && n.open && (
        <>
          {n.error && (
            <div className="r" style={{ paddingLeft: 40 + depth * 24 }}>
              <small>配下を取れませんでした：{n.error}</small>
            </div>
          )}
          {n.children?.length === 0 && (
            <div className="r" style={{ paddingLeft: 40 + depth * 24 }}>
              <small>配下に有効なアカウントがありません</small>
            </div>
          )}
          {n.children?.map((c, i) => row(c, [...path, i], depth + 1))}
        </>
      )}
    </div>
  );

  return (
    <div className="rows" style={{ maxWidth: 620, margin: "32px auto 0" }}>
      <div className="rh">広告アカウントの選択（Google 広告）</div>
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
      {state === "ready" && nodes.map((n, i) => row(n, [i], 0))}
      {state === "ready" && (
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
