import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Shell } from "@/components/Shell";
import { AioWorkspace } from "@/components/aio/AioWorkspace";
import { loadProject } from "@/lib/aio/store";
import { quota } from "@/lib/aio/run";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "AIO｜AI-REX Studio" };

// 実測（web検索つきの AI 問い合わせ）を応答後に after() で走らせ、下書き生成も1回の Action で済ませるので、実行時間を確保する
export const maxDuration = 300;

export default async function AioProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect(`/login?callbackUrl=${encodeURIComponent(`/aio/${id}`)}`);
  if (user.is_anonymous) redirect(`/login?mode=signup&callbackUrl=${encodeURIComponent(`/aio/${id}`)}`);

  const data = await loadProject(sb, id);
  if (!data) notFound();
  // 月次上限は aio_checks を数える。本人の権限でも読めるが、集計はサーバー側に寄せる
  const q = await quota(createAdminClient(), id);

  return (
    <Shell active="aio">
      <div style={{ maxWidth: 960, margin: "0 auto" }}>
        <AioWorkspace project={data.project} checks={data.checks} drafts={data.drafts} prompts={data.prompts} gap={data.gap} plans={data.plans} quota={{ remaining: q.remaining, limit: q.limit }} />
      </div>
    </Shell>
  );
}
