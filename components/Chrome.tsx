import Link from "next/link";

/** ヘッダー・フッターは全ページ共通。ヘッダーは全幅で、左端にロゴ・右端にナビ（本番と同じ） */
export function Sun() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="#9A7A2A" strokeWidth="1.6" style={{ width: 20, height: 20 }}>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 1.6v3M12 19.4v3M1.6 12h3M19.4 12h3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M19.4 4.6l-2.1 2.1M6.7 17.3l-2.1 2.1" />
    </svg>
  );
}

export function Logo({ suffix }: { suffix?: string }) {
  return (
    <Link href="/" className="logo" style={{ textDecoration: "none" }}>
      <Sun />
      AI-REX
      {suffix && <span className="sfx">{suffix}</span>}
    </Link>
  );
}

/** 規約・お問い合わせなど、単独で読む画面のヘッダー */
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
        <Link href="/contact">お問い合わせ</Link>
        <Link href="/terms">利用規約</Link>
        <Link href="/privacy">プライバシーポリシー</Link>
        <Link href="/tokushoho">特定商取引法に基づく表記</Link>
        <Link href="/login">ログイン</Link>
        <span className="cp">© 2026 AI-REX</span>
      </div>
    </footer>
  );
}
