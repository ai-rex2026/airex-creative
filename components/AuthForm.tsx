"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { signIn, signUp } from "@/app/actions";

export function AuthForm({ callbackUrl, initialMode }: { callbackUrl: string; initialMode: "signin" | "signup" }) {
  const [mode, setMode] = useState(initialMode);
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const signup = mode === "signup";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    start(async () => {
      try {
        if (signup) await signUp(email, pw);
        else await signIn(email, pw);
        router.replace(callbackUrl);
        router.refresh();
      } catch (e2) {
        setErr(e2 instanceof Error ? e2.message : String(e2));
      }
    });
  }

  return (
    <div className="inner">
      <h2>{signup ? "アカウント作成" : "ログイン"}</h2>
      <p className="sub">
        {signup
          ? "一時アカウントで作った分析は、そのまま引き継がれます"
          : "メールアドレスとパスワードを入力してください"}
      </p>

      <form className="card" onSubmit={submit}>
        <label htmlFor="email">メールアドレス</label>
        <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="example@email.com" autoComplete="email" required />

        <label htmlFor="pw">
          パスワード
          {!signup && <a href="#">パスワードを忘れた</a>}
        </label>
        <input id="pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)}
          placeholder="••••••••" autoComplete={signup ? "new-password" : "current-password"} minLength={8} required />

        {err && <p style={{ color: "var(--ng)", fontSize: 12.5, marginTop: 12 }}>{err}</p>}

        <button className="btn" type="submit" disabled={pending}>
          {pending ? "処理中…" : signup ? "アカウントを作成する" : "ログインする"}
        </button>
      </form>

      <p className="foot">
        {signup ? "すでにアカウントをお持ちの方は " : "アカウントをお持ちでない方は "}
        <button className="link" style={{ fontWeight: 600, color: "var(--head)" }}
          onClick={() => { setMode(signup ? "signin" : "signup"); setErr(null); }}>
          {signup ? "ログイン" : "新規登録"}
        </button>
      </p>
    </div>
  );
}
