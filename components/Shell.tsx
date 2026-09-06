import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { IconArrowRight } from "./Chrome";

type HistRow = { id: string; url: string | null; status: string; diagnosis: { product?: string } | null };

const PILL: Record<string, [string, string]> = {
  queued: ["待機中", ""],
  running: ["処理中", "run"],
  done: ["完了", "ok"],
  failed: ["失敗", "ng"],
};

/**
 * 管理画面の外枠。本番 /ja/analysis/* と同じく
 * 左に固定サイドバー（新規分析／分析サマリー／最近の分析）、上にアップグレード、
 * ゲスト利用中は本登録を促す帯を出す。
 */
export async function Shell({
  active,
  children,
}: {
  active: "new" | "summary" | "analysis" | "settings";
  children: React.ReactNode;
}) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();

  const { data } = await sb
    .from("analyses")
    .select("id,url,status,diagnosis")
    .order("created_at", { ascending: false })
    .limit(8);
  const hist = (data ?? []) as HistRow[];

  const label = (h: HistRow) =>
    h.diagnosis?.product?.slice(0, 22) ??
    (h.url ? h.url.replace(/^https?:\/\//, "").replace(/\/$/, "") : "分析");

  return (
    <div className="app">
      <nav className="side-nav">
        <Link href="/" className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" width={20} height={20} />
          AI-REX
        </Link>

        <Link href="/analysis/new" className={`item${active === "new" ? " on" : ""}`}>✎ 新規分析</Link>
        <Link href="/analysis" className={`item${active === "summary" ? " on" : ""}`}>▤ 分析サマリー</Link>

        <div className="sec">
          最近の分析
          <Link href="/analysis">すべて</Link>
        </div>
        {hist.length === 0 ? (
          <p className="empty">分析履歴はまだありません</p>
        ) : (
          hist.map((h) => {
            const [text, cls] = PILL[h.status] ?? ["", ""];
            const to = h.status === "done" ? `/analysis/${h.id}/report` : `/analysis/${h.id}/waiting`;
            return (
              <Link key={h.id} href={to} className="hist">
                <span>{label(h)}</span>
                <em className={`pill ${cls}`} style={{ fontStyle: "normal" }}>{text}</em>
              </Link>
            );
          })
        )}

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
