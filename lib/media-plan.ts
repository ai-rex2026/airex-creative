import { askJson } from "./anthropic";
import { budgetOf, type BudgetBand, type Diagnosis, type MediaPlanItem } from "./types";
import type { SiteScan } from "./site-scan";

/**
 * 広告手法の提案。どの媒体に、どういう理由で、予算の何割を割くか。
 * CPA/CVR/CTR は業界平均をもとにした目安で、実績の保証ではない。
 * その断りは画面にも必ず出す（本番 AI-REX も同じ注記を入れている）。
 */
export async function generateMediaPlan(
  d: Diagnosis,
  site: SiteScan | null,
  budget?: BudgetBand | null
): Promise<MediaPlanItem[]> {
  const b = budgetOf(budget);
  const res = await askJson<{ items: MediaPlanItem[] }>(
    `あなたは広告運用のプランナーです。商材とターゲットから、使うべき広告媒体を優先順位付きで3〜5件提案します。
ここで挙げた媒体は、すべてキャンペーン・広告グループの構成まで設計します。

制約:
- channel は次の表記から選ぶ：Google検索広告 / Yahoo!検索広告 / Google P-MAX / Googleディスプレイ広告 / YouTube広告 /
  Meta広告 / LINE広告 / TikTok広告 / Yahoo!ディスプレイ広告
- **Google P-MAX を候補から外さない。** 次に当てはまるなら入れる：コンバージョン計測ができる（または設置できる）、
  月に一定数のコンバージョンが見込める、検索広告だけでは取りこぼす層（ディスプレイ・YouTube・Gmail・マップ）まで広げたい。
  入れる場合は、学習に予算と期間が要ることと、指名検索を食い合わないようブランド除外が要ることを reason に書く。
  外すのは、少額予算で学習が回らない・計測できる受け口が無いなど、この商材に固有の理由があるときだけ
- priority は 最優先 / 推奨 / 検討 のいずれか。最優先は1件だけ
- share は予算配分（%）。合計をちょうど100にする
- reason は「なぜこの商材にこの媒体が向くか」を2文以内で。検索意図・単価・比較検討の有無に触れる
- cpa / cvr / ctr は業界平均をもとにした目安。「25,000円」「0.8%」のような文字列で書く。
  推測できない場合は省略してよい。**保証と受け取れる書き方はしない**
${b ? `- 月間予算は ${b.label}。この規模で**学習が回る本数**に媒体を絞ること。
  予算を薄く広げると、どの媒体もデータが溜まらず判断できなくなる。
  月100万円未満なら2〜3媒体まで。1媒体あたりの月額が10万円を割る配分は作らない
  （この場合は3〜5件の下限より、予算の制約を優先する）` : ""}`,
    `商材: ${d.product}
ターゲット: ${d.audience}
業種: ${d.industry}
強み: ${d.strengths.join(" / ")}
買わない理由: ${d.objections.join(" / ")}
訴求軸: ${d.angles.map((a) => a.name).join(" / ")}
${site ? `既に入っている広告タグ: ${site.adTags.join(", ") || "なし"}` : ""}
${b ? `月間広告予算: ${b.label}` : "月間広告予算: 未入力"}

出力: {"items":[{"channel":"","priority":"最優先","share":50,"reason":"","cpa":"","cvr":"","ctr":""}]}`,
    { maxTokens: 2500 }
  );
  return res.items ?? [];
}
