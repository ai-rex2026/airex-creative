import { askJson } from "./anthropic";
import type { BannerCopy, Diagnosis, Summary } from "./types";
import type { SeoEstimate, SiteScan } from "./site-scan";

/**
 * レポートの要約。読み手が最初に見る層なので、
 * 「まずやること」は期限と完了条件まで書かせる（そこまで無いと動けない）。
 */
export async function generateSummary(
  d: Diagnosis,
  site: SiteScan | null,
  seo: SeoEstimate | null,
  copies: BannerCopy[]
): Promise<Summary> {
  const failed = site?.headers.filter((h) => !h.pass).map((h) => h.label) ?? [];
  const red = copies.filter((c) => c.guard?.level === "red").length;

  return askJson<Summary>(
    `あなたは広告運用のプランナーです。分析結果から、レポート冒頭の要約を作ります。

- overall は 良好 / 標準 / 要改善 のいずれか
- excerpt は一覧カードに出す1〜2文の要約（全角80文字以内）
- scores は CVR・SEO・ターゲティング・LP を 強 / 標準 / 弱 で
- best は最も強い点、worst は最も弱い点を、それぞれ8文字以内の短い名詞で
- personas は2人。name は8〜20文字でその人物像を言い切る
- **firstSteps は3つ。今週から始められる順に、action（何をするか）・
  due（いつまでに）・done（何をもって完了とするか）を必ず埋める。**
  done は「〜が表示されること」「〜で確認できること」のように、
  見れば終わったと分かる形で書く。精神論を書かない`,
    `商材: ${d.product}
ターゲット: ${d.audience}
業種: ${d.industry}
強み: ${d.strengths.join(" / ")}
買わない理由: ${d.objections.join(" / ")}
訴求軸: ${d.angles.map((a) => a.name).join(" / ")}
${site ? `技術面: HTTPS ${site.https ? "対応" : "未対応"} / セキュリティヘッダー未設定 ${failed.join("・") || "なし"} / 構造化データ ${site.structuredData ? "有り" : "無し"} / sitemap ${site.sitemapXml ? "有り" : "無し"} / 検出した広告タグ ${site.adTags.join("・") || "HTMLからは検出できず"}` : ""}
${seo ? `SEO強度の推定: ${seo.score}点（${seo.label}）` : ""}
法令チェック: ${copies.length}案中 ${red}案が要修正

出力:
{"overall":"要改善","excerpt":"","scores":{"cvr":"標準","seo":"弱","targeting":"標準","lp":"標準"},
 "best":"","worst":"",
 "personas":[{"name":"","who":"","pain":"","trigger":""}],
 "firstSteps":[{"action":"","due":"","done":""}]}`,
    { maxTokens: 3000 }
  );
}
