import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Shell } from "@/components/Shell";
import { AnalysisList } from "@/components/AnalysisList";
import type { Analysis } from "@/lib/analysis";

export const metadata = { title: "分析サマリー｜AI-REX Studio" };

const PILL: Record<string, [string, string]> = {
  queued: ["待機中", ""],
  running: ["処理中", "run"],
  done: ["完了", "ok"],
  failed: ["失敗", "ng"],
};

export default async function AnalysisListPage() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login?callbackUrl=%2Fanalysis");

  const { data } = await sb.from("analyses").select("*").order("created_at", { ascending: false });
  const rows = (data ?? []) as Analysis[];

  return (
    <Shell active="summary">
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        <h2 style={{ fontSize: 20 }}>分析サマリー</h2>
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 6 }}>
          これまでに分析したサイトの一覧です。
        </p>

        {rows.length === 0 ? (
          <div className="panel" style={{ marginTop: 22 }}>
            <h2>まだ分析がありません</h2>
            <p>サイトのURLを入れると、訴求軸・コピー・バナー・LPまで作れます。</p>
            <p style={{ marginTop: 22 }}>
              <Link className="btn" href="/analysis/new">新規分析をはじめる<span className="arw">→</span></Link>
            </p>
          </div>
        ) : (
          <AnalysisList rows={rows} />
        )}
      </div>
    </Shell>
  );
}
