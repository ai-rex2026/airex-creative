import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Shell } from "@/components/Shell";
import { SignOutButton } from "@/components/SignOutButton";

export const metadata = { title: "設定｜AI-REX Studio" };

export default async function SettingsPage() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login?callbackUrl=%2Fsettings");

  return (
    <Shell active="settings">
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        <h2 style={{ fontSize: 20 }}>設定</h2>

        <div className="rows" style={{ marginTop: 20 }}>
          <div className="rh">アカウント</div>
          <div className="r">
            <div style={{ flex: 1, minWidth: 0 }}>
              <b>{user.is_anonymous ? "一時アカウント（ゲスト）" : user.email}</b>
              <small>
                {user.is_anonymous
                  ? "このブラウザからのみ分析を見られます。本登録すると他の端末からも見られます。"
                  : "このメールアドレスでログインしています"}
              </small>
            </div>
            {user.is_anonymous && (
              <a className="btn ghost sm" href="/login?mode=signup">本登録する</a>
            )}
          </div>
          <div className="r">
            <div style={{ flex: 1, minWidth: 0 }}>
              <b>ログアウト</b>
              <small>このブラウザからログアウトします</small>
            </div>
            <SignOutButton />
          </div>
        </div>

        {user.is_anonymous && (
          <p className="note">
            <i className="i">i</i>
            <span>
              ゲストのままログアウトすると、<b style={{ fontWeight: 600 }}>いまの分析は二度と開けなくなります</b>。
              先に本登録してください。
            </span>
          </p>
        )}
      </div>
    </Shell>
  );
}
