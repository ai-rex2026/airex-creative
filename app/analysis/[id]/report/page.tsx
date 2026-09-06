import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Report } from "@/components/Report";
import { Shell } from "@/components/Shell";
import type { Analysis } from "@/lib/analysis";

export const metadata = { title: "レポート｜AI-REX Studio" };

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect(`/login?callbackUrl=${encodeURIComponent(`/analysis/${id}/report`)}`);

  const { data } = await sb.from("analyses").select("*").eq("id", id).single();
  if (!data) notFound();
  const a = data as Analysis;
  if (a.status !== "done") redirect(`/analysis/${id}/waiting`);
  if (!a.diagnosis || !a.copies) notFound();

  return (
    <Shell active="analysis">
      <div style={{ marginBottom: 18 }}>
        <Link className="btn ghost sm" href="/analysis">← 分析一覧に戻る</Link>
      </div>
      <Report d={a.diagnosis} copies={a.copies} />
    </Shell>
  );
}
