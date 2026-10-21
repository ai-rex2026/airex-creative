import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Shell } from "@/components/Shell";
import { SeoWorkspace, type SeoTab } from "@/components/seo/SeoWorkspace";
import { InternalPanel } from "@/components/seo/InternalPanel";
import { ChannelPanel } from "@/components/aio/content/ChannelPanel";
import { ResultsPanel } from "@/components/aio/content/ResultsPanel";
import { loadProject } from "@/lib/aio/store";
import { loadContent } from "@/lib/aio/content-store";
import { signImages } from "@/lib/aio/images";
import { loadInternalTasks } from "@/lib/seo/internal-store";
import { forTab } from "@/lib/seo/internal";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "SEO運用｜AI-REX Studio" };

// 記事の本文づくり・画像づくり・WordPress への送信・サイトの読み取りを1回の Action で行うので、実行時間を確保する
export const maxDuration = 300;

const TABS: SeoTab[] = ["site", "satellite", "internal", "results"];

export default async function SeoProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const { tab: rawTab } = await searchParams;
  const tab: SeoTab = TABS.includes(rawTab as SeoTab) ? (rawTab as SeoTab) : "site";
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect(`/login?callbackUrl=${encodeURIComponent(`/seo/${id}`)}`);
  if (user.is_anonymous) redirect(`/login?mode=signup&callbackUrl=${encodeURIComponent(`/seo/${id}`)}`);

  const data = await loadProject(sb, id);
  if (!data) notFound();
  const admin = createAdminClient();

  let body: React.ReactNode = null;
  if (tab === "site" || tab === "satellite") {
    const content = await loadContent(sb, admin, id);
    // 画像の署名は1回にまとめる（記事ごとに呼ばない）
    const list = content.articles.filter((a) => a.channel === tab);
    const signed = await signImages(admin, list.flatMap((a) => a.images));
    let k = 0;
    const articles = list.map((a) => ({ ...a, images: a.images.map(() => signed[k++]) }));
    body = (
      <ChannelPanel
        project={data.project}
        kind={tab}
        channel={content.channels[tab] ?? null}
        articles={articles}
        wp={tab === "satellite" ? content.wpSatellite : content.wp}
        review={content.reviews[tab] ?? null}
      />
    );
  } else if (tab === "internal") {
    body = <InternalPanel project={data.project} tasks={forTab(await loadInternalTasks(sb, id), "seo")} tab="seo" />;
  } else {
    const [content, { data: gconn }] = await Promise.all([loadContent(sb, admin, id), sb.from("google_connections").select("user_id").eq("user_id", user.id).maybeSingle()]);
    body = <ResultsPanel project={data.project} channels={content.channels} articles={content.articles} metrics={content.metrics} reviews={content.reviews} googleConnected={!!gconn} kinds={["site", "satellite"]} />;
  }

  return (
    <Shell active="seo">
      <div style={{ maxWidth: 960, margin: "0 auto" }}>
        <SeoWorkspace project={data.project} tab={tab}>
          {body}
        </SeoWorkspace>
      </div>
    </Shell>
  );
}
