import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Shell } from "@/components/Shell";
import { BannerWorkspace } from "@/components/banner-studio/BannerWorkspace";
import { bannerUsageAction } from "@/app/banner-actions";
import { BANNER_PROJECT_COLUMNS, BANNER_VISUAL_COLUMNS, rowToBannerProject, rowToVisual } from "@/lib/banner-studio/types";

export const metadata = { title: "バナー制作｜AI-REX Studio" };
// 読み取り・コピー・パターン作り（AI）と、出来上がった絵・動画の取り込みを Action で行う
export const maxDuration = 300;

export default async function BannerProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect(`/login?callbackUrl=${encodeURIComponent(`/ads/banners/${id}`)}`);
  if (user.is_anonymous) redirect("/login?mode=signup");

  const { data } = await sb.from("banner_projects").select(BANNER_PROJECT_COLUMNS).eq("id", id).eq("owner_id", user.id).maybeSingle();
  if (!data) notFound();
  const [{ data: rows }, usage] = await Promise.all([
    sb.from("banner_visuals").select(BANNER_VISUAL_COLUMNS).eq("project_id", id).eq("owner_id", user.id).order("created_at", { ascending: true }),
    bannerUsageAction(),
  ]);

  return (
    <Shell active="ads" sub="banners">
      <div style={{ maxWidth: 1080, margin: "0 auto" }}>
        <BannerWorkspace project={rowToBannerProject(data as Record<string, unknown>)} visuals={(rows ?? []).map((r) => rowToVisual(r as Record<string, unknown>))} usage={usage} />
      </div>
    </Shell>
  );
}
