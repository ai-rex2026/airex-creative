"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "@/app/actions";

export function SignOutButton() {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      className="btn ghost sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await signOut();
          router.replace("/");
          router.refresh();
        })
      }
    >
      {pending ? "処理中…" : "ログアウト"}
    </button>
  );
}
