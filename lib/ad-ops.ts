import { askJson } from "./anthropic";
import { checkGuard } from "./guardrail";
import type { Diagnosis, GuardVerdict, MediaPlanItem } from "./types";
import type { SiteScan } from "./site-scan";

/**
 * 広告運用設計。キャンペーン構造・キーワード・RSA原稿・計測タグ診断まで、
 * 管理画面にそのまま入稿できる粒度で出す。
 *
 * 計測タグの導入状況は AI に聞かず site-scan の実測から組み立てる。
 * ただし GTM が入っているサイトはタグを実行時に差し込むため、HTML に無い＝未導入とは言い切れない。
 */

/** Google/Yahoo! の文字数は半角1・全角2で数える。見出し30・説明文90が上限 */
const FULL_WIDTH = /[^ -~｡-ﾟ]/;
export function adWidth(s: string) {
  return [...s].reduce((n, c) => n + (FULL_WIDTH.test(c) ? 2 : 1), 0);
}

export type AdGroup = {
  name: string;
  /** 誰に・どこで出すか */
  targeting: string;
  keywords: string[];
  negatives: string[];
  headlines: string[];
  descriptions: string[];
};

export type Campaign = {
  name: string;
  channel: string;
  bidStrategy: string;
  /** 管理画面の設定項目そのまま。ラベルと値の対で持つ */
  settings: { label: string; value: string }[];
  groups: AdGroup[];
  /** 取りこぼしがちな設定。チェックボックスの外し忘れ等 */
  notes: string[];
};

export type TagStatus = "導入済み" | "未導入" | "要確認";

export type MeasureTag = {
  name: string;
  status: TagStatus;
  need: "必須" | "推奨";
  /** 導入済み・要確認の根拠、または未導入時の設置手順 */
  note: string;
};

export type AdOps = {
  campaigns: Campaign[];
  tags: MeasureTag[];
  /** 上限を超えた原稿。入稿前に直す必要がある */
  overLength: { campaign: string; group: string; kind: "見出し" | "説明文"; text: string; width: number; limit: number }[];
  guard: GuardVerdict;
};

/**
 * 計測タグの診断。実測のみで作る。
 * GTM 経由で入れているサイトは HTML を見ても分からないので「未導入」と断定しない。
 */
export function diagnoseTags(site: SiteScan | null, plan: MediaPlanItem[]): MeasureTag[] {
  if (!site) return [];
  const has = (name: string) => site.adTags.includes(name) || site.tech.includes(name);
  const gtm = site.tech.includes("Google Tag Manager");
  const ch = plan.map((p) => p.channel).join(" ");

  // 予算を割り当てた媒体のタグだけを必須にする。使わない媒体のタグは推奨止まり
  const used = (re: RegExp) => re.test(ch);

  const rows: { name: string; detected: boolean; need: "必須" | "推奨"; howTo: string }[] = [
    {
      name: "Google Analytics 4",
      detected: has("Google Analytics 4"),
      need: "必須",
      howTo: "GA4 管理画面 → [データストリーム] → ウェブストリームを作成し、測定IDを GTM または <head> に設置してください。",
    },
    {
      name: "Google 広告 コンバージョンタグ",
      detected: has("Google 広告"),
      need: used(/Google|検索|P-?MAX|YouTube/i) ? "必須" : "推奨",
      howTo: "Google 広告 → [目標] → [コンバージョン] でタグを取得し、GTM か <head> に設置。問い合わせ完了などのコンバージョンアクションも作成してください。",
    },
    {
      name: "Meta Pixel",
      detected: has("Meta Pixel"),
      need: used(/Meta|Instagram|Facebook/i) ? "必須" : "推奨",
      howTo: "Meta イベントマネージャ → [データソースを接続] → ウェブ でピクセルを作成し、Lead / Schedule の標準イベントを設定してください。",
    },
    {
      name: "Yahoo! タグ",
      detected: has("Yahoo! タグ"),
      need: used(/Yahoo/i) ? "必須" : "推奨",
      howTo: "Yahoo!広告 → [ツール] → [サイトジェネラルタグ] を取得し、全ページに設置してください。",
    },
    {
      name: "TikTok Pixel",
      detected: has("TikTok Pixel"),
      need: used(/TikTok/i) ? "必須" : "推奨",
      howTo: "TikTok Business Center → [ピクセル管理] → [ピクセルを作成]。ViewContent・Contact イベントを設定してください。",
    },
    {
      name: "LINE Tag",
      detected: has("LINE Tag"),
      need: used(/LINE/i) ? "必須" : "推奨",
      howTo: "LINE Ads → [タグ管理] → [LINE Tag を発行] し、全ページの <head> に設置してください。",
    },
  ];

  const tags: MeasureTag[] = rows.map((r) => {
    if (r.detected) return { name: r.name, status: "導入済み", need: r.need, note: "サイトのHTMLで検出しました。" };
    // GTM は実行時にタグを差し込むため、HTML の静的な確認では未導入と言い切れない
    if (gtm)
      return {
        name: r.name,
        status: "要確認",
        need: r.need,
        note: `HTMLからは検出できませんでしたが、このサイトは Google タグマネージャーを使っています。GTM 経由で設置されている可能性があるため、GTM の管理画面でご確認ください。未設置の場合は次の手順です。${r.howTo}`,
      };
    return { name: r.name, status: "未導入", need: r.need, note: r.howTo };
  });

  if (gtm) {
    tags.unshift({
      name: "Google タグマネージャー",
      status: "導入済み",
      need: "推奨",
      note: "サイトのHTMLで検出しました。以降のタグはGTMから一元管理できます。",
    });
  }
  return tags;
}

