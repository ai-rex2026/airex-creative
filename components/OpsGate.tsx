import Link from "next/link";
import { Shell } from "@/components/Shell";
import { getTier, OPS_LOCKED_MESSAGE } from "@/lib/tier";

type Active = "stores" | "seo" | "aio" | "lpo" | "ads" | "affiliate" | "sns";

/**
 * 運用メニューの入口（各メニューの layout.tsx から使う）。無料ユーザーには、中身の代わりにこの案内を出す（2026-11-18）。
 * ゲスト・有料・管理者はそのまま通す（ゲストは各ページが登録案内へ送る）。Server Action 側でも同じ判定をしている
 */
export async function OpsGate({ active, children }: { active: Active; children: React.ReactNode }) {
  const { tier } = await getTier();
  if (tier !== "free") return <>{children}</>;
  return (
    <Shell active="settings">
      <div data-menu={active} style={{ maxWidth: 640, margin: "0 auto" }}>
        <div className="panel">
          <h2>有料プランの機能です</h2>
          <p>{OPS_LOCKED_MESSAGE}</p>
          <p style={{ marginTop: 18 }}>
            <Link className="btn sm" href="/contact">お問い合わせ</Link>{" "}
            <Link className="btn sm ghost" href="/analysis/new">全体レポートを作る</Link>
          </p>
        </div>
      </div>
    </Shell>
  );
}
