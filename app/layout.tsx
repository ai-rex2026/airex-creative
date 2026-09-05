import type { Metadata } from "next";
import { Poppins, Open_Sans, Noto_Sans_JP } from "next/font/google";
import "./globals.css";

// 本番 airex-ad.ai と同じ組み合わせ（見出し Poppins / 本文 Open Sans / 和文 Noto Sans JP）
const display = Poppins({ variable: "--font-display", subsets: ["latin"], weight: ["600", "700"] });
const body = Open_Sans({ variable: "--font-body", subsets: ["latin"], weight: ["400", "600"] });
const jp = Noto_Sans_JP({ variable: "--font-jp", subsets: ["latin"], weight: ["400", "500", "700"] });

export const metadata: Metadata = {
  title: "AI-REX Studio",
  description:
    "サイトのURLから、訴求軸・コピー・バナー・LPまでを作る。生成と同時に景表法・薬機法の表現チェックを通します。",
  // 社内向けツールなので検索結果には出さない
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ja"
      className={`${display.variable} ${body.variable} ${jp.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
