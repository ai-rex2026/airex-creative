import Link from "next/link";

/**
 * ヘッダー・フッターは全ページ共通。本番と同じく
 *  - ヘッダーは全幅（左端にロゴ／右端にナビ）
 *  - ページ全体はちょうど1画面に収まり、フッターは最下部
 * ロゴとファビコンは本番の /logo.svg /icon.svg をそのまま持ってきている。
 */

/** アイコンは本番と同じ lucide の形をそのまま使う */
export function IconLogin({ size = 16 }: { size?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m10 17 5-5-5-5" /><path d="M15 12H3" />
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
    </svg>
  );
}

export function IconGlobe({ size = 20 }: { size?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ flex: `0 0 ${size}px`, color: "#9ca3af" }} aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
      <path d="M2 12h20" />
    </svg>
  );
}

export function IconArrowRight({ size = 16 }: { size?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14" /><path d="m12 5 7 7-7 7" />
    </svg>
  );
}

export function Logo({ suffix }: { suffix?: string }) {
  return (
    <Link href="/" className="logo" style={{ textDecoration: "none" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.svg" alt="" width={22} height={22} />
      AI-REX
      {suffix && <span className="sfx">{suffix}</span>}
    </Link>
  );
}

export function SimpleHeader() {
  return (
    <header className="site-header">
      <div className="wrap">
        <Logo />
        <Link href="/" className="backlink">← トップに戻る</Link>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="wrap">
        <Link href="/login" className="lead">
          <IconLogin size={15} />
          アカウントをお持ちの方はログイン
        </Link>
        <div className="links">
          <Link href="/company">会社概要</Link>
          <Link href="/contact">お問い合わせ</Link>
          <Link href="/terms">利用規約</Link>
          <Link href="/privacy">プライバシーポリシー</Link>
          <Link href="/tokushoho">特定商取引法に基づく表記</Link>
        </div>
      </div>
    </footer>
  );
}
