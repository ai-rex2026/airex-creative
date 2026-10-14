import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
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
        {/* 媒体ごとにアルゴリズムが違うので、運用は媒体ごとの画面で行う */}
        <section className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { href: "/sns/x", title: "X運用", text: "伸びている型の分析・画像とスレッドつきの案・リプライ／リポスト・DM" },
            { href: "/sns/instagram", title: "Instagram運用", text: "画像・リールの案と投稿、コメント・DM の返信" },
            { href: "/sns/tiktok", title: "TikTok運用", text: "20〜30秒の動画の案と投稿" },
            { href: "/sns/youtube", title: "YouTube運用", text: "10〜20分の動画の案とアップロード、コメントの返信" },
          ].map((c) => (
            <Link key={c.href} href={c.href} className="rounded-2xl border border-[#E8E5E0] bg-white p-4 hover:border-[#C9A84C]">
              <p className="text-sm font-semibold text-[#2E2D29]">{c.title} →</p>
              <p className="mt-1 text-xs leading-relaxed text-[#8B877F]">{c.text}</p>
            </Link>
          ))}
        </section>
        <SnsWorkspace accounts={accounts} posts={posts} settings={settings} />
      </div>
    </Shell>
  );
}
