import Link from "next/link";

/**
 * レポートからMEO運用ワークスペースへの入口（本体 MeoEntryCard の移植）。
 * レポート（読む成果物）と運用画面は性質が違うため、章の中ではなく独立したカードとして置く。
 */
export function MeoEntryCard({ analysisId, address }: { analysisId: string; address?: string | null }) {
  return (
    <Link
      href={`/analysis/${analysisId}/meo`}
      className="group my-6 flex items-center gap-4 rounded-2xl border border-[#E0DBD1] bg-[#FAF9F7] p-5 no-underline transition-colors hover:border-[#D8D4CC] print:hidden"
      style={{ textDecoration: "none" }}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#2E2D29] text-white">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
          <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
          <circle cx="12" cy="10" r="3" />
        </svg>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-[#2E2D29]">MEO運用をはじめる</p>
        <p className="mt-1 text-sm leading-relaxed text-[#6B6862]">
          クチコミへのAI返信、Googleビジネスプロフィールへの投稿、AI検索での見え方の確認を、この店舗専用の画面で管理できます。
        </p>
        {address && <p className="mt-1.5 truncate text-xs text-[#A5A198]">対象店舗: {address}</p>}
      </div>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 shrink-0 text-[#8A5340] transition-transform group-hover:translate-x-0.5" aria-hidden>
        <path d="M5 12h14" />
        <path d="m12 5 7 7-7 7" />
      </svg>
    </Link>
  );
}
