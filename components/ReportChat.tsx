"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { loadChat, sendChat, type ChatMsg } from "@/app/actions";
import { rebuildFromChat } from "@/app/report-extra-actions";
import { REBUILD_LABEL, type RebuildProposal } from "@/lib/report-sections";
import { Spinner } from "./Loading";

/**
 * レポートについて聞くパネル。右から出す。
 * 質問に答えるほか、広告原稿の書き換え・章の表示／非表示・指示つきの作り直し（確認ボタンを押すと実行）ができる。
 * 実測値は書き換え対象にしていない（Docs/ai-chat-design.md）。
 */

const PRESETS = [
  "まず何から手を付けるべき？",
  "この予算配分にした理由は？",
  "法令で引っかかった原稿を直して",
  "見出しをもっと具体的に書き換えて",
  "Meta広告は配信しない前提で広告手法を作り直して",
  "出稿中の広告の章を非表示にして",
];

export function ReportChat({ id, isGuest = false }: { id: string; isGuest?: boolean }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const router = useRouter();

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
      // 原稿を直した・章の表示を変えたらレポート本体も変わっているので読み直す
      if (a.refresh || a.edits?.some((e) => e.ok)) router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      // 送れなかった質問は残さない。履歴と画面がずれる
      setMsgs((m) => m.slice(0, -1));
      setText(question);
    } finally {
      setBusy(false);
    }
  }

  async function rebuild(p: RebuildProposal, key: string) {
    if (running) return;
    setErr(null);
    setRunning(key);
    try {
      const r = await rebuildFromChat(id, p);
      if (r.waiting) {
        window.location.assign(`/analysis/${id}/waiting`);
        return;
      }
      setMsgs((m) => [...m, { role: "assistant", content: `${REBUILD_LABEL[p.target]}を作り直しました。` }]);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(null);
    }
  }

  // 未登録（ゲスト）は質問できない（AIを呼ぶため）。押したら無料登録へ進める（2026-10-06）
  if (isGuest) {
    return (
      <a className="chat-fab" href="/login?mode=signup" aria-label="レポートについて聞く（無料登録が必要です）">
        <span className="ic">✦</span>
        レポートについて聞く
      </a>
    );
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
              レポートについてお答えします。広告原稿の書き換え、章の表示・非表示、指示に合わせた作り直しもできます。<br />
              書き換えた原稿は法令チェックと文字数チェックを通ります。作り直しは、確認のボタンを押したときに行います。
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
                {m.edits && m.edits.length > 0 && (
                  <div className="medits">
                    {m.edits.map((e, k) =>
                      e.ok ? (
                        <div className="ed ok" key={k}>
                          <b>{e.label}</b>
                          <s>{e.before}</s>
                          <span>{e.after}</span>
                        </div>
                      ) : (
                        <div className="ed ng" key={k}>
                          <b>{e.id} は書き換えできませんでした</b>
                          <span>{e.reason}</span>
                        </div>
                      )
                    )}
                  </div>
                )}
                {m.proposals && m.proposals.length > 0 && (
                  <div className="medits">
                    {m.proposals.map((p, k) => {
                      const key = `${i}-${k}`;
                      return (
                        <div className="ed ok" key={key}>
                          <b>{REBUILD_LABEL[p.target]}を作り直す</b>
                          <span>指示：{p.instruction}</span>
                          {p.excludeChannels.length > 0 && <span>外す媒体：{p.excludeChannels.join("、")}</span>}
                          <small style={{ display: "block", color: "var(--muted)" }}>
                            今の内容は置き換わります（{p.target === "ad_plan" ? "5〜10分" : "1〜2分"}）。指示は以後の作り直しにも使います。
                          </small>
                          <button className="btn" style={{ marginTop: 6 }} disabled={!!running || busy} onClick={() => rebuild(p, key)}>
                            {running === key ? <Spinner label="作り直しています" /> : "この指示で作り直す"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
                {m.flags && m.flags.length > 0 && (
                  <div className="mflag">
                    この回答に法令上の注意語が含まれます（{m.flags.map((f) => `「${f.text}」`).join("・")}）。
                    広告に使う文言は「コピーと法令チェック」の検査済みのものを使ってください。
                  </div>
                )}
              </div>
            ))}

            {busy && <div className="m a dim"><Spinner label="考えています" /></div>}
            {err && <div className="m err">{err}</div>}
            <div ref={bottom} />
          </div>

          <div className="cf">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="質問・修正の指示を入力（例：この見出しを短くして）"
              rows={2}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ask(text);
              }}
            />
            <button className="btn" onClick={() => ask(text)} disabled={busy || !text.trim()}>
              送信
            </button>
            <small>原稿の書き換え・章の非表示・指示つきの作り直しができます。実測値（スコア・順位・アクセス数）は変更できません。⌘+Enter でも送信。</small>
          </div>
        </aside>
      )}
    </>
  );
}
