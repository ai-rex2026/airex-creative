import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Shell } from "@/components/Shell";
import { MeoWorkspace } from "@/components/meo/Workspace";
import { hasPlacesKey } from "@/lib/meo-ops/places";
import { autoIdentifyStore, loadWorkspace, MEO_ANALYSIS_COLUMNS, type MeoAnalysisRow } from "@/lib/meo-ops/workspace";

export const metadata = { title: "MEO運用｜AI-REX Studio" };

// AI検索（web検索つきの問い合わせ）を応答後に after() で走らせるので、実行時間を確保する
export const maxDuration = 300;

/**
 * MEO運用ワークスペース（AI-REX 本体 app/[locale]/(users)/analysis/[id]/meo の移植）。
 * データ取得と読み込み分岐はここで完結させ、配下のページは表示に専念する。
 */
export default async function MeoLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect(`/login?callbackUrl=${encodeURIComponent(`/analysis/${id}/meo`)}`);

  const { data } = await sb.from("analyses").select(`${MEO_ANALYSIS_COLUMNS}, status, meo_last_opened_at`).eq("id", id).maybeSingle();
  if (!data) notFound();
  if ((data as { status: string }).status !== "done") redirect(`/analysis/${id}/waiting`);

  let row = data as unknown as MeoAnalysisRow;
  // 初めて開いたときだけ、どの店舗の運用画面かを決める（決められなければ候補を保存して人に選ばせる）
  if (!row.meo_place_id && !row.meo_store_candidates && hasPlacesKey()) {
    row = await autoIdentifyStore(createAdminClient(), row).catch(() => row);
  }

  // 日次スナップショットが「見ていない店舗は回さない」を判定するための記録。失敗しても画面は成立する。
  // 画面の読み直し（AI検索の確認中は数秒おき）のたびに書かないよう、6時間に1回に間引く
  const opened = (data as { meo_last_opened_at: string | null }).meo_last_opened_at;
  if (!opened || Date.now() - new Date(opened).getTime() > 6 * 3600_000) {
    await sb.from("analyses").update({ meo_last_opened_at: new Date().toISOString() }).eq("id", id);
  }

  const { data: gbp } = await sb.from("gbp_connections").select("user_id").eq("user_id", user.id).maybeSingle();
  const workspace = await loadWorkspace(sb, row, !!gbp);

  return (
    <Shell active="analysis">
      <MeoWorkspace data={workspace} analysisId={id}>
        {children}
      </MeoWorkspace>
    </Shell>
  );
}
