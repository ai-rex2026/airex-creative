import Link from "next/link";

/** 一時アカウントのままだと端末を変えた瞬間に見られなくなるので、本登録を促す */
export function SignUpBanner() {
  return (
    <div style={{ background: "var(--sunk)", borderBottom: "1px solid var(--line)" }}>
      <div className="wrap" style={{ display: "flex", gap: 16, alignItems: "center", padding: "14px 24px", flexWrap: "wrap" }}>
        <span style={{ fontSize: 13.5 }}>
          いまは<b style={{ fontWeight: 600 }}>一時アカウント</b>です。このレポートはこのブラウザからしか開けません。
        </span>
        <Link className="btn" href="/login?mode=signup" style={{ marginLeft: "auto", padding: "10px 20px", fontSize: 13 }}>
          無料でアカウントを作る<span className="arw">→</span>
        </Link>
      </div>
    </div>
  );
}
