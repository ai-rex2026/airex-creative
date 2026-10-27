import { askJson } from "../anthropic";
import { normalizeJapanese } from "../meo-ops/japanese";
import { bodyChars } from "./md";

/**
 * note 記事の推敲（AIっぽさを消す。2026-10-27）。下書きを書いたあと、同じ記事に次の8工程を順にかける。
 * ①AIが書いたとバレる箇所を洗い出して話し言葉に ②同じ語尾が3回以上続く所を崩す ③まとめすぎを崩す（結論は言い切り、説明を1つ削る）
 * ④「いかがでしたか」系の締めと本題前の前置きを削る ⑤段落ごとに体験した人しか言えない一言（金額・失敗・その時の感情）
 * ⑥一文25〜30字を基準に短い文を混ぜる ⑦専門語を0.2秒で分かる日常語に ⑧初見の読者として「買わない理由」を3つ挙げてから直す
 *
 * 事実の創作はしない：⑤の金額・件数・失敗の出来事は、与えられた事実（事業者の説明・書き手の指示・下書き）にあるものだけ。
 * 無いときは【要記入：…】を置き、人が投稿前に自分の体験で埋める（note は人が貼って投稿するので、そこで直す）
 */

export const FILL_MARK = "【要記入";

const SYSTEM = `あなたは日本語の note 記事を、人が書いた読み物に仕上げる編集者です。与えられた下書きに、次の8工程を**この順に**かけて書き直します。

① バレ箇所の洗い出し：AIが書いたとバレる箇所（定型の言い回し、「〜と言えるでしょう」「〜が重要です」「〜することが大切です」「さまざまな」「〜において」、過剰な丁寧さ、教科書的な説明、列挙のしすぎ、対句の決まり文句）を全部見つけ、話し言葉に直す
② 語尾の機械感を消す：同じ語尾（〜です。〜です。〜です。／〜ます。が続く等）が3回以上続く所を探して崩す（体言止め・問いかけ・「〜なんです」「〜でした」などを混ぜる）
③ まとめすぎを崩す：きれいにまとめすぎない。結論は言い切る。説明を1つ削る
④ 前置きを消す：「いかがでしたか」系の締め、「今回は〜について解説します」などの本題前の前置きを全部削る。冒頭はいきなり本題から入る
⑤ 体験者の口にする：段落ごとに、体験した人しか言えない一言を1つ入れる（金額・失敗・その時の感情）
⑥ 文のリズムを揃えない：一文25〜30字を基準にし、たまに短い文（10字前後）を混ぜる。長すぎる文は切る
⑦ 専門語を日常語に：読者が0.2秒で意味が分かる言葉に置き換える（どうしても要る専門語は、すぐ後ろに言い換えを添える）
⑧ 最後の検品：この文章を初見の読者として読み、「買わない（問い合わせない）理由」を3つ挙げてから、それを潰すように直す

必ず守ること（工程より優先する）:
- 事実を創作しない。⑤の金額・件数・期間・失敗の出来事・お客様の言葉は、【使ってよい事実】と下書きにあるものだけを使う
- 使える事実が無い段落では、⑤の一言は【要記入：その時の金額や失敗、気持ちを一言（例の方向性）】という形で置く（書き手が後で自分の体験で埋める）。感情・気づきだけの一言（「正直、最初は半信半疑でした」など）は、事実に反しない範囲で書いてよい
- 「必ず」「絶対」「No.1」「最高」「業界初」「唯一」など根拠の要る断定・最上級を使わない。効果や成果を約束しない。医療・美容・健康食品・金融の効果効能を断定しない。体験談を効果の根拠にしない
- 見出し（## ###）の数と順番、記事の主題、固有名詞、リンクの URL はそのまま。文字数は下書きの ±15% に収める
- Markdown で出す。記事タイトルは本文に入れない。日本語の常用漢字だけで書く

出力は JSON: {"body":"直した本文（Markdown）","tells":["①で見つけたAIっぽい箇所（直す前の言い回し。最大8件）"],"reasons":["⑧で挙げた買わない理由を3つ"]}`;

export type PolishResult = { bodyMd: string; tells: string[]; reasons: string[]; fills: number };

export type PolishDeps = { ask: (system: string, user: string) => Promise<{ body?: unknown; tells?: unknown[]; reasons?: unknown[] }> };

export const defaultPolishDeps = (): PolishDeps => ({
  ask: (system, user) => askJson(system, user, { maxTokens: 10000, timeoutMs: 170_000 }),
});

export async function polishNote(
  draft: { title: string; bodyMd: string },
  facts: { business: string; writerNote: string },
  deps: PolishDeps = defaultPolishDeps()
): Promise<PolishResult> {
  const user = [
    `# 記事タイトル: ${draft.title}`,
    "",
    "# 使ってよい事実（ここと下書きに無い金額・件数・出来事は書かない）",
    facts.business ? `事業者の説明: ${facts.business.slice(0, 1500)}` : "事業者の説明: （なし）",
    facts.writerNote ? `書き手からの指示・体験: ${facts.writerNote.slice(0, 1200)}` : "書き手からの指示・体験: （なし）",
    "",
    "# 下書き",
    draft.bodyMd,
  ].join("\n");
  const r = await deps.ask(SYSTEM, user);
  const bodyMd = normalizeJapanese(String(r.body ?? "").trim()).replace(/^#\s+.+\n+/, "");
  // 書き直しが壊れていたら（短すぎる・見出しが消えた）使わない
  const before = bodyChars(draft.bodyMd);
  const h2 = (s: string) => (s.match(/^##\s/gm) ?? []).length;
  if (bodyChars(bodyMd) < Math.max(300, before * 0.6)) throw new Error("推敲の結果が短すぎたため、下書きのままにしました");
  if (h2(draft.bodyMd) > 0 && h2(bodyMd) < h2(draft.bodyMd) - 1) throw new Error("推敲で見出しが消えたため、下書きのままにしました");
  const list = (v: unknown[] | undefined, n: number) => (Array.isArray(v) ? v : []).map((x) => normalizeJapanese(String(x ?? "").trim()).slice(0, 120)).filter(Boolean).slice(0, n);
  return { bodyMd, tells: list(r.tells, 8), reasons: list(r.reasons, 3), fills: bodyMd.split(FILL_MARK).length - 1 };
}
