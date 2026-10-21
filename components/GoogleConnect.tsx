"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { disconnectGoogle } from "@/app/actions";

/**
 * Search Console / GA4 / YouTube を読む許可をもらう。ログインしているアカウントとは別の Google アカウントでも許可できる
 * （許可の画面でアカウントを選ぶ。更新トークンを受け取るため access_type=offline と prompt=consent を付ける：lib/gbp/oauth.ts）。
 */
export function GoogleConnect({ connected, isGuest = false }: { connected: boolean; isGuest?: boolean }) {
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  // 2026-10-21: ログイン（Supabase）を経由せず、別の OAuth で許可をもらう（/api/gbp/start?kind=gsc）。
  // 以前はログイン経由だったため、ログインと別の Google アカウントで許可すると、ログインまで切り替わっていた
  function connect() {
    setErr(null);
    location.href = "/api/gbp/start?kind=gsc";
  }

  if (connected) {
    return (
      <>
        <button
          className="btn ghost sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              await disconnectGoogle();
              router.refresh();
            })
          }
        >
          {pending ? "処理中…" : "連携を解除"}
        </button>
        {err && <p style={{ color: "var(--ng)", fontSize: 12 }}>{err}</p>}
      </>
    );
  }

  // 未登録（ゲスト）は連携の前に無料登録へ進める（2026-10-06）
  if (isGuest) {
    return <a className="btn sm" href="/login?mode=signup">Google と連携する</a>;
  }

  return (
    <>
      <button className="btn sm" onClick={connect}>Google と連携する</button>
      {err && <p style={{ color: "var(--ng)", fontSize: 12, marginTop: 6 }}>{err}</p>}
    </>
  );
}
