import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Shell } from "@/components/Shell";
import { SignOutButton } from "@/components/SignOutButton";
import { GoogleConnect } from "@/components/GoogleConnect";
import { googleConnection } from "@/app/actions";
import { hasGoogleApp } from "@/lib/google";

export const metadata = { title: "設定｜AI-REX Studio" };

export default async function SettingsPage() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login?callbackUrl=%2Fsettings");

  const conn = await googleConnection();

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

        <div className="rows" style={{ marginTop: 20 }}>
          <div className="rh">データ連携</div>
          <div className="r">
            <div style={{ flex: 1, minWidth: 0 }}>
              <b>Search Console / Google Analytics 4 / YouTube</b>
              <small>
                {conn
                  ? `連携済み（${new Date(conn.connected_at).toLocaleDateString("ja-JP")}）。分析するとレポートに実データが入ります。`
                  : "連携すると、検索クエリ・順位・流入チャネルに加え、自社YouTubeチャンネルの非公開指標（推定視聴時間・純増登録者数・主な流入経路など）も推定ではなく実データで出せます。"}
              </small>
            </div>
            {hasGoogleApp() ? (
              <GoogleConnect connected={!!conn} />
            ) : (
              <span className="tag warn">未設定</span>
            )}
          </div>
        </div>

        {!hasGoogleApp() && (
          <p className="note">
            <i className="i">i</i>
            <span>
              連携には <code>GOOGLE_CLIENT_ID</code> と <code>GOOGLE_CLIENT_SECRET</code> の設定が必要です。
            </span>
          </p>
        )}

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
