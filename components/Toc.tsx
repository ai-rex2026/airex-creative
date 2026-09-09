"use client";

import { useEffect, useState } from "react";

/**
 * 分析データの目次。
 *
 * 章が条件付きで出たり消えたりするので、一覧を手で持たずに
 * 描画後の見出しから作る。実際に出ている章だけが並ぶ。
 */
export function Toc({ watch }: { watch: unknown }) {
  const [items, setItems] = useState<{ id: string; label: string }[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const heads = Array.from(document.querySelectorAll<HTMLElement>('h2[id^="sec-"]'));
    setItems(heads.map((h) => ({ id: h.id, label: h.textContent?.trim() ?? h.id })));

    // いま読んでいる章を出す。上端に一番近い見出しを現在地とする
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (hit) setActive(hit.target.id);
      },
      { rootMargin: "-72px 0px -70% 0px" }
    );
    heads.forEach((h) => io.observe(h));
    return () => io.disconnect();
  }, [watch]);

  if (items.length < 3) return null;
  const now = items.find((x) => x.id === active) ?? items[0];

  return (
    <nav className={`rtoc${open ? " open" : ""}`}>
      <button className="rtocnow" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="lb">目次</span>
        <span className="cur">{now.label}</span>
        <span className="ar">{open ? "閉じる" : `全${items.length}章`}</span>
      </button>
      <div className="rtoclist">
        {items.map((x) => (
          <a
            key={x.id}
            href={`#${x.id}`}
            className={x.id === active ? "on" : ""}
            onClick={() => setOpen(false)}
          >
            {x.label}
          </a>
        ))}
      </div>
    </nav>
  );
}
