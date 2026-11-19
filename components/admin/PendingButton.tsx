"use client";

import { useFormStatus } from "react-dom";

/** 送信中は押せなくして、処理中だと分かる表示（回るマーク＋文言）を出す。長い処理（AI を続けて呼ぶ）のボタン用 */
export function PendingButton({ children, pendingText, className = "btn sm ghost", name, value }: { children: React.ReactNode; pendingText: string; className?: string; name?: string; value?: string }) {
  const { pending } = useFormStatus();
  return (
    <>
      <button className={className} type="submit" name={name} value={value} disabled={pending} aria-busy={pending}>
        {pending ? "処理中…" : children}
      </button>
      {pending && (
        <span role="status" style={{ marginLeft: 10, fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span aria-hidden style={{ width: 12, height: 12, border: "2px solid var(--line)", borderTopColor: "var(--ink, #333)", borderRadius: "50%", display: "inline-block", animation: "pb-spin 0.8s linear infinite" }} />
          {pendingText}
          <style>{`@keyframes pb-spin{to{transform:rotate(360deg)}}`}</style>
        </span>
      )}
    </>
  );
}
