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
import { loadKeywords } from "@/lib/seo/keyword-store";
import { KeywordsPanel } from "@/components/seo/KeywordsPanel";
import { sortKeywords, TARGET_LABEL } from "@/lib/seo/keywords";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "SEO運用｜AI-REX Studio" };

// 記事の本文づくり・画像づくり・WordPress への送信・サイトの読み取りを1回の Action で行うので、実行時間を確保する
export const maxDuration = 300;

const TABS: SeoTab[] = ["keywords", "site", "satellite", "internal", "results"];

export default async function SeoProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; kw?: string }> }) {
  const { id } = await params;
  const { tab: rawTab, kw } = await searchParams;
  // 2026-10-21: 対策キーワードに沿って進めるので、既定は「対策キーワード」
  const tab: SeoTab = TABS.includes(rawTab as SeoTab) ? (rawTab as SeoTab) : "keywords";
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
  if (tab === "keywords") {
    const [keywords, content, { data: gconn }] = await Promise.all([
      loadKeywords(sb, id),
      loadContent(sb, admin, id),
      sb.from("google_connections").select("user_id").eq("user_id", user.id).maybeSingle(),
    ]);
    body = (
      <KeywordsPanel
        project={data.project}
        keywords={keywords}
        articles={content.articles.filter((a) => a.channel !== "note").map((a) => ({ id: a.id, title: a.title, publishedUrl: a.publishedUrl, publishedAt: a.publishedAt, createdAt: a.createdAt, channel: a.channel }))}
        googleConnected={!!gconn}
        hasSatellite={!!content.channels.satellite?.satellite}
      />
    );
  } else if (tab === "site" || tab === "satellite") {
    const [content, keywords] = await Promise.all([loadContent(sb, admin, id), loadKeywords(sb, id)]);
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
        keywords={sortKeywords(keywords.filter((k) => (tab === "satellite" ? k.target === "satellite" : k.target === "site")))}
        initialKeywordId={kw ?? null}
      />
    );
  } else if (tab === "internal") {
    body = <InternalPanel project={data.project} tasks={forTab(await loadInternalTasks(sb, id), "seo")} tab="seo" />;
  } else {
    const [content, { data: gconn }, keywords] = await Promise.all([loadContent(sb, admin, id), sb.from("google_connections").select("user_id").eq("user_id", user.id).maybeSingle(), loadKeywords(sb, id)]);
    const ranked = sortKeywords(keywords).filter((k) => k.gsc.length > 0).slice(0, 30);
    body = (
      <div className="space-y-6">
        <section className="rounded-2xl border border-[#E8E5E0] bg-white p-5">
          <h3 className="text-sm font-semibold text-[#2E2D29]">対策キーワードの順位（Search Console・直近28日）</h3>
          <p className="mt-1 text-xs text-[#8B877F]">数字の反映と、伸び悩む語の見立ては「対策キーワード」タブで行います。</p>
          {ranked.length === 0 ? (
            <p className="mt-3 rounded-xl border border-dashed border-[#D8D4CC] p-5 text-center text-xs text-[#8B877F]">まだ数字がありません（「対策キーワード」タブの「Search Console を反映」で入ります）</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[560px] text-xs">
                <thead>
                  <tr className="border-b border-[#E8E5E0] text-left text-[10px] text-[#8B877F]">
                    <th className="py-1.5 pr-2 font-normal">キーワード</th>
                    <th className="px-2 font-normal">書く先</th>
                    <th className="px-2 text-right font-normal">表示</th>
                    <th className="px-2 text-right font-normal">クリック</th>
                    <th className="px-2 text-right font-normal">平均順位</th>
                    <th className="pl-2 text-right font-normal">前回から</th>
                  </tr>
                </thead>
                <tbody>
                  {ranked.map((k) => {
                    const [a, b] = k.gsc;
                    const diff = b ? +(b.position - a.position).toFixed(1) : null;
                    return (
                      <tr key={k.id} className="border-b border-[#F4F3F0]">
                        <td className="py-1.5 pr-2 text-[#2E2D29]">{k.keyword}</td>
                        <td className="px-2 text-[#6B6862]">{TARGET_LABEL[k.target]}</td>
                        <td className="px-2 text-right">{a.impressions}</td>
                        <td className="px-2 text-right">{a.clicks}</td>
                        <td className="px-2 text-right">{a.position}</td>
                        <td className={`pl-2 text-right ${diff === null ? "text-[#A5A198]" : diff > 0 ? "text-[#2F6B4A]" : diff < 0 ? "text-[#A0472F]" : ""}`}>{diff === null ? "–" : diff > 0 ? `↑${diff}` : diff < 0 ? `↓${-diff}` : "→"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <ResultsPanel project={data.project} channels={content.channels} articles={content.articles} metrics={content.metrics} reviews={content.reviews} googleConnected={!!gconn} kinds={["site", "satellite"]} />
      </div>
    );
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