/** 上限超えの原稿を洗い出す。AIの自己申告ではなく実際に数える */
function findOverLength(campaigns: Campaign[]) {
  const out: AdOps["overLength"] = [];
  for (const c of campaigns) {
    for (const g of c.groups ?? []) {
      for (const t of g.headlines ?? []) {
        const w = adWidth(t);
        if (w > 30) out.push({ campaign: c.name, group: g.name, kind: "見出し", text: t, width: w, limit: 30 });
      }
      for (const t of g.descriptions ?? []) {
        const w = adWidth(t);
        if (w > 90) out.push({ campaign: c.name, group: g.name, kind: "説明文", text: t, width: w, limit: 90 });
      }
    }
  }
  return out;
}

export async function generateAdOps(
  d: Diagnosis,
  site: SiteScan | null,
  plan: MediaPlanItem[]
): Promise<AdOps> {
  // 予算を多く積む上位3媒体だけ設計する。全媒体書くと薄くなるし生成コストも跳ねる
  const top = [...plan].sort((a, b) => b.share - a.share).slice(0, 3);

  const res = await askJson<{ campaigns: Campaign[] }>(
    `あなたは広告運用者です。管理画面にそのまま入稿できる粒度でキャンペーンを設計します。

守ること:
- campaigns は渡された媒体ごとに1つ。groups は検索系なら2〜4個、SNS・動画系なら1〜2個
- keywords は検索系のみ10〜15件。SNS・動画・P-MAX の campaign では空配列にする
- negatives は「無料」「求人」「自分で」など、その商材で実際に無駄打ちになる語を5〜10件
- headlines は15件。**全角15文字（半角30文字）以内**。文字数を必ず自分で数えること
- descriptions は4件。**全角45文字（半角90文字）以内**
- 見出しは「訴求を1つだけ」入れる。1本に詰め込まない
- settings は管理画面の設定項目名と値の対。配信地域・年齢・性別・マッチタイプ方針・
  CV済みユーザー除外・検索パートナー配信・ディスプレイネットワーク配信・配信スケジュールなど、
  **その媒体に実在する項目だけ**を6〜10件
- notes は「外し忘れると費用が漏れる設定」を2〜4件。一般論ではなく設定名で書く
- targeting は誰にどこで出すかを1〜2文で
- 効果を断定する表現・最上級表現は書かない（別で法令チェックにかけます）`,
    `商材: ${d.product}
ターゲット: ${d.audience}
業種: ${d.industry}
強み: ${d.strengths.join(" / ")}
買わない理由: ${d.objections.join(" / ")}
訴求軸: ${d.angles.map((a) => a.name).join(" / ")}
${site ? `サイト: ${site.title}` : ""}

設計する媒体（予算配分順）:
${top.map((p) => `- ${p.channel}（配分${p.share}%・${p.priority}）: ${p.reason}`).join("\n")}

出力:
{"campaigns":[{"name":"","channel":"","bidStrategy":"",
 "settings":[{"label":"","value":""}],
 "groups":[{"name":"","targeting":"","keywords":[""],"negatives":[""],
            "headlines":[""],"descriptions":[""]}],
 "notes":[""]}]}`,
    { maxTokens: 12000 }
  );

  const campaigns = res.campaigns ?? [];

  // 生成した原稿は全部ガードレールに通す。ここを素通りさせると入稿事故になる
  const texts = campaigns.flatMap((c) => (c.groups ?? []).flatMap((g) => [...(g.headlines ?? []), ...(g.descriptions ?? [])]));
  const guard = await checkGuard(texts, d.industry);

  return { campaigns, tags: diagnoseTags(site, plan), overLength: findOverLength(campaigns), guard };
}
