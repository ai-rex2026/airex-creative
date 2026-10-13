import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Shell } from "@/components/Shell";
import { SnsWorkspace } from "@/components/sns/SnsWorkspace";
import { snsAccountsAction, snsPostsAction, snsSettingsAction } from "@/app/sns-actions";

export const metadata = { title: "SNS運用｜AI-REX Studio" };

// 投稿案の生成（媒体ごとの文面＋法令チェック）は1回の Server Action で済ませるので、実行時間を確保する
export const maxDuration = 300;

/**
 * 公式SNSアカウントの運用（2026-10-13 のミーティングで決めた「左の MEO の並びに SNS運用タブ」）。
 * 店舗以外（会社・サービス）でも単独で使える。設定で連携したアカウント向けに、テーマから媒体ごとに文面を変えた
 * 投稿案を AI が作り、人が確認して投稿する。未連携なら設定への導線を出す。
 */
export default async function SnsPage() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login?callbackUrl=%2Fsns");
  if (user.is_anonymous) redirect("/login?mode=signup&callbackUrl=%2Fsns");

  const [accounts, posts, settings] = await Promise.all([snsAccountsAction(), snsPostsAction(), snsSettingsAction()]);

  return (
    <Shell active="sns">
      <div style={{ maxWidth: 960, margin: "0 auto" }}>
        <SnsWorkspace accounts={accounts} posts={posts} settings={settings} />
      </div>
    </Shell>
  );
}
