import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Shell } from "@/components/Shell";
import { AioWorkspace, type AioTab } from "@/components/aio/AioWorkspace";
import { ChannelPanel } from "@/components/aio/content/ChannelPanel";
import { PressPanel } from "@/components/aio/content/PressPanel";
import { PRESS_COLUMNS, rowToPress } from "@/lib/aio/press-store";
import { ResultsPanel } from "@/components/aio/content/ResultsPanel";
import { loadProject } from "@/lib/aio/store";
import { loadContent } from "@/lib/aio/content-store";
import { signImages } from "@/lib/aio/images";
import { quota } from "@/lib/aio/run";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "AIO｜AI-REX Studio" };

// 実測（web検索つきの AI 問い合わせ）・記事の本文づくり・画像づくり・WordPress への送信を1回の Action で行うので、実行時間を確保する
export const maxDuration = 300;

const TABS: AioTab[] = ["site", "note", "prtimes", "results", "ai"];

export default async function AioProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const { tab: rawTab } = await searchParams;
  // 運用（記事づくり）を主にする。既定は「自社サイト記事」
  const tab: AioTab = TABS.includes(rawTab as AioTab) ? (rawTab as AioTab) : "site";
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect(`/login?callbackUrl=${encodeURIComponent(`/aio/${id}`)}`);
  if (user.is_anonymous) redirect(`/login?mode=signup&callbackUrl=${encodeURIComponent(`/aio/${id}`)}`);

  const data = await loadProject(sb, id);
  if (!data) notFound();
  const admin = createAdminClient();
  // 月次上限は aio_checks を数える。本人の権限でも読めるが、集計はサーバー側に寄せる
  const [q, content, { data: gconn }] = await Promise.all([
    quota(admin, id),
    loadContent(sb, admin, id),
    sb.from("google_connections").select("user_id").eq("user_id", user.id).maybeSingle(),
  ]);

  let body: React.ReactNode = null;
  if (tab === "site" || tab === "note") {
    // 画像の署名は1回にまとめる（記事ごとに呼ばない）
    const list = content.articles.filter((a) => a.channel === tab);
    const signed = await signImages(admin, list.flatMap((a) => a.images));
    let k = 0;
    const articles = list.map((a) => ({ ...a, images: a.images.map(() => signed[k++]) }));
    body = <ChannelPanel project={data.project} kind={tab} channel={content.channels[tab] ?? null} articles={articles} wp={content.wp} review={content.reviews[tab] ?? null} />;
  } else if (tab === "prtimes") {
    // 表が未作成（マイグレーション前）でも画面は開く
    const { data: rows } = await sb.from("aio_press_releases").select(PRESS_COLUMNS).eq("project_id", id).order("created_at", { ascending: false }).limit(30);
    const list = (rows ?? []).map((r) => rowToPress(r as Record<string, unknown>));
    const signed = await signImages(admin, list.flatMap((r) => r.images));
    let k = 0;
    const releases = list.map((r) => ({ ...r, images: r.images.map(() => signed[k++]) }));
    body = <PressPanel project={data.project} releases={releases} />;
  } else if (tab === "results") {
    body = <ResultsPanel project={data.project} channels={content.channels} articles={content.articles} metrics={content.metrics} reviews={content.reviews} googleConnected={!!gconn} />;
  }

  return (
    <Shell active="aio">
      <div style={{ maxWidth: 960, margin: "0 auto" }}>
        <AioWorkspace project={data.project} checks={data.checks} drafts={data.drafts} prompts={data.prompts} gap={data.gap} plans={data.plans} quota={{ remaining: q.remaining, limit: q.limit }} tab={tab}>
          {body}
        </AioWorkspace>
      </div>
    </Shell>
  );
}
