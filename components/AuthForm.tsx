"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { signIn, signUp } from "@/app/actions";
import { createClient } from "@/lib/supabase/client";

export function AuthForm({
  callbackUrl,
  initialMode,
  initialError,
}: {
  callbackUrl: string;
  initialMode: "signin" | "signup";
  initialError?: string | null;
}) {
  const [mode, setMode] = useState(initialMode);
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(initialError ?? null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const signup = mode === "signup";

  /**
   * ゲスト（匿名）のままなら linkIdentity で今のアカウントに Google を紐づける。
   * そうしないと別ユーザーが出来てしまい、いま作った分析が見えなくなる。
   */
  async function google() {
    setErr(null);
    const sb = createClient();
    const redirectTo = `${location.origin}/auth/callback?next=${encodeURIComponent(callbackUrl)}`;
    const {
      data: { user },
    } = await sb.auth.getUser();

    const res = user?.is_anonymous
      ? await sb.auth.linkIdentity({ provider: "google", options: { redirectTo } })
      : await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo } });

    if (res.error) setErr(res.error.message);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    start(async () => {
      const res = signup ? await signUp(email, pw) : await signIn(email, pw);
      if (res?.error) {
        setErr(res.error);
        return;
      }
      router.replace(callbackUrl);
      router.refresh();
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

      <div className="card" style={{ paddingBottom: 20 }}>
        <button type="button" className="btn ghost" style={{ width: "100%", justifyContent: "center" }} onClick={google}>
          <GoogleMark />
          Google で{signup ? "登録" : "ログイン"}
        </button>
        <div className="or"><span>または</span></div>
      </div>

      <form className="card" style={{ marginTop: 12 }} onSubmit={submit}>
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

function GoogleMark() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.3 13.2 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9.1h12.4c-.5 2.9-2.1 5.3-4.6 6.9l7.1 5.5c4.2-3.9 6.6-9.6 6.6-16.4z" />
      <path fill="#FBBC05" d="M10.4 28.7a14.6 14.6 0 0 1 0-9.4l-7.8-6.1a24 24 0 0 0 0 21.6l7.8-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.1-5.5c-2 1.3-4.6 2.1-8.8 2.1-6.3 0-11.7-3.7-13.6-9.1l-7.8 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}
