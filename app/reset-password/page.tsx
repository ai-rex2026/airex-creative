import type { Metadata } from "next";
import { Logo } from "@/components/Chrome";
import { ResetPasswordForm } from "@/components/ResetPasswordForm";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "パスワード再設定｜AI-REX Studio" };

/**
 * メールの再設定リンクは /auth/callback?next=/reset-password を経由して来る。
 * そこでリカバリー用のセッションを確立済みなので、ここでは未ログインなら
 * リンク切れとして案内するだけでよい。
 */
export default async function ResetPasswordPage() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();

  return (
    <div className="auth">
      <div className="side">
        <Logo />
        <div className="body">
          <p className="eyebrow">プロ監修AI</p>
          <h1>
            URLひとつで、
            <br />
            訴求軸からバナーと
            <br />
            LPまで
          </h1>
          <p>サイト分析から訴求軸の抽出、コピー・バナー・LPの制作まで。1本の流れで作れます。</p>
          <div className="pt"><i>◆</i>訴求軸ごとにコピーを自動生成</div>
          <div className="pt"><i>◆</i>生成と同時に景表法・薬機法をチェック</div>
          <div className="pt"><i>◆</i>Meta・Google・Yahoo のサイズを一括書き出し</div>
        </div>
      </div>
      <div className="main">
        {user ? (
          <ResetPasswordForm />
        ) : (
          <div className="inner">
            <h2>リンクの有効期限が切れています</h2>
            <p className="sub">お手数ですが、ログイン画面から「パスワードを忘れた」をもう一度お試しください。</p>
            <a
              href="/login"
              className="btn"
              style={{ width: "100%", justifyContent: "center", marginTop: 18, textDecoration: "none" }}
            >
              ログイン画面へ
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
