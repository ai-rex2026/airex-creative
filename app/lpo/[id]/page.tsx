import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Shell } from "@/components/Shell";
import { HEATMAP_BUCKET, LPO_HEATMAP_COLUMNS, LPO_PROJECT_COLUMNS, rowToHeatmap, rowToLpoProject } from "@/lib/lpo-ops/types";
import { PlanPanel, SpeedPanel, HeatmapPanel, ResultsPanel, LpoHeader } from "@/components/lpo/LpoPanels";

export const metadata = { title: "LPO運用｜AI-REX Studio" };
// 表示速度の計測（最大3分ほど）・ヒートマップ画像の読み取り（AI）を1回の Action で行う
export const maxDuration = 300;

const TABS = [
  { key: "lp", label: "LP改善" },
  { key: "speed", label: "表示速度改善" },
  { key: "heatmap", label: "ヒートマップ分析" },
  { key: "results", label: "効果" },
] as const;
type Tab = (typeof TABS)[number]["key"];

export default async function LpoProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const { tab: raw } = await searchParams;
  const tab: Tab = TABS.some((t) => t.key === raw) ? (raw as Tab) : "lp";

  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect(`/login?callbackUrl=${encodeURIComponent(`/lpo/${id}`)}`);
  if (user.is_anonymous) redirect("/login?mode=signup");

  const { data } = await sb.from("lpo_projects").select(LPO_PROJECT_COLUMNS).eq("id", id).eq("owner_id", user.id).maybeSingle();
  if (!data) notFound();
  const project = rowToLpoProject(data as Record<string, unknown>);

  let body: React.ReactNode = null;
  if (tab === "lp") body = <PlanPanel project={project} />;
  else if (tab === "speed") body = <SpeedPanel project={project} />;
  else {
    const { data: rows } = await sb.from("lpo_heatmaps").select(LPO_HEATMAP_COLUMNS).eq("project_id", id).eq("owner_id", user.id).order("created_at", { ascending: false }).limit(30);
    const heatmaps = (rows ?? []).map((r) => rowToHeatmap(r as Record<string, unknown>));
    if (tab === "heatmap") {
      const admin = createAdminClient();
      const { data: conn } = await admin.from("lpo_clarity").select("last_fetch_at").eq("project_id", id).maybeSingle();
      // 画像は署名 URL（1時間）で出す
      const paths = heatmaps.flatMap((h) => h.images);
      const signed: Record<string, string> = {};
      if (paths.length) {
        const { data: urls } = await admin.storage.from(HEATMAP_BUCKET).createSignedUrls(paths, 3600);
        for (const u of urls ?? []) if (u.path && u.signedUrl) signed[u.path] = u.signedUrl;
      }
      body = <HeatmapPanel project={project} heatmaps={heatmaps} clarity={conn ? { lastFetchAt: (conn.last_fetch_at as string | null) ?? null } : null} signed={signed} />;
    } else {
      body = <ResultsPanel project={project} heatmaps={heatmaps} />;
    }
  }

  return (
    <Shell active="lpo">
      <div style={{ maxWidth: 960, margin: "0 auto" }}>
        <LpoHeader project={project} />
        <nav className="lpo-tabs">
          {TABS.map((t) => (
            <Link key={t.key} href={`/lpo/${id}?tab=${t.key}`} scroll={false} className={tab === t.key ? "on" : undefined}>
              {t.label}
            </Link>
          ))}
        </nav>
        {body}
      </div>
    </Shell>
  );
}
