"use client";

/**
 * Googleビジネスプロフィールとの連携（どの店舗と同期するか）。
 * GBP の API は Google の審査（Business Profile API のアクセス承認）が済むまで使えないため、
 * 連携の入口は審査完了後に有効化する。
 */
export function GbpLink({ connected, linkedLocationName }: { analysisId: string; connected: boolean; linkedLocationName: string | null }) {
  if (connected && linkedLocationName) {
    return <p className="rounded-xl border border-[#E8E5E0] bg-[#F4F3F0] p-3 text-sm text-[#2E2D29]">この店舗と同期しています。</p>;
  }
  return (
    <p className="rounded-xl border border-dashed border-[#D8D4CC] bg-[#FAF9F7] p-3 text-sm leading-relaxed text-[#6B6862]">
      Googleビジネスプロフィールとの連携は準備中です。連携するまでは、Googleマップの公開データ（星・クチコミ件数・写真枚数・近隣競合）で運用状況を記録します。
    </p>
  );
}
