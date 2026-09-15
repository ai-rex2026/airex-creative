"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updatePassword } from "@/app/actions";

/**
 * /reset-password で使う。/auth/callback がすでにリカバリー用セッションを
 * 確立しそ後にここへ来るので、あとは新しいパスワードを受け取って更新するだけ。
 */
export function ResetPasswordForm() {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (pw.length < 8) {
      setErr("パスワードは8文字以上で入力してください");
      return;
    }
    if (pw !== pw2) {
      setErr("パスワードが一致しません");
      return;
    }
    start(async () => {
      const res = await updatePassword(pw);
      if (res?.error) {
        setErr(res.error);
        return;
      }
      setDone(true);
    });
  }

  if (done) {
    return (
      <div className="inner">
        <h2>パスワードを再設定しました</h2>
        <p className="sub">新しいパスワードでログインできます。</p>
        <button
          className="btn"
          style={{ width: "100%", justifyContent: "center", marginTop: 18 }}
          onClick={() => {
            router.replace("/analysis");
            router.refresh();
          }}
        >
          はじめる
        </button>
      </div>
    );
  }

  return (
    <div className="inner">
      <h2>新しいパスワードを設定</h2>
      <p className="sub">新しいパスワードを入力してください</p>

      <form className="card" style={{ marginTop: 18 }} onSubmit={submit}>
        <label htmlFor="pw">新しいパスワード</label>
        <input id="pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)}
          placeholder="••••••••" autoComplete="new-password" minLength={8} required />

        <label htmlFor="pw2">新しいパスワード（確認）</label>
        <input id="pw2" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)}
          placeholder="••••••••" autoComplete="new-password" minLength={8} required />

        {err && <p style={{ color: "var(--ng)", fontSize: 12.5, marginTop: 12 }}>{err}</p>}

        <button className="btn" type="submit" disabled={pending}>
          {pending ? "処理中…" : "パスワードを変更する"}
        </button>
      </form>
    </div>
  );
}
