"use client";

import { useEffect, useRef, useState } from "react";
import { loadChat, sendChat, type ChatMsg } from "@/app/actions";

/**
 * レポートについて聞くパネル。右から出す。
 * この段階では読んで答えるだけで、レポートは書き換えない。
 */

const PRESETS = [
  "まず何から手を付けるべき？",
  "この予算配分にした理由は？",
  "競合と比べて弱いのはどこ？",
  "計測タグは何が足りない？",
];

export function ReportChat({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || loaded) return;
    setLoaded(true);
    loadChat(id).then(setMsgs).catch(() => {});
  }, [open, loaded, id]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, busy]);

  async function ask(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    setErr(null);
    setText("");
    setMsgs((m) => [...m, { role: "user", content: question }]);
    setBusy(true);
    try {
      const a = await sendChat(id, question);
      setMsgs((m) => [...m, a]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      // 送れなかった質問は残さない。履歴と画面がずれる
      setMsgs((m) => m.slice(0, -1));
      setText(question);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="chat-fab" onClick={() => setOpen(true)} aria-label="レポートについて聞く">
        <span className="ic">✦</span>
        レポートについて聞く
      </button>

      {open && (
        <aside className="chat" role="dialog" aria-label="レポートについて聞く">
          <div className="ch">
            <b>レポートについて聞く</b>
            <button onClick={() => setOpen(false)} aria-label="閉じる">✕</button>
          </div>

          <div className="cb">
            <div className="m a">
              このレポートの内容についてお答えします。<br />
              レポートに書かれていることだけを根拠に答えます。
            </div>

            {msgs.length === 0 && (
              <div className="presets">
                {PRESETS.map((p) => (
                  <button key={p} onClick={() => ask(p)} disabled={busy}>{p}</button>
                ))}
              </div>
            )}

            {msgs.map((m, i) => (
              <div key={i} className={`m ${m.role === "user" ? "u" : "a"}`}>
                {m.content}
                {m.flags && m.flags.length > 0 && (
                  <div className="mflag">
                    この回答に法令上の注意語が含まれます（{m.flags.map((f) => `「${f.text}」`).join("・")}）。
                    広告に使う文言は「コピーと法令チェック」の検査済みのものを使ってください。
                  </div>
                )}
              </div>
            ))}

            {busy && <div className="m a dim">考えています…</div>}
            {err && <div className="m err">{err}</div>}
            <div ref={bottom} />
          </div>

          <div className="cf">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="質問を入力（例：まず何から手を付けるべき？）"
              rows={2}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ask(text);
              }}
            />
            <button className="btn" onClick={() => ask(text)} disabled={busy || !text.trim()}>
              送信
            </button>
            <small>レポートの修正はこの画面からはできません。⌘+Enter でも送信できます。</small>
          </div>
        </aside>
      )}
    </>
  );
}
