"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * 狭い画面（スマホ・小さいウィンドウ）用のメニュー。
 * 左のサイドバーは 860px 以下で上部の細いバーに変わり、履歴や「設定」が隠れてしまう。
 * ハンバーガーボタン（バーの左端）から、全部の行き先をドロワーで開けるようにする。
 * 広い画面ではボタンごと非表示（これまでどおりサイドバーを使う）。
 */

export type MobileNavHist = { id: string; to: string; label: string; text: string };

const CSS = `
.mnav-btn{display:none}
@media(max-width:860px){
  .side-nav .item{display:none}
  .mnav-btn{display:inline-flex;order:-1;margin:0 4px 0 -6px;align-items:center;justify-content:center;width:44px;height:44px;
    border:0;border-radius:8px;background:transparent;color:var(--head);cursor:pointer;flex:0 0 auto}
  .mnav-btn:hover{background:rgba(255,255,255,.6)}
}
.mnav-ov{position:fixed;inset:0;z-index:100;background:rgba(20,20,20,.4)}
.mnav-panel{position:absolute;top:0;left:0;bottom:0;width:min(86vw,320px);background:var(--sunk);
  padding:14px;display:flex;flex-direction:column;overflow-y:auto;box-shadow:2px 0 16px rgba(0,0,0,.18)}
.mnav-head{display:flex;align-items:center;padding:0 0 10px 8px}
.mnav-head b{font-size:16px;color:var(--head)}
.mnav-close{margin-left:auto;width:44px;height:44px;border:0;border-radius:8px;background:transparent;
  color:var(--head);font-size:22px;line-height:1;cursor:pointer}
.mnav-close:hover{background:rgba(255,255,255,.6)}
.mnav-link{display:flex;align-items:center;gap:10px;padding:13px 12px;border-radius:8px;color:var(--muted);
  text-decoration:none;font-size:14.5px}
.mnav-link:hover{background:rgba(255,255,255,.6)}
.mnav-link.on{background:#fff;color:var(--head);font-weight:600}
.mnav-sec{margin:20px 8px 6px;font-size:11.5px;color:var(--faint)}
.mnav-hist{display:flex;align-items:center;gap:8px;padding:11px 12px;border-radius:8px;color:var(--head);
  text-decoration:none;font-size:13px}
.mnav-hist:hover{background:rgba(255,255,255,.6)}
.mnav-hist span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mnav-hist em{margin-left:auto;flex:0 0 auto;font-style:normal;font-size:10.5px;padding:2px 9px;border-radius:999px;
  background:#e7e3da;color:var(--muted)}
.mnav-foot{margin-top:auto;padding-top:14px}
.mnav-foot small{display:block;padding:0 12px;font-size:11.5px;color:var(--faint);overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap}
`;

export function MobileNav({
  active,
  hist,
  account,
}: {
  active: "new" | "summary" | "analysis" | "settings";
  hist: MobileNavHist[];
  /** メールアドレス。ゲストなら「ゲスト」 */
  account: string;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // 遷移したら閉じる
  useEffect(() => setOpen(false), [pathname]);

  // 開いている間は、背面をスクロールさせない。Esc で閉じる
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <>
      <style>{CSS}</style>
      <button className="mnav-btn" aria-label="メニューを開く" aria-expanded={open} onClick={() => setOpen(true)}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>

      {open && (
        <div className="mnav-ov" onClick={close}>
          <div className="mnav-panel" role="dialog" aria-modal="true" aria-label="メニュー" onClick={(e) => e.stopPropagation()}>
            <div className="mnav-head">
              <b>AI-REX</b>
              <button className="mnav-close" aria-label="メニューを閉じる" onClick={close}>
                ×
              </button>
            </div>

            <Link href="/analysis/new" className={`mnav-link${active === "new" ? " on" : ""}`} onClick={close}>
              ✎ 新規分析
            </Link>
            <Link href="/analysis" className={`mnav-link${active === "summary" ? " on" : ""}`} onClick={close}>
              ▤ 分析サマリー
            </Link>

            {hist.length > 0 && <div className="mnav-sec">最近の分析</div>}
            {hist.map((h) => (
              <Link key={h.id} href={h.to} className="mnav-hist" onClick={close}>
                <span>{h.label}</span>
                {h.text && <em>{h.text}</em>}
              </Link>
            ))}

            <div className="mnav-foot">
              <Link href="/settings" className={`mnav-link${active === "settings" ? " on" : ""}`} onClick={close}>
                ⚙ 設定
              </Link>
              <small>{account}</small>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
