import type { Metadata } from "next";
import { SimpleHeader, SiteFooter } from "@/components/Chrome";

export const metadata: Metadata = { title: "会社概要｜AI-REX" };

/** 本番サイトの特定商取引法表記・プライバシーポリシーに記載のある内容だけを載せる */
const rows: [string, React.ReactNode][] = [
  ["会社名", "株式会社アドレクス"],
  ["代表者", "代表取締役社長　田代 逸哉人"],
  ["所在地", "〒105-0002　東京都港区愛宕2丁目5-1　愛宕グリーンヒルズMORIタワー34階"],
  ["お問い合わせ", <a key="m" href="mailto:info@airex-ad.ai">info@airex-ad.ai</a>],
  ["担当部署", "AIサポート窓口"],
  ["事業内容", "生成AIを活用したマーケティング支援サービスの企画・開発・運営"],
];

export default function CompanyPage() {
  return (
    <>
      <SimpleHeader />
      <div className="page">
        <h1>会社概要</h1>
        <p className="intro">
          AI-REX は株式会社アドレクスが企画・開発・運営しています。
        </p>
        <table className="spec">
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}>
                <th>{k}</th>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="note">
          <i className="i">i</i>
          <span>
            設立年月日・資本金・従業員数は公開情報に記載が無いため載せていません。掲載する場合はお知らせください。
          </span>
        </p>
      </div>
      <SiteFooter />
    </>
  );
}
