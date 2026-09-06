import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/** ID だけで来たら、状態に応じて待機かレポートへ振り分ける */
export default async function AnalysisEntry({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await createClient();
  const { data } = await sb.from("analyses").select("status").eq("id", id).single();
  redirect(data?.status === "done" ? `/analysis/${id}/report` : `/analysis/${id}/waiting`);
}
