import { askJson } from "./anthropic";
import type { Diagnosis } from "./types";
import type { SiteScan } from "./site-scan";
import type { KpiTree } from "./kpi";
import { checkGuard } from "./guardrail";
import type { GuardHit, Industry } from "./types";
import type { MeoScan } from "./meo";
import type { PriceScan } from "./pricing";
import { platformNotes } from "./ad-platforms";
import { socialFacts, type SocialScan } from "./social";
import type { Runbook } from "./runbook";

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
  /** 法令上の指摘。施策の文言も検査する */
  flags?: { text: string; law: string; reason: string; suggestion: string }[];
  /** 実行用のプロンプト。使うときに作るので、最初は無い */
  runbook?: Runbook;
};

export type MeasurePlan = { items: Measure[] };

const RULES = `守ること:
- **KPIに効くものだけを出す。** サーバー設定やセキュリティヘッダーのような衛生管理は書かない
  （それらは別のチェックリストで扱う）
- title は「何をするか」を動詞で。「〜の検討」「〜の強化」のような、やったか判断できない書き方は禁止
- kpis には効くKPIのIDを入れる。複数に効くなら複数入れる
- impactWhy は**渡された実測値を引用して**書く。次はすべて禁止
  ・渡されていない数字（「CTRが20〜30%向上する」「平均◯%改善」など）
  ・最上級と断定（「最も効果が高い」「必ず」「確実に」）
  ・一般論（「一般的に効果が高い」「業界では常識」）
  実測値が無い項目は、数字を出さずに**なぜそう考えるかを定性で**書く
  ・渡された実測値に、根拠のない良し悪しの判断を付けない
    （「内部リンク55本は多すぎる」など。多いか少ないかの基準を持っていない）
- node は下の「KPIツリーのノード」からそのままコピーして使う。自分で言葉を作らない
- effort は すぐ / 数日 / 数週間 のいずれか
- owner は実在する役割で。「サイト制作会社」「広告運用担当」「受付スタッフ」「店舗責任者」など
- steps は3〜5手順。誰がどこで何をするかを書く。プロセス語（体制構築・最適化推進）は禁止
- done は「何を見たら完了と判断できるか」。数えられるものにする
- 効果や結果を断定しない。「必ず」「保証」は使わない`;

