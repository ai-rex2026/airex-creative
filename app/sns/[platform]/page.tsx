import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Shell } from "@/components/Shell";
import { AppKeysCard, type ConnView } from "@/components/sns/ops/AppKeysCard";
import { XOps } from "@/components/sns/ops/XOps";
import { credsInfo, sharedCreds } from "@/lib/social-connect/app-creds";
import { signImages } from "@/lib/aio/images";
import { jstDay } from "@/lib/sns-ops/day";
import { loadSettings } from "@/lib/sns-ops/store";
import { OBSERVED_COLUMNS, OPS_POST_COLUMNS, loadXConfig, rowToInbox, rowToObserved, rowToOpsPost, rowToPatternReport } from "@/lib/sns-ops/ops-store";
import { OPS_LABEL, OPS_PLATFORMS, OPS_TO_CONN, type OpsPlatform } from "@/lib/sns-ops/ops-types";
import { SNS_MEDIA_BUCKET } from "@/lib/sns-ops/x-run";

export const metadata = { title: "SNS運用｜AI-REX Studio" };

// 投稿案（本文＋画像）・分析・送信を1回の Action で行うので、実行時間を確保する
export const maxDuration = 300;

const daysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString();

export default async function SnsPlatformPage({ params, searchParams }: { params: Promise<{ platform: string }>; searchParams: Promise<{ sns_error?: string; sns_ok?: string; tab?: string }> }) {
  const { platform: raw } = await params;
  const sp = await searchParams;
  if (!OPS_PLATFORMS.includes(raw as OpsPlatform)) notFound();
  const platform = raw as OpsPlatform;
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect(`/login?callbackUrl=${encodeURIComponent(`/sns/${platform}`)}`);
  if (user.is_anonymous) redirect(`/login?mode=signup&callbackUrl=${encodeURIComponent(`/sns/${platform}`)}`);

  const admin = createAdminClient();
  const conn = OPS_TO_CONN[platform];
  const h = await headers();
  const origin = process.env.APP_ORIGIN?.replace(/\/+$/, "") || `https://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const [{ data: c }, keys] = await Promise.all([admin.from("sns_connections").select("connected_at, profile, scope, app_client_id").eq("user_id", user.id).eq("platform", conn).maybeSingle(), credsInfo(user.id)]);
  const profile = (c?.profile as Record<string, unknown>) ?? {};
  const connView: ConnView = {
    connected: !!c,
    label: (profile.username as string) ?? (profile.title as string) ?? (profile.name as string) ?? (profile.displayName as string) ?? null,
    scope: (c?.scope as string | null) ?? null,
    viaOwnApp: !!(c?.app_client_id && keys[conn] && c.app_client_id !== sharedCreds(conn)?.clientId),
    connectedAt: (c?.connected_at as string | null) ?? null,
  };
  const keysCard = (
    <AppKeysCard
      platform={platform}
      conn={conn}
      redirectUri={`${origin}/api/social/${conn}/callback`}
      own={keys[conn] ?? null}
      sharedAvailable={!!sharedCreds(conn)}
      connection={connView}
      error={sp.sns_error ?? null}
      ok={sp.sns_ok === conn}
    />
  );

  let body: React.ReactNode;
  if (platform === "x") {
    const [{ enabled, config }, brand, { data: posts }, { data: obs }, { data: rep }, { data: inbox }, { data: run }] = await Promise.all([
      loadXConfig(sb, user.id),
      loadSettings(sb, user.id),
      sb.from("sns_posts").select(OPS_POST_COLUMNS).eq("user_id", user.id).eq("platform", "x").in("source", ["ops", "ops_auto"]).order("created_at", { ascending: false }).limit(150),
      sb.from("sns_observed_posts").select(OBSERVED_COLUMNS).eq("user_id", user.id).eq("platform", "x").gte("fetched_at", daysAgo(14)).order("posted_at", { ascending: false }).limit(300),
      sb.from("sns_patterns").select("id, body, created_at").eq("user_id", user.id).eq("platform", "x").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      sb.from("sns_inbox").select("id, external_id, conversation_id, sender_id, sender_name, from_me, text, sent_at").eq("user_id", user.id).eq("platform", "x").order("sent_at", { ascending: false }).limit(200),
      sb.from("sns_daily_runs").select("steps").eq("user_id", user.id).eq("platform", "x").eq("day", jstDay()).maybeSingle(),
    ]);
    const list = ((posts ?? []) as Record<string, unknown>[]).map(rowToOpsPost);
    // 画像の署名は1回にまとめる
    const signed = await signImages(admin, list.flatMap((p) => p.media), SNS_MEDIA_BUCKET);
    let k = 0;
    const withMedia = list.map((p) => ({ ...p, media: p.media.map(() => signed[k++]) }));
    body = (
      <XOps
        posts={withMedia}
        observed={((obs ?? []) as Record<string, unknown>[]).map(rowToObserved)}
        report={rep ? rowToPatternReport(rep as Record<string, unknown>) : null}
        inbox={((inbox ?? []) as Record<string, unknown>[]).map(rowToInbox)}
        enabled={enabled}
        config={config}
        brandReady={!!brand.brandName}
        connected={connView.connected}
        scope={connView.scope}
        todaySteps={(run?.steps as Record<string, { done?: boolean; note?: string; error?: string; at?: string }>) ?? {}}
        keysCard={keysCard}
        initialTab={sp.tab ?? null}
      />
    );
  } else {
    body = (
      <div className="space-y-5">
        {keysCard}
        <section className="rounded-2xl border border-dashed border-[#D8D4CC] bg-[#FAF9F7] p-5 text-sm text-[#6B6862]">
          <p className="font-semibold text-[#2E2D29]">{OPS_LABEL[platform]}の運用画面は、次の更新で入ります</p>
          <p className="mt-1 leading-relaxed">
            伸びている{platform === "youtube" ? "チャンネル" : "アカウント"}の分析・投稿案（{platform === "tiktok" ? "20〜30秒の動画" : platform === "youtube" ? "10〜20分の動画" : "画像・リール"}）・承認して投稿・{platform === "youtube" ? "コメントへの返信" : "コメントと DM への返信"}・結果の分析を、媒体ごとのやり方で作ります。先にアプリの鍵の登録と連携を済ませておくと、そのまま使えます。
          </p>
        </section>
      </div>
    );
  }

  return (
    <Shell active="sns" sub={platform}>
      <div style={{ maxWidth: 1000, margin: "0 auto" }}>
        <div className="mb-5">
          <h1 className="disp text-2xl font-bold text-[#2E2D29]">{OPS_LABEL[platform]}</h1>
          <p className="mt-1 text-sm text-[#8B877F]">
            {platform === "x"
              ? "伸びているアカウントの投稿を毎日分析し、使える型で投稿案（画像・スレッドつき）を作ります。承認したものだけ投稿し、結果を次の案に使います"
              : "媒体ごとのアルゴリズムに合わせて運用します"}
          </p>
        </div>
        {body}
      </div>
    </Shell>
  );
}
