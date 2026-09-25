import { askJson, MODEL_FAST } from "../anthropic";
import { checkGuard, checkGuardDict } from "../guardrail";
import type { GuardHit, Industry } from "../types";
import type { MeoAiReplySettings, MeoReview, MeoStoreSnapshot } from "./types";

/**
 * MEO のテキスト生成（本体 app/services/meo/ai_writer.py の移植）。
 * どの生成も、生成と同時に法令チェックを通して指摘を一緒に返す（AGENTS.md の決めごと）。
 */

const TONE: Record<MeoAiReplySettings["tone"], string> = {
  polite: "丁寧で落ち着いた敬語",
  friendly: "親しみやすく、やわらかい口調",
  formal: "格式のあるフォーマルな敬語",
};

const REPLY_SYSTEM = `あなたは日本の店舗オーナーの代わりにGoogleクチコミへ返信する担当者です。
次の条件を守って返信文を作ってください。

- 投稿者への感謝を最初に述べる
- 低評価にはお詫びと具体的な改善姿勢を含める
- 事実を創作しない（来店日・担当者名・提供内容を勝手に補わない）
- 「必ず」「絶対」「No.1」など根拠の要る断定・最上級の表現は使わない
- 200文字以内、改行は2つまで

出力: {"reply":"返信文"}`;

export async function draftReply(review: Pick<MeoReview, "rating" | "authorName" | "text">, s: MeoAiReplySettings) {
  const lines = [
    `# クチコミ（星${review.rating}）`,
    `投稿者: ${review.authorName}`,
    `本文: ${review.text || "（本文なし）"}`,
    "",
    "# 返信の条件",
    `トーン: ${TONE[s.tone]}`,
  ];
  if (s.keywords.length) lines.push(`できれば含めたい言葉: ${s.keywords.join(", ")}`);
  if (s.ngWords.length) lines.push(`使ってはいけない言葉: ${s.ngWords.join(", ")}`);
  if (s.styleInstruction) lines.push(`追加の指示: ${s.styleInstruction}`);
  if (s.signature) lines.push(`最後の一文: ${s.signature}`);

  const res = await askJson<{ reply?: string }>(REPLY_SYSTEM, lines.join("\n"), { model: MODEL_FAST, maxTokens: 800, timeoutMs: 60_000 });
  const reply = String(res.reply ?? "").trim();
  if (!reply) throw new Error("返信文を作れませんでした");
  // 返信はクチコミへの応答なので広告審査ほど厳密でなくてよい。辞書だけで無料で見る
  const guardHits: GuardHit[] = checkGuardDict([reply], "general");
  // NGワードが混ざっていたら指摘として出す（AIが指示を守らないことがある）
  for (const w of s.ngWords) {
    if (w && reply.includes(w)) guardHits.push({ text: w, reason: "設定のNGワードが含まれています", law: "店舗の設定", suggestion: "別の言い方に直してください", severity: "high" });
  }
  return { reply, guardHits };
}

const POST_THEMES: Record<string, string> = {
  campaign: "キャンペーン告知",
  newItem: "新商品・新メニュー",
  notice: "営業時間・お知らせ",
  seasonal: "季節の話題",
};

const POST_SYSTEM = `あなたは日本の店舗のGoogleビジネスプロフィール「最新情報」の投稿を書く担当者です。

- 事実を創作しない。与えられていない価格・割引率・期間・実績・受賞歴は書かない
  （具体値が要る箇所は「〇〇円」「〇月〇日まで」のように空欄の記号で残す）
- 「No.1」「必ず」「絶対」「最高」「最安」など根拠の要る表現は使わない
- タイトルは30文字以内、本文は300文字以内。絵文字は使わない
- 来店・予約につながる一文で締める

出力: {"title":"タイトル","body":"本文"}`;

export async function draftPost(store: Pick<MeoStoreSnapshot, "name" | "category" | "address"> | null, storeName: string, theme: string, industry: Industry) {
  const facts = [
    `店舗名: ${store?.name || storeName}`,
    store?.category ? `業種: ${store.category}` : "",
    store?.address ? `所在地: ${store.address}` : "",
    `投稿テーマ: ${POST_THEMES[theme] ?? theme}`,
  ].filter(Boolean);
  const res = await askJson<{ title?: string; body?: string }>(POST_SYSTEM, facts.join("\n"), { model: MODEL_FAST, maxTokens: 1200, timeoutMs: 60_000 });
  const title = String(res.title ?? "").trim().slice(0, 200);
  const body = String(res.body ?? "").trim().slice(0, 1500);
  if (!title || !body) throw new Error("投稿文を作れませんでした");
  const verdict = await checkGuard([title, body], industry);
  return { title, body, guard: verdict };
}

const DESCRIPTION_SYSTEM = `あなたは日本の店舗のGoogleビジネスプロフィール「ビジネスの説明」を書く担当者です。

- 与えられた事実だけで書く。無い実績・数字・受賞歴・価格は書かない
- 「No.1」「必ず」「絶対」「最高」など根拠の要る表現は使わない
- 店舗の特徴・来店のメリット・アクセスを、読みやすく400〜600文字で書く
- URL・電話番号・記号の多用・キーワードの羅列はしない（Googleのガイドライン違反になる）

出力: {"description":"本文"}`;

export async function draftDescription(
  store: Pick<MeoStoreSnapshot, "name" | "category" | "address" | "rating" | "reviewCount"> | null,
  extra: { storeName: string; paymentMethods: string[]; attributes: string[]; siteSummary: string | null },
  industry: Industry
) {
  const facts = [
    `店舗名: ${store?.name || extra.storeName}`,
    store?.category ? `業種: ${store.category}` : "",
    store?.address ? `所在地: ${store.address}` : "",
    extra.paymentMethods.length ? `決済方法: ${extra.paymentMethods.join("、")}` : "",
    extra.attributes.length ? `設備・属性: ${extra.attributes.join("、")}` : "",
    extra.siteSummary ? `公式サイトの説明: ${extra.siteSummary.slice(0, 600)}` : "",
  ].filter(Boolean);
  const res = await askJson<{ description?: string }>(DESCRIPTION_SYSTEM, facts.join("\n"), { model: MODEL_FAST, maxTokens: 1500, timeoutMs: 60_000 });
  const description = String(res.description ?? "").trim().slice(0, 750);
  if (!description) throw new Error("説明文を作れませんでした");
  const verdict = await checkGuard([description], industry);
  return { description, guard: verdict };
}
