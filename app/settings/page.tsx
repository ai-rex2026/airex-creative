import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Shell } from "@/components/Shell";
import { SignOutButton } from "@/components/SignOutButton";
import { GoogleConnect } from "@/components/GoogleConnect";
import { AdConnections } from "@/components/AdConnections";
import { SnsConnections } from "@/components/SnsConnections";
import { googleConnection } from "@/app/actions";
import { adConnections } from "@/app/ad-actions";
import { snsConnections } from "@/app/social-actions";
import { hasGoogleApp } from "@/lib/google";

export const metadata = { title: "設定｜AI-REX Studio" };

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login?callbackUrl=%2Fsettings");

  const conn = await googleConnection();
  const adConns = await adConnections();
  const snsConns = await snsConnections();

  // MEO運用ページ（テスト中）への入口。MEO分析のうち、Googleの店舗を紐付け済みのものを優先し、
  // なければ最新のMEO分析へ送る（通常のレポートには送らない）。どの店舗かを文言に出して取り違えを防ぐ
  let meoHref: string | null = null;
  let meoStore: string | null = null;
  if (!user.is_anonymous) {
    const { data: rows } = await sb
      .from("analyses")
      .select("id, meo_gbp_location, meo_store")
      .eq("owner_id", user.id)
      .eq("status", "done")
      .eq("mode", "meo")
      .order("created_at", { ascending: false })
      .limit(20);
    const pick = (rows ?? []).find((r) => r.meo_gbp_location) ?? (rows ?? [])[0];
    if (pick?.id) {
      meoHref = `/analysis/${pick.id}/meo`;
      meoStore = ((pick.meo_store as { name?: string } | null)?.name ?? "").split(/[|｜]/)[0].trim() || null;
    }
  }

  const sp = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

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
                  ? "このブラウザからのみ分析を見られます。無料登録すると他の端末からも見られます。"
                  : "このメールアドレスでログインしています"}
              </small>
            </div>
            {user.is_anonymous && (
              <a className="btn ghost sm" href="/login?mode=signup">無料登録する</a>
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
              <GoogleConnect connected={!!conn} isGuest={!!user.is_anonymous} />
            ) : (
              <span className="tag warn">未設定</span>
            )}
          </div>
        </div>

        {!hasGoogleApp() && (
          <p className="note">
            <i className="i">i</i>
            <span>
              Google連携には <code>GOOGLE_CLIENT_ID</code> と <code>GOOGLE_CLIENT_SECRET</code> の設定が必要です。
            </span>
          </p>
        )}

        <AdConnections
          connections={adConns}
          canConnect={!user.is_anonymous}
          ok={first(sp.ad_ok)}
          error={first(sp.ad_error)}
        />

        <SnsConnections
          connections={snsConns}
          canConnect={!user.is_anonymous}
          ok={first(sp.sns_ok)}
          error={first(sp.sns_error)}
        />

        {user.is_anonymous && (
          <p className="note">
            <i className="i">i</i>
            <span>
              ゲストのままログアウトすると、<b style={{ fontWeight: 600 }}>いまの分析は二度と開けなくなります</b>。
              先に無料登録してください。
            </span>
          </p>
        )}

        {meoHref && (
          <p style={{ marginTop: 40, textAlign: "center" }}>
            <a href={meoHref} style={{ fontSize: 12, color: "var(--faint)", textDecoration: "underline" }}>
              MEO運用ページ（テスト中）{meoStore ? `：${meoStore}` : ""}
            </a>
          </p>
        )}
      </div>
    </Shell>
  );
}
