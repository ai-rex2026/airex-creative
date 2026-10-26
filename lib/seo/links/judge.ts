import { anchorCandidates } from "./text";

/**
 * リンクすべきかの判定（2026-10-27）。「意味を理解しないと決められない部分」だけを AI に任せる。
 * 判定の仕組みは差し替えられる（いまは Claude Haiku。Jev を使えるようになったら同じ形で足す）。
 * 確率と確信度は AI の自己申告で、較正された値ではない。画面でもそう示す。
 */

export type JudgeInput = {
  fromUrl: string;
  fromTitle: string;
  toUrl: string;
  toTitle: string;
  toHeadings: string[];
  /** リンク元の本文のうち、リンク先に近い文（コードで選んだもの）。sentenceIndex はこの並びの番号 */
  sentences: string[];
};

export type JudgeAnswer = {
  link: boolean;
  /** 0〜1。リンクを入れることを勧める確率 */
  probability: number;
  /** 0〜1。この判定にどれだけ自信があるか */
  confidence: number;
  sentenceIndex: number;
  anchor: string;
  role: string;
  reason: string;
};

export type Judge = {
  name: "claude" | "jev";
  judge: (input: JudgeInput) => Promise<JudgeAnswer>;
};

export const ROLES = ["補足の説明", "関連する事例", "比較・選び方", "次に読むもの", "用語の解説"] as const;

/** 採用の基準（推奨確率と確信度のどちらも満たすものだけ） */
export const ACCEPT_PROBABILITY = 0.7;
export const ACCEPT_CONFIDENCE = 0.6;

export function passes(a: Pick<JudgeAnswer, "link" | "probability" | "confidence">): boolean {
  return a.link && a.probability >= ACCEPT_PROBABILITY && a.confidence >= ACCEPT_CONFIDENCE;
}

const clamp01 = (n: unknown) => {
  const x = Number(n);
  return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0;
};

/**
 * AI の返答を検証してそろえる。
 * アンカーはリンク元の文に実在する語句だけを認め、無ければコードが作った候補から選び直す（作られた語は使わない）
 */
export function normalizeAnswer(raw: Partial<JudgeAnswer> | null | undefined, input: JudgeInput): JudgeAnswer {
  const idx = Number.isInteger(raw?.sentenceIndex) ? (raw!.sentenceIndex as number) : 0;
  const si = idx >= 0 && idx < input.sentences.length ? idx : 0;
  const sentence = input.sentences[si] ?? "";
  let anchor = String(raw?.anchor ?? "").trim();
  if (!anchor || !sentence.includes(anchor) || anchor.length > 30) {
    anchor = anchorCandidates(sentence, { url: input.toUrl, title: input.toTitle, h1: input.toTitle, headings: input.toHeadings, body: "", links: [] })[0] ?? "";
  }
  const role = (ROLES as readonly string[]).includes(String(raw?.role)) ? String(raw?.role) : "補足の説明";
  const link = raw?.link === true && !!anchor;
  return {
    link,
    probability: clamp01(raw?.probability),
    confidence: clamp01(raw?.confidence),
    sentenceIndex: si,
    anchor,
    role,
    reason: String(raw?.reason ?? "").slice(0, 200),
  };
}

export const JUDGE_SYSTEM = `あなたはサイトの内部リンクを設計する編集者です。「リンク元の記事」の本文から「リンク先の記事」へ内部リンクを張るべきかを判定します。
- 読者がリンク元を読んでいる最中に、リンク先の内容を知りたくなる自然な流れがあるときだけ link を true にする。話題が似ているだけ、同じ語が出るだけのときは false
- リンク先の記事の宣伝や、リンクのためだけの不自然な誘導は false
- 設置場所は、与えられた文の番号（sentenceIndex）から1つ選ぶ。選べる文が無ければ link を false にする
- anchor は、選んだ文の中にそのまま書かれている語句（3〜20字）にする。文にない語は絶対に使わない
- role は次のどれか：${ROLES.join("／")}
- probability は「リンクを張ることを勧める確率」、confidence は「この判定にどれだけ自信があるか」を、それぞれ 0〜1 の数で正直に答える
- 効果や成果を断定しない。理由（reason）は80字以内の事実だけ
出力は JSON のみ：{"link":true,"probability":0.8,"confidence":0.7,"sentenceIndex":0,"anchor":"…","role":"…","reason":"…"}`;

export function judgeUser(i: JudgeInput): string {
  return [
    `【リンク元の記事】${i.fromTitle}`,
    `【リンク先の記事】${i.toTitle}`,
    i.toHeadings.length ? `【リンク先の見出し】${i.toHeadings.slice(0, 8).join(" / ")}` : "",
    `【設置場所の候補（リンク元の本文の文）】`,
    ...i.sentences.map((s, n) => `${n}: ${s}`),
  ]
    .filter(Boolean)
    .join("\n");
}
