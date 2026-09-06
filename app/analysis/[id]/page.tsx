import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SimpleHeader, SiteFooter } from "@/components/Chrome";
import { Progress } from "@/components/Progress";
import type { Analysis } from "@/lib/analysis";

export const metadata = { title: "分析中｜AI-REX Studio" };

export default async function AnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect(`/login?callbackUrl=${encodeURIComponent(`/analysis/${id}`)}`);

  const { data } = await sb.from("analyses").select("*").eq("id", id).single();
  if (!data) notFound();
  const a = data as Analysis;
  if (a.status === "done") redirect(`/analysis/${id}/report`);

  return (
    <>
      <SimpleHeader />
      <main className="grow">
        <Progress id={id} initial={{ status: a.status, step: a.step, progress: a.progress, error: a.error }} />
      </main>
      <SiteFooter />
    </>
  );
}
