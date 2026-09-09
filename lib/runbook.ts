import { askJson } from "./anthropic";
import { checkGuardDict } from "./guardrail";
import { platformNotes } from "./ad-platforms";
import { casePhotoRules, isCasePhoto } from "./case-photo";
import type { Diagnosis, GuardHit } from "./types";
import type { SiteScan } from "./site-scan";
import type { PriceScan } from "./pricing";
import type { MeoScan } from "./meo";
import type { Measure } from "./measures";

/**
 * 施策を実行するためのプロンプト。AI に貼ればそのまま作業が進む形で出す。
 *
 * 貼り先で性質が違うので分ける。コードや文章は貼れば完了するが、広告管理画面の
 * 操作は AI に貼っただけでは終わらない。そこを曖昧にすると「貼ったのに何も
 * 起きない」になる。
 *
 * 生成したプロンプトの中に**法令と文字数の制約を書き込む**。貼り先の AI は
 * こちらのガードレールを通らないので、制約を同梱しないと未検査の文言が生まれる。
 */

export type RunbookKind = "貼れば完了" | "成果物を作る" | "管理画面での操作";

export type Runbook = {
  kind: RunbookKind;
  /** そのまま貼れる本文 */
  prompt: string;
  /** 実行に必要な権限やアカウント */
  requires: string[];
  /** 貼っただけでは終わらないこと。無ければ null */
  limits: string | null;
  /** プロンプトに混ざった法令上の注意語 */
  flags?: GuardHit[];
  madeAt: string;
};

export async function generateRunbook(
  d: Diagnosis,
  site: SiteScan | null,
  measure: Measure,
  pricing: PriceScan | null,
  meo: MeoScan | null
): Promise<Runbook> {
  // 症例写真は要件が細かく、外すと違反物ができあがる。該当する施策のときだけ丸ごと渡す
  const caseRules = isCasePhoto(`${measure.title} ${measure.impactWhy} ${(measure.steps ?? []).join(" ")}`)
    ? `\n\n${casePhotoRules()}\n\nこの施策は症例写真に関わる。上の要件を prompt の中に必ず書き写し、\n写真そのものを生成させる指示は書かない。`
    : "";

  const res = await askJson<Omit<Runbook, "flags" | "madeAt">>(
    `あなたは、AI に貼り付けて作業させるためのプロンプトを書く人です。
渡された施策1件について、**そのまま AI に貼れば作業が進む**プロンプトを作ります。

kind の決め方:
- 「貼れば完了」…文章そのものが成果物（メール文面・投稿文・返信テンプレなど）
- 「成果物を作る」…コードやファイルが成果物（JSON-LD・HTML・CSV・設定ファイルなど）
- 「管理画面での操作」…広告やGBPの管理画面を人が触る必要があるもの

prompt の書き方:
- **前置きを書かない。** 貼った瞬間に作業が始まる命令文にする
- 対象サイトのURLと、渡された実測値を**プロンプトの中に埋め込む**。
  貼り先の AI が調べ直さなくて済むようにする
- 何を作るか、どこに置くか、完了の判断を書く
- **制約を必ず書き込む**。この商材は「${d.industry}」なので、
  景表法・薬機法・医療広告ガイドラインで問題になる表現（効果の断定、
  最上級、体験談の扱い）を避けるよう、プロンプトの中で指示する
- 広告見出しを書かせる場合は「日本語15文字以内」「説明文は45文字以内」を明記する
- kind が「管理画面での操作」のときは、AI にやらせるのではなく
  **手順を人が追える形**で書く。加えて、可能なら一括入稿用のファイル
  （Google広告エディタ用CSVなど）を作らせる指示にする
- 300〜700文字。長い前置きや説明で埋めない

requires は、実行に要るアカウントや権限を2〜4件。
limits は「貼っただけでは終わらないこと」。無ければ null。
**ブラウザを操作して管理画面にログインする作業は AI にはできない**ので、
そこが要る施策では limits に必ず書く。${caseRules}`,
    `対象サイト: ${site?.finalUrl ?? "（URLなし）"}
商材: ${d.product}
業種: ${d.industry}
強み: ${d.strengths.join(" / ")}

【実行する施策】
${measure.title}
担当: ${measure.owner}
根拠: ${measure.impactWhy}
手順の下書き: ${(measure.steps ?? []).join(" → ")}
完了の判断: ${measure.done}

【使える実測値】
${pricing?.main ? `主力商材: ${pricing.main.name} ${pricing.main.yen.toLocaleString()}円` : ""}
${site ? `構造化データ: ${site.structuredData ? "有" : "無"} / 検出した広告タグ: ${site.adTags.join("・") || "なし"}` : ""}
${site?.conversions?.length ? `申し込みの受け口: ${site.conversions.map((c) => `${c.kind}${c.measurable ? "（計測可）" : "（計測不可）"}`).join(" / ")}` : ""}
${meo?.self ? `Googleマップ: 評価${meo.self.rating} レビュー${meo.self.reviews}件（近隣${meo.totalShops}店中${meo.reviewRank}位）` : ""}

【媒体の事実】※ 自分の知識より優先する
${platformNotes()}

出力: {"kind":"","prompt":"","requires":[""],"limits":null}`,
    { maxTokens: 2500 }
  );

  // プロンプトに法令上の注意語が混ざっていないか、辞書だけで確認する（無料）
  const flags = checkGuardDict([res.prompt ?? ""], d.industry);

  return {
    kind: res.kind ?? "成果物を作る",
    prompt: res.prompt ?? "",
    requires: res.requires ?? [],
    limits: res.limits ?? null,
    flags: flags.length ? flags : undefined,
    madeAt: new Date().toISOString(),
  };
}
