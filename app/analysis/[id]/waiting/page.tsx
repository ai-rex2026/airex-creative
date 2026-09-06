import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Shell } from "@/components/Shell";
import { Waiting } from "@/components/Waiting";
import type { Analysis } from "@/lib/analysis";

export const metadata = { title: "分析中｜AI-REX Studio" };

export default async function WaitingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect(`/login?callbackUrl=${encodeURIComponent(`/analysis/${id}/waiting`)}`);

  const { data } = await sb.from("analyses").select("*").eq("id", id).single();
  if (!data) notFound();
  const a = data as Analysis;
  if (a.status === "done") redirect(`/analysis/${id}/report`);

  const site = a.url ? a.url.replace(/^https?:\/\//, "").replace(/\/$/, "") : "入力テキスト";

  return (
    <Shell active="analysis">
      <Waiting id={id} site={site} initial={{ status: a.status, step: a.step, progress: a.progress, error: a.error }} />
    </Shell>
  );
}
