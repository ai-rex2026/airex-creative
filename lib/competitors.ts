import Anthropic from "@anthropic-ai/sdk";
import type { Diagnosis } from "./types";

/**
 * 競合サイト比較。
 * 「類似度◯%」のような作った数字は出さない。実際に検索して上位に出ていたサイトだけを、
 * どの語で何位だったかとセットで返す。測っていないもの（訪問数など）は持たない。
 */
export type Competitor = {
  keyword: string;
  rank: number;
  name: string;
  url: string;
  /** どんな訴求で上位に来ているか */
  note: string;
};

export type CompetitorScan = {
  keywords: string[];
  items: Competitor[];
  searchedAt: string;
};

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

export async function findCompetitors(d: Diagnosis, ownUrl: string | null): Promise<CompetitorScan> {
  const own = ownUrl ? new URL(ownUrl).host.replace(/^www\./, "") : "";
  const prompt = `あなたは広告運用のリサーチャーです。次の商材について、見込み客が実際に使う検索語を2つ決め、
Web検索でその語の上位に出ているサイトを調べてください。

商材: ${d.product}
ターゲット: ${d.audience}
${own ? `自社サイト: ${own}（これは競合に含めない）` : ""}

守ること:
- **実際に検索結果に出ていたサイトだけ**を挙げる。知識から思い出したサイトを混ぜない
- rank は検索結果で見えた順位。分からなければその行を出さない
- note は「どんな訴求で上位に来ているか」を20〜40字で
- 広告（スポンサー）ではなく通常の検索結果を対象にする
- 合計6件まで

最後に STRICT JSON のみを出力（前置き・コードフェンス不要）:
{"keywords":["",""],"items":[{"keyword":"","rank":1,"name":"","url":"https://...","note":""}]}`;

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 3000,
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
  let parsed: { keywords?: string[]; items?: Competitor[] } = {};
  try {
    parsed = m ? JSON.parse(m[0]) : {};
  } catch {
    parsed = {};
  }

  const items = (parsed.items ?? [])
    .filter((x) => x?.url && x?.name && typeof x.rank === "number")
    .filter((x) => !own || !x.url.includes(own))
    .slice(0, 6);

  return { keywords: parsed.keywords ?? [], items, searchedAt: new Date().toISOString() };
}
