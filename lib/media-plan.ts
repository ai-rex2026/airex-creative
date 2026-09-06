import { askJson } from "./anthropic";
import type { Diagnosis, MediaPlanItem } from "./types";
import type { SiteScan } from "./site-scan";

/**
 * 広告手法の提案。どの媒体に、どういう理由で、予算の何割を割くか。
 * CPA/CVR/CTR は業界平均をもとにした目安で、実績の保証ではない。
 * その断りは画面にも必ず出す（本番 AI-REX も同じ注記を入れている）。
 */
export async function generateMediaPlan(d: Diagnosis, site: SiteScan | null): Promise<MediaPlanItem[]> {
  const res = await askJson<{ items: MediaPlanItem[] }>(
    `あなたは広告運用のプランナーです。商材とターゲットから、使うべき広告媒体を優先順位付きで3〜4件提案します。

制約:
- channel は実在する媒体名（Google検索広告 / Meta広告 / YouTube広告 / Yahoo!検索広告 / LINE広告 / TikTok広告 など）
- priority は 最優先 / 推奨 / 検討 のいずれか。最優先は1件だけ
- share は予算配分（%）。合計をちょうど100にする
- reason は「なぜこの商材にこの媒体が向くか」を2文以内で。検索意図・単価・比較検討の有無に触れる
- cpa / cvr / ctr は業界平均をもとにした目安。「25,000円」「0.8%」のような文字列で書く。
  推測できない場合は省略してよい。**保証と受け取れる書き方はしない**`,
    `商材: ${d.product}
ターゲット: ${d.audience}
業種: ${d.industry}
強み: ${d.strengths.join(" / ")}
買わない理由: ${d.objections.join(" / ")}
訴求軸: ${d.angles.map((a) => a.name).join(" / ")}
${site ? `既に入っている広告タグ: ${site.adTags.join(", ") || "なし"}` : ""}

出力: {"items":[{"channel":"","priority":"最優先","share":50,"reason":"","cpa":"","cvr":"","ctr":""}]}`,
    { maxTokens: 2500 }
  );
  return res.items ?? [];
}
