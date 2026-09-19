"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { disconnectMeta } from "@/app/actions";

// lib/meta.ts の META_SCOPES と同じ内容を保つこと（クライアント側でこのファイルだけ独立して使うため複製）
const SCOPES = "pages_show_list,pages_read_engagement,instagram_basic,instagram_manage_insights";

/**
 * Instagram / Facebook Page の許可をもらう。
 * Facebookはrefresh_tokenを発行しないため、コールバック側（app/auth/callback）で
 * 長期トークンに交換して保存する。ここではSupabaseのOAuthダイアログを開くだけ。
 */
export function MetaConnect({ connected }: { connected: boolean }) {
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
    const opts = { redirectTo, scopes: SCOPES };
    const res = user?.is_anonymous
      ? await sb.auth.linkIdentity({ provider: "facebook", options: opts })
      : await sb.auth.signInWithOAuth({ provider: "facebook", options: opts });
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
              await disconnectMeta();
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
      <button className="btn sm" onClick={connect}>Instagram / Facebook と連携する</button>
      {err && <p style={{ color: "var(--ng)", fontSize: 12, marginTop: 6 }}>{err}</p>}
    </>
  );
}
