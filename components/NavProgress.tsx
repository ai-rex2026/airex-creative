"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * 画面上端の進捗バー。
 * loading.tsx は中身が届くまでの表示だが、クリックした瞬間の反応が無いと
 * 押せていないように見えるので、遷移の開始を捉えてバーを出す。
 */
export function NavProgress() {
  const pathname = usePathname();
  const [busy, setBusy] = useState(false);

  // 遷移が完了すると pathname が変わる。そこで消す
  useEffect(() => {
    setBusy(false);
  }, [pathname]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement)?.closest?.("a");
      if (!a) return;
      const href = a.getAttribute("href");
      if (!href || href.startsWith("#") || a.target === "_blank") return;
      // 同じ画面へのリンクは遷移しないのでバーを出さない
      try {
        const url = new URL(href, location.href);
        if (url.origin !== location.origin || url.pathname === location.pathname) return;
      } catch {
        return;
      }
      setBusy(true);
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  if (!busy) return null;
  return <div className="navbar-progress" role="status" aria-label="読み込み中" />;
}
