import Link from "next/link";
import { IconArrowRight } from "./Chrome";

/**
 * レポート各章の末尾に置く「◯◯について相談する」ボタン（問い合わせページへ）。
 * PDF（印刷）には不要なので .no-print を付ける
 */
export function ContactCta({ label }: { label: string }) {
  return (
    <div className="no-print" style={{ display: "flex", justifyContent: "center", marginTop: 20 }}>
      {/* 会員登録の「無料で会員登録して続きを見る」（塗り）と見分けるため、白抜きにする */}
      <Link className="btn ghost" href="/contact">
        {label}
        <span className="arw">
          <IconArrowRight size={13} />
        </span>
      </Link>
    </div>
  );
}
