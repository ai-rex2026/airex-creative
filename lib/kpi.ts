import { askJson } from "./anthropic";
import type { Diagnosis } from "./types";
import type { SiteScan } from "./site-scan";
import type { PriceScan } from "./pricing";
import type { MeoScan } from "./meo";
import type { Ga4Data, GscData } from "./google";

/**
 * 事業のKPIを先に決める。
 *
 * 「HSTSを設定する」は作業であって施策ではない。施策とは、実施することで
 * 事業のKPIに効くもの。だからKPIの仮説を立てるところから始める。
 *
 * 追えるKPIと追えないKPIを分けて出すのが肝。追えないものを主指標に置くと、
 * 翌月から何も報告できなくなる。
 */

export type Trackable = "実測できます" | "連携が必要です" | "追えません";

export type KpiCandidate = {
  id: string;
  name: string;
  /** KPIツリーのどのノードか */
  node: string;
  /** この事業でなぜこれを見るのか */
  why: string;
  trackable: Trackable;
  /** 追う方法、または追えない理由 */
  how: string;
};

export type KpiTree = {
  /** 事業モデルの仮説を1〜2文で */
  model: string;
  /** 売上の分解。上から下へ */
  branches: { node: string; formula: string; note: string }[];
  candidates: KpiCandidate[];
};

export async function generateKpi(
  d: Diagnosis,
  site: SiteScan | null,
  pricing: PriceScan | null,
  meo: MeoScan | null,
  gsc: GscData | null,
  ga4: Ga4Data | null
): Promise<KpiTree> {
  const cv = site?.conversions ?? [];
  const measurable = cv.filter((c) => c.measurable);

  const res = await askJson<KpiTree>(
    `あなたは事業のKPI設計をする人です。サイトから読み取れる事実だけを使って、
この事業が追うべきKPIの仮説を立てます。

守ること:
- model は事業モデルを1〜2文。何を売って、どこで収益を得ているか。渡された事実だけで書く
- branches は売上の分解を3〜5段。上から下へ。formula は「新規客数 × 客単価」のように書く
  note には、その段について**渡された実測値がある場合だけ**その数字を書く。無ければ空文字
- candidates はちょうど3件。**この事業で本当に主指標になりうるもの**を選ぶ
  「PV数」「直帰率」のような、事業の成果と距離があるものは選ばない
- **3件とも「実測できます」か「連携が必要です」のものにする。**
  追えない指標を候補に出しても、翌月から報告できないので選べない。
  事業として重要でも、このツールで追えないものは候補から外し、
  代わりに「その指標に効く、追える指標」を選ぶ
  （例：来店数が追えないなら、電話タップ数や予約フォーム到達数）
  node には branches で使った node の語を**そのまま**入れる。
  「〜の分子」「〜の構成要素」のような説明句にしない
- trackable は3つのいずれか。判断基準は下のとおり
  「実測できます」…すでに連携済み、またはサイトから測れる
  「連携が必要です」…Search Console / Google Analytics 4 を繋げば測れる
  「追えません」…外部の管理画面や社内データが要り、このツールでは取得できない
- how は、追う方法（何を繋ぐか）か、追えない理由を1文で。曖昧にしない
- 効果や結果を断定しない`,
    `商材: ${d.product}
ターゲット: ${d.audience}
業種: ${d.industry}
強み: ${d.strengths.join(" / ")}

【実測できている事実】
${pricing?.main ? `主力商材の価格: ${pricing.main.name} ${pricing.main.yen.toLocaleString()}円（サイト掲載）` : "価格: サイトから取得できず"}
申し込みの受け口: ${cv.length ? cv.map((c) => `${c.kind}（${c.detail}）${c.measurable ? "計測可" : "計測不可"}`).join(" / ") : "検出できず"}
${measurable.length === 0 ? "※ 広告のコンバージョンとして計測できる受け口がありません" : ""}
検出した広告タグ: ${site?.adTags.join("・") || "なし"}
${meo?.self ? `Googleマップ: 評価${meo.self.rating} レビュー${meo.self.reviews}件（近隣${meo.totalShops}店中${meo.reviewRank}位）` : "Googleマップ: 未特定"}
${gsc?.queries?.length ? `Search Console: 連携済み（直近28日 表示${gsc.totals.impressions} クリック${gsc.totals.clicks}）` : "Search Console: 未連携"}
${ga4?.sessions ? `GA4: 連携済み（セッション${ga4.sessions}）` : "GA4: 未連携"}

出力:
{"model":"",
 "branches":[{"node":"","formula":"","note":""}],
 "candidates":[{"id":"k1","name":"","node":"","why":"","trackable":"","how":""}]}`,
    { maxTokens: 3000 }
  );
  return { ...res, candidates: preferTrackable(res.candidates ?? []) };
}

/**
 * 追えない候補が混ざったら、追えるものだけ残す。
 * 全部追えない場合だけ、そのまま出す（何も出さないより、追えないと明示するほうがよい）。
 */
function preferTrackable(list: KpiCandidate[]): KpiCandidate[] {
  const ok = list.filter((c) => c.trackable !== "追えません");
  return ok.length > 0 ? ok : list;
}
