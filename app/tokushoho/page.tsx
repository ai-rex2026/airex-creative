import type { Metadata } from "next";
import { SimpleHeader, SiteFooter } from "@/components/Chrome";

export const metadata: Metadata = { title: "特定商取引法に基づく表記｜AI-REX" };

const rows: [string, React.ReactNode][] = [
  ["販売業者の名称", "株式会社アドレクス"],
  ["代表者名または責任者名", "田代 逸哉人"],
  ["所在地", "東京都港区愛宕2丁目5-1 愛宕グリーンヒルズMORIタワー34階"],
  ["連絡先", "【要確認】（ご請求をいただいた場合、遅滞なく書面または電子メールにて開示いたします）"],
  ["販売価格（プラン料金）", "各プランの購入ページ、またはお申し込み画面（最終確認画面）に表示される金額（消費税込み）となります。"],
  ["商品代金以外の必要料金", "なし（※サイト閲覧やコンテンツ利用、ダウンロード時に発生するインターネット通信料は、お客様のご負担となります）。"],
  ["代金の支払時期・支払方法", <><b>支払方法：</b>クレジットカード決済<br /><b>支払時期：</b>初回お申し込み時に即時決済。以降の課金タイミングは、お申し込みいただいたプラン・コース（月額等）の条件に従い、自動的に決済が行われます。</>],
  ["役務または商品の引き渡し時期", "課金手続き（決済）完了後、即時ご利用いただけます。"],
  ["返品・返金・キャンセルについて", "デジタルコンテンツの性質上、決済完了後のお客様都合による返品・返金は承っておりません。"],
  ["動作環境", "最新版の Google Chrome / Safari / Microsoft Edge を推奨します。"],
];

export default function TokushohoPage() {
  return (
    <>
      <SimpleHeader />
      <div className="page">
        <h1>特定商取引法に基づく表記</h1>
        <p className="intro">
          「特定商取引に関する法律」第11条（通信販売についての広告）に基づき、以下のとおり表示します。
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
          <span>連絡先は本番サイトでも未記入のため、こちらも空けています。公開前に確定してください。</span>
        </p>
      </div>
      <SiteFooter />
    </>
  );
}
