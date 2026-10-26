import type { Metadata } from "next";
import { NavProgress } from "@/components/NavProgress";
import { Noto_Sans_JP } from "next/font/google";
import "./globals.css";

// C案1（基本形）: 書体は Noto Sans JP だけ
const jp = Noto_Sans_JP({ variable: "--font-jp", subsets: ["latin"], weight: ["400", "500", "700"] });

export const metadata: Metadata = {
  title: "AI-REX Studio",
  description:
    "サイトのURLから、訴求軸・コピー・バナー・LPまでを作る。生成と同時に景表法・薬機法の表現チェックを通します。",
  // 社内向けツールなので検索結果には出さない
  robots: { index: false, follow: false },
  icons: { icon: "/icon.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ja"
      className={`${jp.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <NavProgress />{children}</body>
    </html>
  );
}
