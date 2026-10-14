import type { Metadata } from "next";
import { SimpleHeader, SiteFooter } from "@/components/Chrome";

export const metadata: Metadata = { title: "データ削除の手順｜AI-REX" };

/**
 * 外部サービス連携（Meta など）で取得したデータの削除手順（2026-10-14 新設）。
 * Meta アプリの「データの削除手順URL」に登録する。規約の条文ではなく、実際の操作手順だけを書く
 * （連携の解除＝ad_connections / sns_connections のトークン削除。app/ad-actions.ts・app/social-actions.ts）。
 */
export default function DataDeletionPage() {
  return (
    <>
      <SimpleHeader />
      <div className="page">
        <h1>データ削除の手順</h1>
        <p className="intro">
          AI-REX（株式会社アドレクス）で連携した外部サービス（Facebook・Instagram・Meta 広告、Google、X、TikTok など）のデータを削除する方法です。
        </p>

        <section>
          <h2>1. AI-REX で連携を解除する</h2>
          <p>
            ログイン後、「設定」画面の「広告アカウント連携」または「SNS連携」で、該当サービスの「連携を解除」を押してください。
            AI-REX に保存しているそのサービスのアクセストークンと連携情報は、その場で削除されます。
          </p>
        </section>

        <section>
          <h2>2. Facebook 側でアクセス許可を取り消す</h2>
          <p>
            Facebook の「設定とプライバシー」→「設定」→「ビジネス統合」（または「アプリとウェブサイト」）を開き、
            「airex-creative-ads」を選んで「削除」を押してください。AI-REX から Facebook・Instagram・Meta 広告のデータを読み取れなくなります。
          </p>
        </section>

        <section>
          <h2>3. 分析結果を含むすべてのデータの削除を依頼する</h2>
          <p>
            連携で取得したデータを使って作成した分析結果やアカウント情報もあわせて削除したい場合は、
            登録メールアドレスから <a href="mailto:info@airex-ad.ai?subject=データ削除の依頼">info@airex-ad.ai</a> 宛に
            「データ削除の依頼」としてご連絡ください。ご本人確認のうえ削除し、完了をメールでお知らせします。
          </p>
        </section>

        <section>
          <h2>Data deletion instructions (English)</h2>
          <p>
            1) In AI-REX, open Settings and click &quot;連携を解除&quot; (Disconnect) for the service. The stored access tokens are deleted immediately.
            2) On Facebook, go to Settings &amp; privacy → Settings → Business integrations (or Apps and websites), select &quot;airex-creative-ads&quot; and remove it.
            3) To delete all data, including analysis results, email <a href="mailto:info@airex-ad.ai?subject=Data%20deletion%20request">info@airex-ad.ai</a> from
            your registered address with the subject &quot;Data deletion request&quot;. We will verify your identity, delete the data, and confirm by email.
          </p>
        </section>

        <section>
          <h2>事業者情報</h2>
          <table className="spec" style={{ marginTop: 12 }}>
            <tbody>
              <tr><th>事業者</th><td>株式会社アドレクス</td></tr>
              <tr><th>連絡先</th><td><a href="mailto:info@airex-ad.ai">info@airex-ad.ai</a></td></tr>
            </tbody>
          </table>
        </section>
      </div>
      <SiteFooter />
    </>
  );
}
