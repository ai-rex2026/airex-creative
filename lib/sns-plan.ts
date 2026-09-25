import { askJson } from "./anthropic";
import { checkGuardDict } from "./guardrail";
import type { Diagnosis, GuardHit } from "./types";
import { socialFacts, type SocialScan } from "./social";

/**
 * SNSオーガニック運用とSNSキャンペーン企画（AI-REX 本体 ch2_sns_organic / ch6_pr.sns_campaign_* の移植）。
 *
 * 「広告以外の施策」の各SNSの下に、媒体ごとの運用プランを出す。
 * 運用中のアカウントが実測できている媒体は、新規開設ではなく今の数字を動かす前提で書かせる。
 * 生成した文面（テーマ・ハッシュタグ・企画）は、生成と同時に法令チェック（辞書）を通す。
 */

export type SnsChannelPlan = {
  /** Instagram / TikTok / X / YouTube */
  platform: string;
  /** 運用中（実測あり）か、これから始めるか */
  status: "運用中" | "新規";
  goals: string[];
  themes: string[];
  frequency: string;
  hashtags: string;
  engagement: string[];
  kpi: string;
  flags: GuardHit[];
};

export type SnsCampaign = {
  title: string;
  concept: string;
  /** 参加の仕組み（何をすると参加になるか） */
  mechanics: string[];
  /** 使う媒体 */
  platforms: string[];
  /** 期間の目安 */
  period: string;
  /** キャンペーン画像を作るための画像生成AIへの指示（英語。文字は入れない） */
  imagePrompt: string;
  /** 景品表示法など、実施前に確認すること */
  cautions: string[];
  flags: GuardHit[];
};

export type SnsPlan = {
  channels: SnsChannelPlan[];
  campaign: SnsCampaign | null;
  /** 生成に失敗したときの理由 */
  error?: string;
};

export const SNS_PLATFORMS = ["Instagram", "TikTok", "X", "YouTube"] as const;

/** 施策の見出し（「SNSオーガニック運用（Instagram）」など）から媒体を引き当てる */
export function snsPlatformsIn(text: string): string[] {
  const out: string[] = [];
  if (/instagram|インスタ/i.test(text)) out.push("Instagram");
  if (/tiktok|ティックトック/i.test(text)) out.push("TikTok");
  if (/(^|[^A-Za-z])X([^A-Za-z]|$)|twitter|ツイッター/i.test(text)) out.push("X");
  if (/youtube|ユーチューブ/i.test(text)) out.push("YouTube");
  return out;
}

export async function generateSnsPlan(d: Diagnosis, social: SocialScan | null): Promise<SnsPlan> {
  const sns = socialFacts(social);
  const res = await askJson<{
    channels: Omit<SnsChannelPlan, "flags">[];
    campaign: Omit<SnsCampaign, "flags"> | null;
  }>(
    `あなたはSNS運用の実務者です。広告費をかけずに育てるSNSの運用プランと、SNSキャンペーンの企画を作ります。

channels は Instagram / TikTok / X / YouTube のうち、**この商材とターゲットに効く媒体だけ**を2〜4件。
効かない媒体は入れない（ターゲットの年齢層・検討期間・商材の見せ方で判断する）。

守ること（channels）:
- status は、下の【運用中の公式SNS】に実測がある媒体は「運用中」、無い媒体は「新規」
- 運用中の媒体は新規開設の話を書かず、今のフォロワー数・投稿数を動かす前提で書く
- goals は2〜3件。数えられる形で書く（例：「保存数を投稿あたり30件にする」）。根拠のない大きな数字を置かない
- themes は4〜6件。**この商材の事実（強み・価格・実績・よくある不安）を使った具体的な投稿ネタ**にする
  悪い例：「商品紹介」 良い例：「施術前のカウンセリングで実際に聞かれる質問トップ5に答えるリール」
- frequency は「週3本（リール2・カルーセル1）」のように媒体の形式まで書く
- hashtags は運用の考え方と、実際に付けるタグの例（5〜10個）を1段落で。X はハッシュタグの付けすぎを避ける前提で書く
- engagement は3〜4件。コメント返信・保存を促す締め方・ストーリーズの質問箱など、その媒体の機能名で書く
- kpi は1つ。数えられるもの

守ること（campaign）:
- この商材で**実施できる**SNSキャンペーンを1件。実施できないなら null
- concept は企画の狙いと中身を3〜4文で。mechanics は参加の仕組みを3〜4手順で（フォロー＆投稿、UGC募集など）
- platforms は channels で選んだ媒体から。period は「2週間」など
- imagePrompt は**英語**で、キャンペーンのキービジュアルを作るための画像生成AIへの指示。
  **画像の中に文字・ロゴ・数字を入れさせない**（日本語の文字は画像生成で崩れるため。文字は後から載せる）。
  被写体・構図・光・色味・雰囲気を具体的に書く
- cautions は2〜3件。景品表示法（懸賞の景品上限）、各SNSのキャンペーン規約、業種の広告規制など、実施前に確認すること

共通:
- 「必ず」「No.1」「最高」など根拠の要る断定・最上級は使わない。効果を断定しない
- 医療・美容など規制のある業種では、ビフォーアフター写真や体験談の扱いに触れる`,
    `商材: ${d.product}
ターゲット: ${d.audience}
業種: ${d.industry}
強み: ${d.strengths.join(" / ")}
買わない理由: ${d.objections.join(" / ")}
訴求軸: ${d.angles.map((a) => a.name).join(" / ")}
${sns ? `\n【運用中の公式SNS】※実測\n${sns}` : "\n【運用中の公式SNS】サイトから辿れるアカウントは見つかっていません"}

出力:
{"channels":[{"platform":"Instagram","status":"新規","goals":[""],"themes":[""],"frequency":"","hashtags":"","engagement":[""],"kpi":""}],
 "campaign":{"title":"","concept":"","mechanics":[""],"platforms":[""],"period":"","imagePrompt":"","cautions":[""]}}`,
    { maxTokens: 5000, timeoutMs: 120_000 }
  );

  const channels: SnsChannelPlan[] = (res.channels ?? [])
    .filter((c) => c && c.platform)
    .slice(0, 4)
    .map((c) => ({
      platform: c.platform,
      status: c.status === "運用中" ? "運用中" : "新規",
      goals: c.goals ?? [],
      themes: c.themes ?? [],
      frequency: c.frequency ?? "",
      hashtags: c.hashtags ?? "",
      engagement: c.engagement ?? [],
      kpi: c.kpi ?? "",
      // 投稿ネタ・ハッシュタグはそのまま外に出る文面なので、生成と同時に辞書で見る
      flags: checkGuardDict([...(c.themes ?? []), c.hashtags ?? "", ...(c.goals ?? [])], d.industry),
    }));

  const c = res.campaign;
  const campaign: SnsCampaign | null =
    c && c.title && c.concept
      ? {
          title: c.title,
          concept: c.concept,
          mechanics: c.mechanics ?? [],
          platforms: c.platforms ?? [],
          period: c.period ?? "",
          imagePrompt: c.imagePrompt ?? "",
          cautions: c.cautions ?? [],
          flags: checkGuardDict([c.title, c.concept, ...(c.mechanics ?? [])], d.industry),
        }
      : null;

  return { channels, campaign };
}
