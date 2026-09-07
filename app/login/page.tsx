import type { Metadata } from "next";
import { Logo } from "@/components/Chrome";
import { AuthForm } from "@/components/AuthForm";

export const metadata: Metadata = { title: "ログイン｜AI-REX Studio" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; mode?: string; error?: string }>;
}) {
  const { callbackUrl, mode, error } = await searchParams;

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
        <AuthForm callbackUrl={callbackUrl && callbackUrl !== "/" ? callbackUrl : "/analysis"} initialMode={mode === "signup" ? "signup" : "signin"} initialError={error ?? null} />
      </div>
    </div>
  );
}
