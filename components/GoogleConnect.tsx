"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { disconnectGoogle } from "@/app/actions";

// lib/google.ts の GOOGLE_SCOPES と同じ内容を保つこと（クライアント側でこのファイルだけ独立して使うため複製）
const SCOPES =
  "https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/yt-analytics.readonly";

/**
 * Search Console / GA4 を読む許可をもらう。
 * 更新トークンが要るので access_type=offline と prompt=consent を必ず付ける。
 */
export function GoogleConnect({ connected }: { connected: boolean }) {
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  async function connect() {
    setErr(null);
    const sb = createClient();
    const redirectTo = `${location.origin}/auth/callback?next=${encodeURIComponent("/settings")}`;
    const {
      data: { user },
    } = await sb.auth.getUser();
    const opts = {
      redirectTo,
      scopes: SCOPES,
      queryParams: { access_type: "offline", prompt: "consent" },
    };
    const res = user?.is_anonymous
      ? await sb.auth.linkIdentity({ provider: "google", options: opts })
      : await sb.auth.signInWithOAuth({ provider: "google", options: opts });
    if (res.error) setErr(res.error.message);
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

  return (
    <>
      <button className="btn sm" onClick={connect}>Google と連携する</button>
      {err && <p style={{ color: "var(--ng)", fontSize: 12, marginTop: 6 }}>{err}</p>}
    </>
  );
}
