"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  addKeywordsAction,
  collectKeywordAction,
  createJobAction,
  deleteKeywordAction,
  enrichEntryAction,
  listEnrichableAction,
  refreshVolumesAction,
  startCollectionAction,
  type RunnableJob,
} from "@/app/affiliate-actions";

export type KwRow = {
  id: string;
  keyword: string;
  priority: number;
  volume: number | null;
  status: string; // none | pending | running | done | error
  found: number;
  ranking: number;
  paid: number;
  error: string;
  snapshotId: string | null;
  collectedAt: string | null;
  source: string;
};

const STATUS: Record<string, string> = { none: "未収集", pending: "未実行", running: "実行中/中断", done: "完了", error: "失敗" };

export function CollectPanel({ campaignId, rows }: { campaignId: string; rows: KwRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [msg, setMsg] = useState("");
  const [add, setAdd] = useState("");
  const stop = useRef(false);

  const say = (s: string) => setLog((l) => [...l.slice(-30), s]);

  /** 1キーワード：収集 → ランキング記事の本文読取。1つ終わるごとに保存済み（失敗しても済んだ分は残る） */
  const runJob = async (j: RunnableJob) => {
    say(`「${j.keyword}」を収集中…`);
    const r = await collectKeywordAction(j.job_id);
    if (!r.ok) {
      say(`「${j.keyword}」失敗：${r.error}`);
      return;
    }
    say(`「${j.keyword}」${r.found}件（ランキング記事${r.ranking_articles}／広告${r.paid}）。記事本文を読み取ります`);
    const list = await listEnrichableAction(r.snapshot_id);
    if (!list.ok) return say(`読取対象を取得できません：${list.error}`);
    let done = 0;
    for (const e of list.entries) {
      if (stop.current) break;
      const er = await enrichEntryAction(e.entry_id, false);
      if (er.ok) done++;
      else say(`　本文の読取に失敗：${e.title.slice(0, 30)}（${er.error}）`);
    }
    say(`「${j.keyword}」本文を${done}/${list.entries.length}件読み取りました`);
  };

  const runAll = async (jobs: RunnableJob[]) => {
    stop.current = false;
    for (const j of jobs) {
      if (stop.current) break;
      await runJob(j);
    }
    say(stop.current ? "中断しました" : "完了しました");
  };

  const start = async (mode: "resume" | "all") => {
    setBusy(true);
    setMsg("");
    setLog([]);
    try {
      const r = await startCollectionAction(campaignId, mode);
      if (!r.ok) return setMsg(r.error);
      if (!r.jobs.length) return setMsg("実行するキーワードはありません（すべて完了済みです）");
      if (mode === "all" && !confirm(`${r.jobs.length}件のキーワードを収集します。検索API・AIの利用料がかかります。よろしいですか？`)) return;
      await runAll(r.jobs);
    } finally {
      setBusy(false);
      router.refresh();
    }
  };

  const one = async (kwId: string) => {
    setBusy(true);
    setMsg("");
    setLog([]);
    try {
      const r = await createJobAction(campaignId, kwId);
      if (!r.ok) return setMsg(r.error);
      await runJob(r.job);
    } finally {
      setBusy(false);
      router.refresh();
    }
  };

  const doAdd = async () => {
    const r = await addKeywordsAction(campaignId, add);
    setMsg(r.ok ? `${r.added}件追加しました` : r.error);
    if (r.ok) setAdd("");
    router.refresh();
  };

  return (
    <div className="panel">
      <h2>キーワードと収集</h2>
      <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "6px 0 12px" }}>
        収集は1キーワードずつ順に実行します。<b>実行中はこの画面を開いたままにしてください</b>（閉じると途中で止まります。済んだ分は保存され、次回は続きから実行します）。
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn sm" disabled={busy || rows.length === 0} onClick={() => start("resume")}>{busy ? "実行中…" : "未収集を収集する"}</button>
        <button className="btn ghost sm" disabled={busy || rows.length === 0} onClick={() => start("all")}>全KWを取り直す（定点観測）</button>
        <button className="btn ghost sm" disabled={busy} onClick={async () => { const r = await refreshVolumesAction(campaignId); setMsg(r.ok ? `検索数を${r.updated}件更新しました` : r.error); router.refresh(); }}>検索数を更新</button>
        {busy && <button className="btn ghost sm" onClick={() => (stop.current = true)}>中断する</button>}
      </div>
      {msg && <p style={{ fontSize: 13, marginTop: 10 }}>{msg}</p>}
      {log.length > 0 && (
        <pre style={{ fontSize: 12, background: "#f6f5f1", padding: 10, borderRadius: 8, marginTop: 10, whiteSpace: "pre-wrap", maxHeight: 200, overflowY: "auto" }}>{log.join("\n")}</pre>
      )}

      <div className="rows" style={{ marginTop: 16 }}>
        <div className="rh">キーワード（{rows.length}件）</div>
        {rows.map((k) => (
          <div className="r" key={k.id}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <b>{k.keyword}</b>
              <small>
                {k.volume != null ? `月 ${k.volume.toLocaleString()} ／ ` : ""}
                {STATUS[k.status] ?? k.status}
                {k.status === "done" ? ` ／ ${k.found}件（ランキング${k.ranking}・広告${k.paid}）` : ""}
                {k.collectedAt ? ` ／ ${new Date(k.collectedAt).toLocaleString("ja-JP")}` : ""}
                {k.status === "error" && k.error ? ` ／ ${k.error.slice(0, 80)}` : ""}
              </small>
            </div>
            <button className="btn ghost sm" disabled={busy} onClick={() => one(k.id)}>収集</button>
            <button className="btn ghost sm" disabled={busy} onClick={async () => { if (!confirm(`「${k.keyword}」を削除しますか？収集結果も消えます。`)) return; await deleteKeywordAction(campaignId, k.id); router.refresh(); }}>削除</button>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <input value={add} onChange={(e) => setAdd(e.target.value)} placeholder="キーワードを追加（改行・読点区切りで複数可）" style={{ flex: 1, padding: "8px 10px", border: "1px solid var(--line, #ddd)", borderRadius: 8 }} />
        <button className="btn ghost sm" disabled={!add.trim()} onClick={doAdd}>追加</button>
      </div>
    </div>
  );
}
