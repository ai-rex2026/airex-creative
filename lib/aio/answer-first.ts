/**
 * 見出し（##）の直後に、その節の結論を先に書く短い要約（50〜150字）を置く（2026-11-19）。
 * 承認済みのノウハウ「aio-answer-first」を、AI への指示だけに頼らず、保存の前にコードで検査して直す形にしたもの。
 *  - 検査：各節の最初の段落の長さ。要約として短すぎる／長すぎる節を見つける（箇条書き・表・### から始まる節は検査しない＝FAQ・比較表など）
 *  - 直し：見つけた節だけを、AI 1回でまとめて書き直す。節の本文に書かれていることだけで書かせる。
 *    要約を節の先頭に足し、元の最初の段落が短い前置きなら置き換える。AI が失敗したら本文はそのまま
 */
export const LEAD_MIN = 40;
export const LEAD_MAX = 180;
export const MAX_FIX_SECTIONS = 8;

export type Section = { index: number; heading: string; start: number; end: number; body: string; firstPara: string; firstParaStart: number; firstParaEnd: number };

const plain = (s: string) => s.replace(/[*_`>#]/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\s+/g, "");

/** ## の節に分ける。コードブロックの中の ## は見出しとして数えない */
export function sections(md: string): Section[] {
  const out: Section[] = [];
  const lines = md.split("\n");
  let pos = 0;
  let inCode = false;
  const heads: { line: number; pos: number; heading: string }[] = [];
  lines.forEach((l, i) => {
    if (/^```/.test(l)) inCode = !inCode;
    if (!inCode && /^##\s+/.test(l)) heads.push({ line: i, pos, heading: l.replace(/^##\s+/, "").trim() });
    pos += l.length + 1;
  });
  heads.forEach((h, k) => {
    const start = h.pos;
    const end = k + 1 < heads.length ? heads[k + 1].pos : md.length;
    const afterHeading = start + md.slice(start).indexOf("\n") + 1;
    const body = md.slice(afterHeading, end);
    // 最初の段落（空行で区切る）。箇条書き・表・### ・画像から始まる節は firstPara を空にして検査しない
    const lead = body.match(/^\s*\n*/)?.[0].length ?? 0;
    const rest = body.slice(lead);
    const para = rest.split(/\n\s*\n/)[0] ?? "";
    const first = para.trimStart();
    const isPlainPara = first !== "" && !/^(#{1,6}\s|[-*+]\s|\d+[.)]\s|\||!\[|>|```)/.test(first);
    const paraStart = afterHeading + lead;
    out.push({
      index: k,
      heading: h.heading,
      start,
      end,
      body,
      firstPara: isPlainPara ? para : "",
      firstParaStart: paraStart,
      firstParaEnd: paraStart + para.length,
    });
  });
  return out;
}

/** 要約として短すぎる・長すぎる最初の段落を持つ節 */
export function weakSections(md: string): Section[] {
  return sections(md).filter((s) => {
    if (!s.firstPara) return false;
    const n = plain(s.firstPara).length;
    return n < LEAD_MIN || n > LEAD_MAX;
  });
}

export type LeadAsk = (system: string, user: string) => Promise<unknown>;

const SYSTEM = `あなたは日本語の編集者です。記事の各節について、その節の結論を先に述べる要約を書きます。
- 各要約は、日本語で50〜150字の1〜2文。その節の本文に書かれていることだけで書く（新しい事実・数字・固有名詞を足さない）
- 「必ず」「絶対」「No.1」など断定・最上級を使わない。効果を約束しない
- 出力: {"leads":[{"index":0,"lead":"要約"}]}（index は入力の節の番号）`;

/** 要約を書き直す。AI は1回だけ。失敗・不正な出力のときは本文をそのまま返す */
export async function fixLeads(md: string, ask: LeadAsk): Promise<{ md: string; fixed: number; tried: number }> {
  const weak = weakSections(md).slice(0, MAX_FIX_SECTIONS);
  if (weak.length === 0) return { md, fixed: 0, tried: 0 };
  let res: unknown;
  try {
    res = await ask(SYSTEM, weak.map((s) => `## 節${s.index}：${s.heading}\n${s.body.slice(0, 1200)}`).join("\n\n"));
  } catch {
    return { md, fixed: 0, tried: weak.length };
  }
  const leads = Array.isArray((res as { leads?: unknown })?.leads) ? ((res as { leads: { index?: unknown; lead?: unknown }[] }).leads) : [];
  // 後ろの節から差し替える（前の節の位置がずれない）
  let out = md;
  let fixed = 0;
  for (const s of [...weak].sort((a, b) => b.firstParaStart - a.firstParaStart)) {
    const hit = leads.find((l) => l?.index === s.index);
    const lead = typeof hit?.lead === "string" ? hit.lead.replace(/\s+/g, " ").trim() : "";
    const n = plain(lead).length;
    if (n < LEAD_MIN || n > LEAD_MAX) continue;
    // 元の最初の段落が短い前置きなら置き換え、長い（中身のある）段落なら、その前に要約を足す
    const short = plain(s.firstPara).length < LEAD_MIN;
    out = short ? out.slice(0, s.firstParaStart) + lead + out.slice(s.firstParaEnd) : out.slice(0, s.firstParaStart) + lead + "\n\n" + out.slice(s.firstParaStart);
    fixed++;
  }
  return { md: out, fixed, tried: weak.length };
}
