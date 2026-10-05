import Link from "next/link";
import { IconArrowRight } from "./Chrome";

/**
 * レポート各章の末尾に置く「◯◯について相談する」ボタン（問い合わせページへ）。
 * PDF（印刷）には不要なので .no-print を付ける
 */
export function ContactCta({ label }: { label: string }) {
  return (
    <div className="no-print" style={{ display: "flex", justifyContent: "center", marginTop: 20 }}>
      <Link className="btn" href="/contact">
        {label}
        <span className="arw">
          <IconArrowRight size={13} />
        </span>
      </Link>
    </div>
  );
}
