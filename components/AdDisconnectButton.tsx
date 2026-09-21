"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { disconnectAd } from "@/app/ad-actions";

export function AdDisconnectButton({ platform }: { platform: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      className="btn ghost sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await disconnectAd(platform);
          router.refresh();
        })
      }
    >
      {pending ? "処理中…" : "連携を解除"}
    </button>
  );
}