function facts(
  d: Diagnosis,
  site: SiteScan | null,
  meo: MeoScan | null,
  pricing: PriceScan | null,
  extra: { platform: string; url: string }[] = [],
  doneTitles: string[] = [],
  social: SocialScan | null = null
) {
  const cv = site?.conversions ?? [];
  const sns = socialFacts(social);
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
${meo?.self ? `Googleマップ: 評価${meo.self.rating}（近隣平均${meo.avgRating}）レビュー${meo.self.reviews}件（近隣平均${meo.avgReviews}件・${meo.totalShops}店中${meo.reviewRank}位）` : ""}

${extra.length ? `
【すでに運用しているもの】※ これらを新規に作る施策は出さない
${extra.map((x) => `- ${x.platform}：${x.url}`).join("\n")}` : ""}
${doneTitles.length ? `
【もう実施済みの施策】※ 同じ内容を再び出さない。続きが要るなら別の施策として書く
${doneTitles.map((t) => `- ${t}`).join("\n")}` : ""}
${sns ? `
【運用中の公式SNS】※ 実測。新規に開設する施策は出さない。今ある数値を動かす施策を書く
${sns}` : ""}

【媒体の事実】※ 自分の知識より、ここに書いてあることを優先する
${platformNotes()}`;
}

/** どのKPIを動かす施策なのかを、必ず画面に出せる形にそろえる */
function fixNodes(items: Measure[], kpi: KpiTree): Measure[] {
  // ツリーの段を第一候補にする。ただし候補KPIはツリーに無い指標を含むので
  // （売上ツリーに載らない「サイト訪問数」など）、そちらも許可する。
  // 空欄で返すと施策がどのKPIの話か画面から消えるため、最後は
  // その施策が効くKPIの名前で埋める。
  const allowed = [
    ...kpi.branches.map((b) => b.node),
    ...kpi.candidates.flatMap((c) => [c.node, c.name]),
  ].filter(Boolean);
  const nameOf = (id: string) => kpi.candidates.find((c) => c.id === id)?.name ?? "";
  return items.map((m) => ({
    ...m,
    node:
      allowed.find((a) => a === m.node) ??
      allowed.find((a) => (m.node ? m.node.includes(a) || a.includes(m.node) : false)) ??
      nameOf(m.kpis?.[0] ?? "") ??
      "",
  }));
}

/** 施策の文言も法令チェックにかける。コピーだけ検査しても、施策名に残る */
async function flag(items: Measure[], industry: Industry): Promise<Measure[]> {
  const texts = items.flatMap((m) => [m.title, m.impactWhy, ...(m.steps ?? [])]);
  let hits: GuardHit[] = [];
  try {
    hits = (await checkGuard(texts, industry)).hits.filter((h) => h.severity !== "low");
  } catch {
    return items; // 検査できなくても施策は返す
  }
  return items.map((m) => {
    const own = hits.filter((h) => [m.title, m.impactWhy, ...(m.steps ?? [])].some((t) => t?.includes(h.text)));
    return own.length
      ? { ...m, flags: own.map((h) => ({ text: h.text, law: h.law, reason: h.reason, suggestion: h.suggestion })) }
      : m;
  });
}

export async function generateMeasures(
  d: Diagnosis,
  site: SiteScan | null,
  kpi: KpiTree,
  meo: MeoScan | null,
  pricing: PriceScan | null,
  extra: { platform: string; url: string }[] = [],
  doneTitles: string[] = [],
  social: SocialScan | null = null
): Promise<MeasurePlan> {
  const res = await askJson<MeasurePlan>(
    `あなたは集客の実務者です。下のKPIに効く施策を設計します。

${RULES}
- items は6〜9件
- **node を1つに集中させない。** 上のノードのうち少なくとも3つに散らす。
  「問い合わせを増やす」だけでなく、来院率・単価・リピートを動かす施策も考える`,
    `${facts(d, site, meo, pricing, extra, doneTitles, social)}

【追うKPI】
${kpi.candidates.map((c) => `- ${c.id}：${c.name}（${c.node}）／ ${c.trackable}`).join("\n")}

【KPIツリーのノード】※ node にはこの中の語をそのまま使う
${kpi.branches.map((b) => `- ${b.node}（${b.formula}）`).join("\n")}

出力:
{"items":[{"id":"m1","title":"","kpis":["k1"],"node":"","impact":"大","impactWhy":"",
 "effort":"すぐ","owner":"","steps":[""],"done":""}]}`,
    { maxTokens: 6000 }
  );
  const items = fixNodes(res.items ?? [], kpi);
  return { items: await flag(items, d.industry) };
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
  existing: string[],
  extra: { platform: string; url: string }[] = []
): Promise<MeasurePlan> {
  const res = await askJson<MeasurePlan>(
    `あなたは集客の実務者です。指定されたKPI1つに効く施策を設計します。

${RULES}
- items は2〜4件。**このKPIに効くものだけ**
- kpis には必ず "${kpiId}" を入れる
- すでにある施策と重複するものは出さない`,
    `${facts(d, site, meo, pricing, extra)}

【追うKPI】
${kpiId}：${kpiName}

【すでにある施策（重複させない）】
${existing.length ? existing.map((x) => `- ${x}`).join("\n") : "（なし）"}

出力:
{"items":[{"id":"","title":"","kpis":["${kpiId}"],"node":"","impact":"大","impactWhy":"",
 "effort":"すぐ","owner":"","steps":[""],"done":""}]}`,
    { maxTokens: 3000 }
  );
  return { items: await flag(res.items ?? [], d.industry) };
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
