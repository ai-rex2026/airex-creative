import { askJson, MODEL_FAST } from "./anthropic";
import type { GuardVerdict, Industry } from "./types";

/**
 * 法令ガードレール（ロードマップ #10 / リスク R-02）。
 * 事後検知では遅いので「生成と同時」に通す。辞書で確実に拾える語を先に落とし、
 * 文脈が要るものだけAIに投げる。辞書だけでも赤判定は出せるので、AIが落ちても素通りしない。
 */

type Rule = { pattern: RegExp; reason: string; law: string; suggestion: string };

const COMMON: Rule[] = [
  { pattern: /日本[一初]|世界一|No\.?\s?1|ナンバーワン|最高|最安|業界初/g,
    reason: "最上級・No.1表示は客観的な調査結果の併記が要る", law: "景表法(優良誤認)",
    suggestion: "「〇〇調べ／2026年3月時点」など出典と時点を併記するか、表現を落とす" },
  { pattern: /必ず|絶対|100%|確実に|誰でも|保証します/g,
    reason: "効果や結果の断定・保証は根拠なく使えない", law: "景表法(優良誤認)",
    suggestion: "「〜を目指せます」「実績では〜」と実績ベースに言い換える" },
  { pattern: /完全無料|一切かからない/g,
    reason: "条件付き無料を無条件に見せると有利誤認になる", law: "景表法(有利誤認)",
    suggestion: "無料の範囲と条件を併記する" },
];

const BY_INDUSTRY: Record<Industry, Rule[]> = {
  beauty: [
    { pattern: /痩せる|脂肪が落ちる|シミが消える|若返る|アンチエイジング|小顔になる/g,
      reason: "化粧品・エステで身体の変化を断定すると医薬品的効能の標榜になる", law: "薬機法",
      suggestion: "「ハリのある印象へ」など使用感・印象の表現に置き換える" },
  ],
  medical: [
    { pattern: /絶対に治る|副作用[はな]ない|痛[くみ]は?ない|安全です/g,
      reason: "治療効果の保証・安全性の断定は広告できない", law: "医療広告ガイドライン",
      suggestion: "リスク・副作用の併記とともに事実のみ記載する" },
    { pattern: /ビフォーアフター|症例写真/g,
      reason: "術前術後写真は説明文の併記など要件を満たさないと掲載できない", law: "医療広告ガイドライン",
      suggestion: "治療内容・費用・リスク・副作用を併記する" },
  ],
  supplement: [
    { pattern: /治る|改善する|予防する|効く|病気/g,
      reason: "食品で疾病の治療・予防を表現すると医薬品的効能の標榜になる", law: "薬機法",
      suggestion: "機能性表示の届出範囲に収めるか、体験の表現に留める" },
  ],
  finance: [
    { pattern: /必ず儲かる|元本保証|絶対に増える|リスクなし/g,
      reason: "断定的判断の提供・誤解を生む表示は禁止", law: "金商法",
      suggestion: "リスクと手数料を併記し、断定を外す" },
  ],
  general: [],
};

function dictScan(texts: string[], industry: Industry): GuardVerdict["hits"] {
  const rules = [...COMMON, ...BY_INDUSTRY[industry]];
  const hits: GuardVerdict["hits"] = [];
  for (const t of texts) {
    for (const r of rules) {
      for (const m of t.matchAll(r.pattern)) {
        hits.push({ text: m[0], reason: r.reason, law: r.law, suggestion: r.suggestion });
      }
    }
  }
  return hits;
}

export async function checkGuard(texts: string[], industry: Industry): Promise<GuardVerdict> {
  const hits = dictScan(texts, industry);
  let aiHits: GuardVerdict["hits"] = [];
  try {
    const res = await askJson<{ hits: GuardVerdict["hits"] }>(
      `あなたは日本の広告審査担当です。景表法・薬機法・医療広告ガイドライン・金商法の観点で、
広告表現に問題がある箇所だけを挙げます。問題がなければ hits は空配列にします。
業種: ${industry}。辞書で機械的に拾える語は既に検出済みなので、文脈で初めて問題になるものを中心に見てください。`,
      `次の広告文を審査してください。\n${texts.map((t, i) => `${i + 1}. ${t}`).join("\n")}\n
出力: {"hits":[{"text":"該当箇所","reason":"なぜ問題か","law":"根拠","suggestion":"言い換え案"}]}`,
      { model: MODEL_FAST, maxTokens: 1500 }
    );
    aiHits = res.hits ?? [];
  } catch {
    // AI が落ちても辞書判定だけで結果を返す（素通りさせない）
  }
  const all = [...hits, ...aiHits];
  const level: GuardVerdict["level"] = all.length === 0 ? "green" : hits.length > 0 ? "red" : "yellow";
  return { level, hits: all };
}
