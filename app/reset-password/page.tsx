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
            次の集客の一手が
            <br />
            わかる
          </h1>
          <p>広告、SEO、MEO、LP、SNS、サジェストなど集客に必要な次の一手が作業レベルでわかります。</p>
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
