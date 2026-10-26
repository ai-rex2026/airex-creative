import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { IconArrowRight } from "./Chrome";
import { MobileNav } from "./MobileNav";

/**
 * 管理画面の外枠。本番 /ja/analysis/* と同じく
 * 左に固定サイドバー（全体レポート〔新規分析／分析レポート作成履歴〕・店舗・AIO・SNS運用）、上にアップグレード、
 * ゲスト利用中は本登録を促す帯を出す。
 * 860px 以下ではサイドバーが上部バーに変わるので、ハンバーガーメニュー（MobileNav）で全項目を開く。
 */
/** SNS運用の下に並べる媒体ごとの運用（媒体ごとにアルゴリズムが違うので、運用もこの単位で分ける） */
const SNS_SUB: { key: string; href: string; label: string }[] = [
  { key: "x", href: "/sns/x", label: "X運用" },
  { key: "instagram", href: "/sns/instagram", label: "Instagram運用" },
  { key: "tiktok", href: "/sns/tiktok", label: "TikTok運用" },
  { key: "youtube", href: "/sns/youtube", label: "YouTube運用" },
];

export async function Shell({
  active,
  sub,
  children,
}: {
  active: "new" | "summary" | "analysis" | "stores" | "seo" | "aio" | "affiliate" | "sns" | "settings";
  /** SNS運用の中で開いている媒体／アフィリエイト運用の中で開いているページ（media = メディア台帳） */
  sub?: string;
  children: React.ReactNode;
}) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();

  return (
    <div className="app">
      <nav className="side-nav">
        <Link href="/" className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" width={20} height={20} />
          AI-REX
        </Link>

        <MobileNav
          active={active}
          account={user?.is_anonymous ? "ゲスト" : user?.email ?? "ユーザー"}
        />

        {/* 2026-10-21: URLから作るレポートの2項目を「全体レポート」の下にまとめ、店舗以下とは1行あける */}
        <div className="item grp">全体レポート</div>
        <Link href="/analysis/new" className={`item${active === "new" ? " on" : ""}`} style={{ paddingLeft: 30, fontSize: 13 }}>新規分析</Link>
        <Link href="/analysis" className={`item${active === "summary" ? " on" : ""}`} style={{ paddingLeft: 30, fontSize: 13 }}>分析レポート作成履歴</Link>
        <div className="gap" />
        <Link href="/stores" className={`item${active === "stores" ? " on" : ""}`}>店舗（MEO運用）</Link>
        <Link href="/seo" className={`item${active === "seo" ? " on" : ""}`}>SEO運用</Link>
        <Link href="/aio" className={`item${active === "aio" ? " on" : ""}`}>AIO（AI検索対策）</Link>
        <Link href="/affiliate" className={`item${active === "affiliate" ? " on" : ""}`}>アフィリエイト運用</Link>
        <Link href="/sns" className={`item${active === "sns" && !sub ? " on" : ""}`}>SNS運用</Link>
        {SNS_SUB.map((s) => (
          <Link key={s.key} href={s.href} className={`item${active === "sns" && sub === s.key ? " on" : ""}`} style={{ paddingLeft: 30, fontSize: 13 }}>
            {s.label}
          </Link>
        ))}

        {/* 2026-10-21: 「最近の分析」は分析レポート作成履歴と重なるため出さない */}

        <Link href="/settings" className={`user${active === "settings" ? " on" : ""}`} style={{ textDecoration: "none" }}>
          <span className="av">{user?.is_anonymous ? "ゲ" : "ユー"}</span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {user?.is_anonymous ? "ゲスト" : user?.email ?? "ユーザー"}
          </span>
          <span style={{ marginLeft: "auto", fontSize: 13 }}>⚙</span>
        </Link>
      </nav>

      <div className="app-main">
        <div className="app-top">
          <div className="right">
            <Link className="btn sm" href="/contact">
              アップグレード<span className="arw"><IconArrowRight size={13} /></span>
            </Link>
          </div>
        </div>

        {user?.is_anonymous && (
          <div className="guest">
            <span>ⓘ</span>
            ゲストとして利用中です。登録すると分析結果を保存して、いつでも見返せます。
            <Link className="cta" href="/login?mode=signup">無料で登録して保存</Link>
          </div>
        )}

        <div className="app-body">{children}</div>

        <footer className="app-foot">
          <Link href="/contact">お問い合わせ</Link>
          <Link href="/terms">利用規約</Link>
          <Link href="/privacy">プライバシーポリシー</Link>
          <Link href="/tokushoho">特定商取引法に基づく表記</Link>
          <span className="cp">© 2026 AI-REX. All rights reserved.</span>
        </footer>
      </div>
    </div>
  );
}
