import type { Metadata } from "next";
import { Suspense } from "react";
import { ReviewFlow } from "./ReviewFlow";

export const metadata: Metadata = { title: "ご感想をお聞かせください", robots: { index: false, follow: false } };

/**
 * 店頭の QR から開く口コミ画面（お客様のスマホ。ログイン不要）。
 * 店名・Google の口コミリンク・お店のメール・担当者は URL に入っている（DB を読まない）。
 */
export default function ReviewPage() {
  return (
    <Suspense fallback={<main className="min-h-dvh bg-[#FBF8F3]" />}>
      <ReviewFlow />
    </Suspense>
  );
}
