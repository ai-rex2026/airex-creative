import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Shell } from "@/components/Shell";
import { MeoWorkspace } from "@/components/meo/Workspace";
import { loadWorkspace, MEO_STORE_COLUMNS, type MeoStoreRow } from "@/lib/meo-ops/workspace";

export const metadata = { title: "MEO運用｜AI-REX Studio" };

// AI検索（web検索つきの問い合わせ）を応答後に after() で走らせるので、実行時間を確保する
export const maxDuration = 300;

/**
 * MEO運用ワークスペース（店舗ごと。レポートとは独立している）。
 * データ取得と読み込み分岐はここで完結させ、配下のページは表示に専念する。
 */
export default async function MeoLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect(`/login?callbackUrl=${encodeURIComponent(`/stores/${id}`)}`);

  const { data } = await sb.from("stores").select(`${MEO_STORE_COLUMNS}, meo_last_opened_at`).eq("id", id).maybeSingle();
  if (!data) notFound();
  const row = data as unknown as MeoStoreRow;

  // 日次スナップショットが「見ていない店舗は回さない」を判定するための記録。失敗しても画面は成立する。
  // 画面の読み直し（AI検索の確認中は数秒おき）のたびに書かないよう、6時間に1回に間引く
  const opened = (data as { meo_last_opened_at: string | null }).meo_last_opened_at;
  if (!opened || Date.now() - new Date(opened).getTime() > 6 * 3600_000) {
    await sb.from("stores").update({ meo_last_opened_at: new Date().toISOString() }).eq("id", id);
  }

  const { data: gbp } = await sb.from("gbp_connections").select("user_id").eq("user_id", user.id).maybeSingle();
  const workspace = await loadWorkspace(sb, row, !!gbp);

  return (
    <Shell active="stores">
      <MeoWorkspace data={workspace} storeId={id}>
        {children}
      </MeoWorkspace>
    </Shell>
  );
}
