import Anthropic from "@anthropic-ai/sdk";
import type { Diagnosis } from "./types";
import { readSocialAccount, type SocialAccount } from "./social";

/**
 * SNS競合の実測。
 *
 * findCompetitors（サイトの競合）と同じ考え方で、YouTube・Xに絞って同業のアカウントを
 * Web検索で探す。ただしフォロワー数などの数字はAIの知識やスナップショットの記憶に
 * 頼らせない。見つけたアカウントのURLだけをAIに特定させ、数字は readSocialAccount で
 * 実際に測り直す（自社アカウントの実測と同じ経路・同じ「取れなかったら書かない」原則）。
 */

export type CompetitorSocial = {
  platform: "YouTube" | "X";
  account: SocialAccount;
};

export type SocialCompetitorScan = {
  items: CompetitorSocial[];
  searchedAt: string;
};

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

export async function findSocialCompetitors(
  d: Diagnosis,
  ownUrl: string | null,
  platforms: ("YouTube" | "X")[]
): Promise<SocialCompetitorScan> {
  if (platforms.length === 0) return { items: [], searchedAt: new Date().toISOString() };

  let own = "";
  try {
    own = ownUrl ? new URL(ownUrl).host.replace(/^www\./, "") : "";
  } catch {
    own = "";
  }

  const prompt = `あなたは広告運用のリサーチャーです。次の商材と同業で、${platforms.join("・")}を
実際に運用しているアカウントをWeb検索で探してください。

商材: ${d.product}
ターゲット: ${d.audience}
業種: ${d.industry}
${own ? `自社サイト: ${own}（この運営元のアカウントは競合に含めない）` : ""}

守ること:
- **実際に検索で見つかった、実在するアカウントのURL**だけを挙げる。知識から思い出したアカウントを書かない
- フォロワー数・登録者数・再生回数などの数字はここでは書かない（後で別途実測するため不要）。
  アカウントの所在（URL）を特定することだけに集中する
- 媒体ごとに最大2件。同じ商圏・客層を狙っている競合に絞り、業種が明らかに異なるアカウントは含めない
- 対象媒体は ${platforms.join("・")} のみ

最後に STRICT JSON のみを出力（前置き・コードフェンス不要）:
{"items":[{"platform":"YouTube","url":"https://www.youtube.com/@..."},{"platform":"X","url":"https://x.com/..."}]}`;

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    tools: [
      {
        type: "web_search_20250305",
        name: "web_search",
        max_uses: 3,
        user_location: { type: "approximate", country: "JP", city: "Tokyo", timezone: "Asia/Tokyo" },
      },
    ],
    messages: [{ role: "user", content: prompt }],
  });

  const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
  const m = text.match(/\{[\s\S]*\}/);
  let parsed: { items?: { platform?: string; url?: string }[] } = {};
  try {
    parsed = m ? JSON.parse(m[0]) : {};
  } catch {
    parsed = {};
  }

  const candidates = (parsed.items ?? [])
    .filter((x): x is { platform: string; url: string } => !!x.url && !!x.platform)
    .filter((x) => (platforms as string[]).includes(x.platform))
    .filter((x) => !own || !x.url.includes(own))
    .slice(0, platforms.length * 2);

  // 見つけたのはURLだけ。数字はAIに書かせず、自社アカウントと同じ経路で測り直す
  const accounts = await Promise.all(
    candidates.map(async (c) => {
      const handle = c.url.match(/(?:@|\/)([\w.\-]+)\/?$/)?.[1] ?? "";
      const account = await readSocialAccount({ platform: c.platform, url: c.url, handle });
      return { platform: c.platform as "YouTube" | "X", account };
    })
  );

  // 実測できなかった（＝フォロワー数などが取れなかった）候補は、比較材料にならないので落とす
  return { items: accounts.filter((x) => x.account.readable), searchedAt: new Date().toISOString() };
}
