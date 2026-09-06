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

/** どの原稿がどの指摘に当たったか。原稿の横に理由と言い換え案を出すために持つ */
export type FlaggedText = { text: string; law: string; reason: string; suggestion: string };

export type AdOps = {
  /** 設計し終えたか。媒体ごとに1回ずつ生成するので、途中の状態がありうる */
  done: boolean;
  campaigns: Campaign[];
  tags: MeasureTag[];
  /** 上限を超えた原稿。入稿前に直す必要がある */
  overLength: { campaign: string; group: string; kind: "見出し" | "説明文"; text: string; width: number; limit: number }[];
  guard: GuardVerdict;
  flagged: FlaggedText[];
};

/**
 * 計測タグの診断。実測のみで作る。
 * GTM 経由で入れているサイトは HTML を見ても分からないので「未導入」と断定しない。
 */
export function diagnoseTags(site: SiteScan | null, plan: MediaPlanItem[]): MeasureTag[] {
  if (!site) return [];
  const has = (name: string) => site.adTags.includes(name) || site.tech.includes(name);
  // GTM のコンテナまで読めていれば「無い」と断定してよい。読めていないときだけ要確認にする
  const gtm = site.tech.includes("Google Tag Manager") && !site.gtmRead;
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
    if (r.detected) return { name: r.name, status: "導入済み", need: r.need, note: site.gtmRead ? "サイトまたはGTMコンテナの中で検出しました。" : "サイトのHTMLで検出しました。" };
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

  if (site.tech.includes("Google Tag Manager")) {
    tags.unshift({
      name: "Google タグマネージャー",
      status: "導入済み",
      need: "推奨",
      note: site.gtmRead
        ? `コンテナ ${site.gtmId} の中身まで確認しました。以降の判定はコンテナの中身を含めています。`
        : "検出しましたが、コンテナの中身を取得できませんでした。以降のタグは中身をご確認ください。",
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

/** 予算配分の多い順に、設計対象の媒体を最大3つ選ぶ */
export function opsTargets(plan: MediaPlanItem[]) {
  return [...plan].sort((a, b) => b.share - a.share).slice(0, 3);
}

/**
 * 媒体1つ分のキャンペーンを設計する。
 * 全媒体を1回で生成すると1リクエストの実行時間に収まらず、
 * 途中で切られて何も保存されないまま再試行を繰り返すため、媒体ごとに分けている。
 */
export async function generateCampaign(
  d: Diagnosis,
  site: SiteScan | null,
  item: MediaPlanItem
): Promise<Campaign> {
  const search = /検索|Google|Yahoo/i.test(item.channel) && !/P-?MAX|YouTube|ディスプレイ/i.test(item.channel);

  return askJson<Campaign>(
    `あなたは広告運用者です。指定された媒体1つ分のキャンペーンを、管理画面にそのまま入稿できる粒度で設計します。

守ること:
- groups は${search ? "2〜3個" : "1〜2個"}
- keywords は${search ? "10〜15件" : "空配列にする（この媒体はキーワードで買う面ではない）"}
- negatives は${search ? "「無料」「求人」「自分で」など、その商材で実際に無駄打ちになる語を5〜8件" : "空配列にする"}
- headlines は12件。**日本語15文字以内**（16文字以上は入稿できません）。書いたあと必ず数え直すこと
- descriptions は4件。**日本語45文字以内**（46文字以上は入稿できません）。1文にまとめず短く切ること
- 見出しは訴求を1つだけ入れる。1本に詰め込まない
- settings は管理画面の設定項目名と値の対を6〜10件。**その媒体に実在する項目だけ**を書く
- notes は「外し忘れると費用が漏れる設定」を2〜3件。一般論ではなく設定名で書く
- targeting は誰にどこで出すかを1〜2文で
- 効果を断定する表現・最上級表現は書かない（別で法令チェックにかけます）`,
    `商材: ${d.product}
ターゲット: ${d.audience}
業種: ${d.industry}
強み: ${d.strengths.join(" / ")}
買わない理由: ${d.objections.join(" / ")}
訴求軸: ${d.angles.map((a) => a.name).join(" / ")}
${site ? `サイト: ${site.title}` : ""}

設計する媒体: ${item.channel}（配分${item.share}%・${item.priority}）
選定理由: ${item.reason}

出力:
{"name":"","channel":"${item.channel}","bidStrategy":"",
 "settings":[{"label":"","value":""}],
 "groups":[{"name":"","targeting":"","keywords":[""],"negatives":[""],
            "headlines":[""],"descriptions":[""]}],
 "notes":[""]}`,
    { maxTokens: 6000 }
  );
}

/** 全媒体を設計し終えたあとの仕上げ。文字数を数え、原稿をガードレールに通す */

/**
 * 文字数超過の原稿を書き直させる。
 * 生成AIは自分が書いた文字数を数えられないので、指示だけでは守られない。
 * こちらで数えて、超えたものだけを長さを明示して直させ、直っていなければ採用しない。
 */
async function repairLengths(campaigns: Campaign[]): Promise<Campaign[]> {
  type Slot = { ci: number; gi: number; kind: "headlines" | "descriptions"; i: number; limit: number };
  const slots: Slot[] = [];
  const items: { n: number; text: string; limit: number; now: number }[] = [];

  campaigns.forEach((c, ci) =>
    (c.groups ?? []).forEach((g, gi) => {
      for (const [kind, limit] of [["headlines", 30], ["descriptions", 90]] as const) {
        (g[kind] ?? []).forEach((t, i) => {
          const w = adWidth(t);
          if (w > limit) {
            items.push({ n: slots.length, text: t, limit: limit / 2, now: Math.ceil(w / 2) });
            slots.push({ ci, gi, kind, i, limit });
          }
        });
      }
    })
  );
  if (items.length === 0) return campaigns;

  let fixed: { n: number; text: string }[] = [];
  try {
    const res = await askJson<{ items: { n: number; text: string }[] }>(
      `広告原稿が入稿上限を超えています。意味を保ったまま短く書き直してください。

守ること:
- 各項目の limit は**全角の文字数**。その文字数以内に必ず収める
- 削るときは修飾語・地名・保証などの補足から落とし、訴求の核は残す
- 効果を断定する表現・最上級表現は足さない
- n は変えずにそのまま返す`,
      JSON.stringify({ items }) + '\n\n出力: {"items":[{"n":0,"text":""}]}',
      { maxTokens: 4000 }
    );
    fixed = res.items ?? [];
  } catch {
    // 直せなくても元の原稿は残す。超過は overLength で画面に出る
    return campaigns;
  }

  const out = structuredClone(campaigns);
  for (const f of fixed) {
    const slot = slots[f.n];
    // 短くなっていなければ採用しない。直った体で上限超えを通すほうが害が大きい
    if (!slot || typeof f.text !== "string" || adWidth(f.text) > slot.limit) continue;
    const arr = out[slot.ci]?.groups?.[slot.gi]?.[slot.kind];
    if (arr) arr[slot.i] = f.text;
  }
  return out;
}

export async function finishAdOps(
  campaigns: Campaign[],
  site: SiteScan | null,
  plan: MediaPlanItem[],
  industry: Diagnosis["industry"]
): Promise<AdOps> {
  const repaired = await repairLengths(campaigns);

  // 生成した原稿は全部ガードレールに通す。ここを素通りさせると入稿事故になる
  const texts = repaired.flatMap((c) => (c.groups ?? []).flatMap((g) => [...(g.headlines ?? []), ...(g.descriptions ?? [])]));
  const guard = await checkGuard(texts, industry);
  // 指摘語を含む原稿を特定して紐付ける。まとめて件数だけ出しても直せない
  const flagged: FlaggedText[] = [];
  for (const t of new Set(texts)) {
    for (const h of guard.hits) {
      if (h.severity !== "low" && t.includes(h.text)) {
        flagged.push({ text: t, law: h.law, reason: h.reason, suggestion: h.suggestion });
        break;
      }
    }
  }

  return {
    done: true,
    campaigns: repaired,
    tags: diagnoseTags(site, plan),
    overLength: findOverLength(repaired),
    guard,
    flagged,
  };
}
