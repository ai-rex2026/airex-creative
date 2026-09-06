import { notFound, redirect } from "next/navigation";
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
      <Report d={a.diagnosis} copies={a.copies} url={a.url} isGuest={!!user.is_anonymous} site={a.site} seo={a.seo} plan={a.media_plan} summary={a.summary} competitors={a.competitors} tactics={a.tactics} adOps={a.ad_ops} gsc={a.gsc} ga4={a.ga4} />
    </Shell>
  );
}
