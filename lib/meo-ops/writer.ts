import { askJson, MODEL_FAST } from "../anthropic";
import { checkGuard, checkGuardDict } from "../guardrail";
import type { GuardHit, Industry } from "../types";
import { normalizeJapanese } from "./japanese";
import type { MeoAiReplySettings, MeoReview, MeoStoreSnapshot } from "./types";

/**
 * MEO のテキスト生成（本体 app/services/meo/ai_writer.py の移植）。
 * どの生成も、生成と同時に法令チェックを通して指摘を一緒に返す（AGENTS.md の決めごと）。
 */

const JA_ONLY_RULE = "- 日本語の文章で通常使う漢字（常用漢字・日本の新字体）だけで書く。中国語の簡体字・繁体字は使わない";

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
${JA_ONLY_RULE}
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
  const reply = normalizeJapanese(String(res.reply ?? "").trim());
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

${JA_ONLY_RULE}
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
  const title = normalizeJapanese(String(res.title ?? "").trim()).slice(0, 200);
  const body = normalizeJapanese(String(res.body ?? "").trim()).slice(0, 1500);
  if (!title || !body) throw new Error("投稿文を作れませんでした");
  const verdict = await checkGuard([title, body], industry);
  return { title, body, guard: verdict };
}

const DESCRIPTION_SYSTEM = `あなたは日本の店舗のGoogleビジネスプロフィール「ビジネスの説明」を書く担当者です。

- 与えられた事実だけで書く。無い実績・数字・受賞歴・価格は書かない
${JA_ONLY_RULE}
- 書く対象は「店舗名」の1店舗だけ。ほかの会社名・サービス名・製品名は書かない（事実に書かれていても、その店舗自身のことでなければ使わない）
- 店舗名は本文に必ず入れる
- 「No.1」「必ず」「絶対」「最高」など根拠の要る表現は使わない
- 店舗の特徴・来店のメリット・アクセスを、読みやすく400〜600文字で書く
- URL・電話番号・記号の多用・キーワードの羅列はしない（Googleのガイドライン違反になる）

出力: {"description":"本文"}`;

export async function draftDescription(
  store: Pick<MeoStoreSnapshot, "name" | "category" | "address" | "rating" | "reviewCount"> | null,
  extra: { storeName: string; paymentMethods: string[]; attributes: string[]; notes: string },
  industry: Industry
) {
  const facts = [
    `店舗名: ${store?.name || extra.storeName}`,
    store?.category ? `業種: ${store.category}` : "",
    store?.address ? `所在地: ${store.address}` : "",
    extra.paymentMethods.length ? `決済方法: ${extra.paymentMethods.join("、")}` : "",
    extra.attributes.length ? `設備・属性: ${extra.attributes.join("、")}` : "",
    extra.notes.trim() ? `店舗側が入力した特徴・強み: ${extra.notes.trim().slice(0, 600)}` : "",
  ].filter(Boolean);
  const res = await askJson<{ description?: string }>(DESCRIPTION_SYSTEM, facts.join("\n"), { model: MODEL_FAST, maxTokens: 1500, timeoutMs: 60_000 });
  const description = normalizeJapanese(String(res.description ?? "").trim()).slice(0, 750);
  if (!description) throw new Error("説明文を作れませんでした");
  const verdict = await checkGuard([description], industry);
  // 店名が本文に入っていなければ、別の会社の説明になっている疑いがある（画面で警告する）
  const name = store?.name || extra.storeName;
  const tokens = name
    .split(/[\s|｜]+/)
    .map((t) => t.replace(/^(㈱|（株）|\(株\)|株式会社)/, "").replace(/(株式会社)$/, ""))
    .filter((t) => [...t].length >= 2);
  const nameMissing = tokens.length > 0 && !tokens.some((t) => description.includes([...t].slice(0, 4).join("")));
  return { description, guard: verdict, nameMissing };
}

// ── AI検索で聞く「業種」を、事業内容から考える ─────────────────────
const SEARCH_TERM_SYSTEM = `あなたは日本の事業者向けのAI検索対策の担当者です。
その事業を探している人が、ChatGPTなどのAIに実際に入力する「探す言葉」を1つ決めます。

- Googleの業種カテゴリ（例: 事務所、オフィス賃貸業者）は、事業内容と合っていないことがある。
  カテゴリより、事業者が説明した内容とWebサイトの内容を優先する
- 探す側の言葉で書く（例: Web広告代理店、リスティング広告の運用会社、美容室、整体院）。社名・店名は入れない
- 10文字前後の名詞句。「〜を探しています」の文にはしない
- 事業内容が読み取れないときは term を空にして、reason に何が足りないかを書く
${JA_ONLY_RULE}

出力: {"term":"探す言葉","reason":"そう考えた根拠を60字以内で"}`;

/** 公開Webページの見出し・説明だけを短く取る（失敗しても空で返す） */
export async function fetchSiteSummary(url: string | null | undefined): Promise<string> {
  try {
    if (!url) return "";
    const u = new URL(url);
    const host = u.hostname;
    if (u.protocol !== "https:" || !host.includes(".") || /^[\d.]+$/.test(host) || host.endsWith(".local") || host.endsWith(".internal")) return "";
    const res = await fetch(u.toString(), { signal: AbortSignal.timeout(8_000), redirect: "follow", headers: { "user-agent": "Mozilla/5.0 (compatible; AirexBot/1.0)" } });
    if (!res.ok) return "";
    const html = (await res.text()).slice(0, 300_000);
    const pick = (re: RegExp) => (re.exec(html)?.[1] ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    const parts = [
      pick(/<title[^>]*>([\s\S]*?)<\/title>/i),
      pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i),
      ...[...html.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi)].slice(0, 8).map((m) => m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()),
    ].filter(Boolean);
    return parts.join(" / ").slice(0, 1200);
  } catch {
    return "";
  }
}

export async function suggestSearchTerm(
  store: Pick<MeoStoreSnapshot, "name" | "category" | "address" | "websiteUrl"> | null,
  notes: string
): Promise<{ term: string; reason: string }> {
  const site = await fetchSiteSummary(store?.websiteUrl);
  const facts = [
    `事業者名: ${store?.name ?? ""}`,
    store?.category ? `Googleの業種カテゴリ（実態と違うことがある）: ${store.category}` : "",
    notes.trim() ? `事業者が説明したサービス内容: ${notes.trim().slice(0, 600)}` : "",
    site ? `Webサイトの内容: ${site}` : "",
  ].filter(Boolean);
  const res = await askJson<{ term?: string; reason?: string }>(SEARCH_TERM_SYSTEM, facts.join("\n"), { model: MODEL_FAST, maxTokens: 300, timeoutMs: 40_000 });
  const term = normalizeJapanese(String(res.term ?? "").trim()).slice(0, 40);
  const reason = normalizeJapanese(String(res.reason ?? "").trim()).slice(0, 120);
  return { term, reason };
}
