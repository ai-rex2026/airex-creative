import { askJson } from "./anthropic";
import type { Diagnosis } from "./types";
import type { SiteScan } from "./site-scan";
import type { KpiTree } from "./kpi";
import type { MeoScan } from "./meo";
import type { PriceScan } from "./pricing";

/**
 * 施策。KPIに効くものだけを出す。
 *
 * 「HSTSを設定する」のような衛生管理は施策ではないので、ここには出さない。
 * それらは実測から機械的に作れるので、別のチェックリストに落とす。
 *
 * 優先順位で並べ替えることはしない（順位を決め打ちすると、担当も工数も違う
 * ものが一列に並んで動けなくなる）。代わりに効果の見込みを添えて、
 * 判断は見る人に委ねる。
 */

export type Impact = "大" | "中" | "小";
export type Effort = "すぐ" | "数日" | "数週間";

export type Measure = {
  id: string;
  title: string;
  /** 効くKPIのID。複数に効いてよい */
  kpis: string[];
  /** KPIツリーのどのノードを動かすか */
  node: string;
  impact: Impact;
  /** なぜその見込みなのか。実測値を根拠に書かせる */
  impactWhy: string;
  effort: Effort;
  /** 誰がやるか。担当が違うものを混ぜると止まる */
  owner: string;
  steps: string[];
  /** 完了したとどう判断するか */
  done: string;
};

export type MeasurePlan = { items: Measure[] };

const RULES = `守ること:
- **KPIに効くものだけを出す。** サーバー設定やセキュリティヘッダーのような衛生管理は書かない
  （それらは別のチェックリストで扱う）
- title は「何をするか」を動詞で。「〜の検討」「〜の強化」のような、やったか判断できない書き方は禁止
- kpis には効くKPIのIDを入れる。複数に効くなら複数入れる
- impactWhy は**渡された実測値を根拠に**書く。「一般的に効果が高い」は禁止
- effort は すぐ / 数日 / 数週間 のいずれか
- owner は実在する役割で。「サイト制作会社」「広告運用担当」「受付スタッフ」「店舗責任者」など
- steps は3〜5手順。誰がどこで何をするかを書く。プロセス語（体制構築・最適化推進）は禁止
- done は「何を見たら完了と判断できるか」。数えられるものにする
- 効果や結果を断定しない。「必ず」「保証」は使わない`;

function facts(d: Diagnosis, site: SiteScan | null, meo: MeoScan | null, pricing: PriceScan | null) {
  const cv = site?.conversions ?? [];
  return `商材: ${d.product}
ターゲット: ${d.audience}
業種: ${d.industry}
強み: ${d.strengths.join(" / ")}
買わない理由: ${d.objections.join(" / ")}

【実測できている事実】
${pricing?.main ? `主力商材: ${pricing.main.name} ${pricing.main.yen.toLocaleString()}円` : ""}
申し込みの受け口: ${cv.length ? cv.map((c) => `${c.kind}${c.measurable ? "（計測可）" : "（計測不可）"}`).join(" / ") : "検出できず"}
${cv.every((c) => !c.measurable) && cv.length > 0 ? "※ 計測できる受け口が無いため、広告を出しても成果を数えられません" : ""}
広告タグ: ${site?.adTags.join("・") || "なし"}
${site ? `構造化データ: ${site.structuredData ? "有" : "無"} / 内部リンク: ${site.internalLinks}` : ""}
${meo?.self ? `Googleマップ: 評価${meo.self.rating}（近隣平均${meo.avgRating}）レビュー${meo.self.reviews}件（近隣平均${meo.avgReviews}件・${meo.totalShops}店中${meo.reviewRank}位）` : ""}`;
}

export async function generateMeasures(
  d: Diagnosis,
  site: SiteScan | null,
  kpi: KpiTree,
  meo: MeoScan | null,
  pricing: PriceScan | null
): Promise<MeasurePlan> {
  return askJson<MeasurePlan>(
    `あなたは集客の実務者です。下のKPIに効く施策を設計します。

${RULES}
- items は6〜9件。KPIごとに偏らないよう散らす`,
    `${facts(d, site, meo, pricing)}

【追うKPI】
${kpi.candidates.map((c) => `- ${c.id}：${c.name}（${c.node}）／ ${c.trackable}`).join("\n")}

出力:
{"items":[{"id":"m1","title":"","kpis":["k1"],"node":"","impact":"大","impactWhy":"",
 "effort":"すぐ","owner":"","steps":[""],"done":""}]}`,
    { maxTokens: 6000 }
  );
}

/**
 * 自由入力で足されたKPIについてだけ施策を考える。
 * 既存の施策は作り直さない。作り直すと、済みにした印が消える。
 */
export async function measuresForKpi(
  d: Diagnosis,
  site: SiteScan | null,
  meo: MeoScan | null,
  pricing: PriceScan | null,
  kpiId: string,
  kpiName: string,
  existing: string[]
): Promise<MeasurePlan> {
  return askJson<MeasurePlan>(
    `あなたは集客の実務者です。指定されたKPI1つに効く施策を設計します。

${RULES}
- items は2〜4件。**このKPIに効くものだけ**
- kpis には必ず "${kpiId}" を入れる
- すでにある施策と重複するものは出さない`,
    `${facts(d, site, meo, pricing)}

【追うKPI】
${kpiId}：${kpiName}

【すでにある施策（重複させない）】
${existing.length ? existing.map((x) => `- ${x}`).join("\n") : "（なし）"}

出力:
{"items":[{"id":"","title":"","kpis":["${kpiId}"],"node":"","impact":"大","impactWhy":"",
 "effort":"すぐ","owner":"","steps":[""],"done":""}]}`,
    { maxTokens: 3000 }
  );
}

/**
 * 衛生管理のチェックリスト。KPIに直結しないので施策とは分ける。
 * AI を使わず実測から機械的に作る。
 */
export function hygiene(site: SiteScan | null) {
  if (!site) return [];
  const out: { label: string; how: string }[] = [];
  for (const h of site.headers.filter((x) => !x.pass)) {
    out.push({ label: `${h.label} が未設定`, how: `サーバーまたはCDNのレスポンスヘッダーに ${h.desc} を追加する` });
  }
  if (!site.https) out.push({ label: "HTTPS に未対応", how: "常時SSL化する" });
  if (!site.sitemapXml) out.push({ label: "sitemap.xml が無い", how: "サイトマップを生成し、Search Console に登録する" });
  if (!site.structuredData) out.push({ label: "構造化データが無い", how: "業種に合ったスキーマ（LocalBusiness など）を head に追加する" });
  return out;
}
