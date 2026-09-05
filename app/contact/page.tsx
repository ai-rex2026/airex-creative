import type { Metadata } from "next";
import { SimpleHeader, SiteFooter } from "@/components/Chrome";

export const metadata: Metadata = { title: "お問い合わせ｜AI-REX" };

export default function ContactPage() {
  return (
    <>
      <SimpleHeader />
      <div className="page">
        <h1>お問い合わせ</h1>
        <p className="intro">
          サービスに関するご質問・ご相談は、以下のフォームよりお気軽にお問い合わせください。担当者よりご連絡いたします。
        </p>

        <div className="trust">
          <div className="top">
            <span style={{ color: "var(--gold-text)" }}>✓</span>
            お問い合わせ先は株式会社アドレクス
            <a className="more" href="https://airex-ad.ai/ja/contact" target="_blank" rel="noreferrer">会社概要 ↗</a>
          </div>
          <div className="stats">
            <div className="st"><b>100億円超</b><small>広告運用額</small></div>
            <div className="st"><b>259社</b><small>取引社数（2026年6月期）</small></div>
            <div className="st"><b>5年連続</b><small>ベストベンチャー100</small></div>
          </div>
          <p className="fine">
            元博報堂・元Google・元LINE などの少数精鋭チームが、クライアント名義のアカウントで運用します。
          </p>
        </div>

        <form className="form" action="#" method="post">
          <p className="disp" style={{ fontSize: 15 }}>お問い合わせフォーム</p>
          <p className="req">
            <span className="must">*</span> は必須項目です
          </p>

          <label htmlFor="name">お名前<span className="must">*</span></label>
          <input id="name" name="name" placeholder="山田 太郎" required />

          <label htmlFor="company">会社名<span className="must">*</span></label>
          <input id="company" name="company" placeholder="株式会社〇〇" required />

          <label htmlFor="mail">メールアドレス<span className="must">*</span></label>
          <input id="mail" name="email" type="email" placeholder="example@company.co.jp" required />

          <label htmlFor="tel">電話番号（任意）</label>
          <input id="tel" name="tel" placeholder="03-0000-0000" />

          <label htmlFor="budget">月間広告予算<span className="must">*</span></label>
          <select id="budget" name="budget" required defaultValue="">
            <option value="" disabled>予算を選択してください</option>
            <option>10万円未満</option>
            <option>10万〜30万円</option>
            <option>30万〜100万円</option>
            <option>100万〜300万円</option>
            <option>300万円以上</option>
          </select>

          <label htmlFor="msg">ご要望・ご質問<span className="must">*</span></label>
          <textarea id="msg" name="message" rows={5} required />

          <div className="actions">
            <a className="btn ghost" href="/">戻る</a>
            <button className="btn" type="submit">送信する</button>
          </div>
        </form>

        <p className="note">
          <i className="i">i</i>
          <span>送信先の設定はまだ入れていません。この画面は本番サイトの体裁に合わせた枠だけです。</span>
        </p>
      </div>
      <SiteFooter />
    </>
  );
}
