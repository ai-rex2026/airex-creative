import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = { title: "プライバシーポリシー｜AI-REX" };

export default function PrivacyPage() {
  return (
    <LegalPage
      title="AI-REX プライバシーポリシー"
      intro="株式会社アドレクスは、生成AIを活用したマーケティング支援サービス「AI-REX」における、個人情報を含むプライバシー情報の取扱いについて定めます。"
      sourceUrl="https://airex-ad.ai/ja/privacy"
      headings={[
        "第1条（法令等の遵守）",
        "第2条（取得する情報およびその取得方法）",
        "第3条（利用目的の明確化とAI学習に関する公表）",
        "第4条（外部AIプロバイダーへのデータ転送および外国にある第三者への提供に関する公表）",
        "第5条（第三者の個人情報の入力禁止および混入時の対応方針）",
        "第6条（個人関連情報・Cookie等の取扱い）",
        "第7条（安全管理措置および課徴金リスクへの備え）",
        "第8条（アカウント解除・退会後のデータ保持期間）",
        "第9条（保有個人データの開示、訂正、利用停止等の請求手順）",
        "第10条（本ポリシーの変更手続き）",
        "第11条（個人情報取扱事業者およびお問い合わせ窓口）",
      ]}
    />
  );
}
