import Link from "next/link";
import type { Metadata } from "next";
import { Logo } from "@/components/Chrome";

export const metadata: Metadata = { title: "ログイン｜AI-REX Studio" };

export default function LoginPage() {
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
        <div className="inner">
          <h2>ログイン</h2>
          <p className="sub">メールアドレスとパスワードを入力してください</p>
          <form className="card" action="#" method="post">
            <label htmlFor="email">メールアドレス</label>
            <input id="email" name="email" type="email" placeholder="example@email.com" autoComplete="email" />
            <label htmlFor="pw">
              パスワード
              <a href="#">パスワードを忘れた</a>
            </label>
            <input id="pw" name="password" type="password" placeholder="••••••••" autoComplete="current-password" />
            <button className="btn" type="submit">ログインする</button>
          </form>
          <p className="foot">
            アカウントをお持ちでない方は <Link href="/contact">お問い合わせ</Link>
          </p>
          <p className="note" style={{ justifyContent: "center", marginTop: 24 }}>
            <i className="i">i</i>
            <span>認証機能はまだ実装していません。この画面は本番サイトの体裁に合わせた枠だけです。</span>
          </p>
        </div>
      </div>
    </div>
  );
}
