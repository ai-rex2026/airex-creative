import { askJson } from "../anthropic";
import { checkGuard } from "../guardrail";
import { normalizeJapanese } from "../meo-ops/japanese";
import type { GuardVerdict } from "../types";
import type { SnsSettings } from "./types";
import { xWeightedLength } from "./x-api";
import type { InboxMessage, ObservedPost, OpsTarget, PatternReport, XOpsConfig, XPattern } from "./ops-types";

/**
 * X 運用の AI：伸びた型の分析・投稿案・反応（リプライ／引用／リポスト）の候補・DM の返信案。
 * 数（反応率など）はコードで計算して渡し、AI には言葉にするところと案だけを作らせる。
 * どの案も生成と同時に法令チェックを通す（AGENTS.md）。数字・実績は与えられたものだけ。
 */

const JA = "日本語の文章で通常使う漢字（常用漢字・日本の新字体）だけで書く。中国語の簡体字・繁体字を使わない";

const RULES = `守ること:
- 事実を創作しない。与えられていない数字・実績・受賞・顧客の声・価格を書かない
- 「必ず」「絶対」「No.1」「最高」「業界初」「唯一」など根拠の要る断定・最上級を使わない。効果を約束しない
- 医療・美容・健康食品・金融の効果効能を断定しない
- 他人の投稿をそのまま写さない（型＝構成や書き出しの工夫だけを借りる）。特定の人を攻撃しない・煽らない
- ${JA}`;

function brandLines(b: SnsSettings, cfg: XOpsConfig): string[] {
  return [
    `アカウントの持ち主: ${b.brandName || "（未設定）"}`,
    b.brandUrl ? `URL: ${b.brandUrl}` : "",
    b.brandNotes ? `事業内容・強み・NG: ${b.brandNotes.slice(0, 1500)}` : "",
    cfg.rules ? `投稿の決まりごと: ${cfg.rules.slice(0, 800)}` : "",
  ].filter(Boolean);
}

const fmtPost = (p: ObservedPost) =>
  `[${p.externalId}] @${p.author}${p.authorFollowers ? `（フォロワー${p.authorFollowers}）` : ""} 反応率${p.rate ?? "?"}%・いいね${p.likes ?? "?"}・RP${p.reposts ?? "?"}・返信${p.replies ?? "?"}・表示${p.views ?? "?"}${p.media.length ? `・画像/動画${p.media.length}` : ""}\n${p.text.replace(/\s+/g, " ").slice(0, 280)}`;

// ── 伸びた型 ─────────────────────

const PATTERN_SYSTEM = `あなたは日本の X（旧Twitter）運用の責任者です。伸びている投稿と、自分のアカウントの投稿の結果を読み、再現できる「型」を取り出します。
- 型は、構成・書き出し・改行・スレッドの使い方（本文の続きをリプライに書いてリプライまで読ませる 等）・画像の使い方・投稿時刻など、真似できる形で書く
- 「なぜ伸びていそうか」は見立てとして書く（断定しない）
- 自分の投稿は、反応が良かったものと悪かったものの差から、次に何を変えるかを書く
${RULES}

出力: {"summary":"いま伸びている型の要点（200字以内）","patterns":[{"name":"型の名前（20字以内）","howTo":"どう書くか（構成・文字数・スレッド・画像）","why":"伸びていそうな理由","examples":["根拠にした投稿のID"],"fit":"自社で使うなら、どう使うか"}],"ownLearnings":[{"finding":"自分の投稿から分かったこと","evidence":"どの数字から","next":"次の案で変えること"}]}`;

export async function analyzePatterns(brand: SnsSettings, cfg: XOpsConfig, observed: ObservedPost[]): Promise<Omit<PatternReport, "id" | "createdAt">> {
  const others = observed.filter((p) => p.source !== "own" && p.text).sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0));
  const own = observed.filter((p) => p.source === "own" && p.text).sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0));
  if (others.length < 3 && own.length < 3) throw new Error("分析する投稿が足りません。先に「伸びているアカウント」を登録して投稿を集めてください");
  const user = [
    ...brandLines(brand, cfg),
    "",
    `# 伸びている投稿（反応率の高い順・${Math.min(30, others.length)}件）`,
    ...others.slice(0, 30).map(fmtPost),
    "",
    own.length ? `# 自分の投稿（反応率の高い順・${Math.min(20, own.length)}件）` : "# 自分の投稿：まだ無い",
    ...own.slice(0, 10).map(fmtPost),
    own.length > 10 ? "…（反応の低いもの）" : "",
    ...own.slice(10, 20).map(fmtPost),
  ].join("\n");
  const r = await askJson<{ summary?: string; patterns?: Partial<XPattern>[]; ownLearnings?: { finding?: string; evidence?: string; next?: string }[] }>(PATTERN_SYSTEM, user, { maxTokens: 4000, timeoutMs: 150_000 });
  const s = (v: unknown, n: number) => normalizeJapanese(String(v ?? "").trim()).slice(0, n);
  const ids = new Set(observed.map((o) => o.externalId));
  return {
    summary: s(r.summary, 400),
    patterns: (Array.isArray(r.patterns) ? r.patterns : [])
      .map((p) => ({ name: s(p.name, 40), howTo: s(p.howTo, 400), why: s(p.why, 300), examples: (Array.isArray(p.examples) ? p.examples : []).map(String).filter((x) => ids.has(x)).slice(0, 4), fit: s(p.fit, 300) }))
      .filter((p) => p.name && p.howTo)
      .slice(0, 8),
    ownLearnings: (Array.isArray(r.ownLearnings) ? r.ownLearnings : []).map((l) => ({ finding: s(l.finding, 200), evidence: s(l.evidence, 200), next: s(l.next, 200) })).filter((l) => l.finding).slice(0, 5),
  };
}

// ── 投稿案 ─────────────────────

export type DraftedXPost = { pattern: string; body: string; thread: string[]; hashtags: string[]; image: { prompt: string; alt: string } | null; reason: string; guard: GuardVerdict; warnings: string[] };

const DRAFT_SYSTEM = `あなたは日本の X 運用の担当者です。伸びている「型」を当てはめて、自社アカウントの投稿案を作ります。
- 1投稿は全角130字以内（X の上限は全角140字）。続きが要る型は thread に続きを書く（各130字以内、最大4つ）。本文の最後で続きを読みたくなるようにする
- 型ごとに違う切り口にする。最近の案と同じ話題・書き出しにしない
- 画像が効く型なら image に英語の画像の説明を書く（写真・図の場面。文字・ロゴ・画面のスクリーンショット・グラフは描かせない）。要らなければ null
- ハッシュタグは0〜2個（#なし）
- URL は本文に入れない（URL 入りの投稿は X の API の単価が高い。入れるなら thread の最後に1つだけ）
${RULES}

出力: {"drafts":[{"pattern":"使った型の名前","body":"本文","thread":["続き（リプライに書く）"],"hashtags":[],"image":{"prompt":"English description","alt":"日本語の代替テキスト"},"reason":"この案で狙うこと（60字以内）"}]}`;

/** 法令チェックを案ごとに並行で通す（AI の指摘は1回の呼び出しで数件までなので、まとめると見落とす）。失敗した案は「要確認」にする */
async function guardMany(texts: string[][], industry: SnsSettings["industry"]): Promise<GuardVerdict[]> {
  const settled = await Promise.allSettled(texts.map((g) => (g.filter(Boolean).length ? checkGuard(g.filter(Boolean), industry) : Promise.resolve<GuardVerdict>({ level: "green", hits: [] }))));
  return settled.map((r) =>
    r.status === "fulfilled" ? r.value : { level: "yellow", hits: [{ text: "", reason: "表現チェックを実行できませんでした。内容を確認してから承認してください", law: "", suggestion: "", severity: "medium" }] }
  );
}

export async function draftXPosts(
  brand: SnsSettings,
  cfg: XOpsConfig,
  report: PatternReport | null,
  examples: ObservedPost[],
  recent: string[],
  count: number,
  theme?: string
): Promise<DraftedXPost[]> {
  const user = [
    ...brandLines(brand, cfg),
    "",
    report ? `# 伸びている型\n${report.patterns.map((p) => `- ${p.name}：${p.howTo}（${p.fit}）`).join("\n")}` : "# 型：まだ分析していない（一般的に伸びやすい型から選ぶ）",
    report?.ownLearnings.length ? `\n# 自分の投稿の結果から\n${report.ownLearnings.map((l) => `- ${l.finding} → ${l.next}`).join("\n")}` : "",
    examples.length ? `\n# 参考：伸びた投稿（型だけを借りる。文章は写さない）\n${examples.slice(0, 8).map(fmtPost).join("\n")}` : "",
    recent.length ? `\n# 最近の案（重ねない）\n${recent.slice(0, 20).map((t) => `- ${t.slice(0, 60)}`).join("\n")}` : "",
    "",
    `# 今回\n${count}本作る。${theme ? `テーマ: ${theme}` : "テーマは事業内容から選ぶ"}`,
  ]
    .filter((l) => l !== "")
    .join("\n");
  const r = await askJson<{ drafts?: { pattern?: string; body?: string; thread?: unknown[]; hashtags?: unknown[]; image?: { prompt?: string; alt?: string } | null; reason?: string }[] }>(DRAFT_SYSTEM, user, {
    maxTokens: 5000,
    timeoutMs: 150_000,
  });
  const s = (v: unknown, n: number) => normalizeJapanese(String(v ?? "").trim()).slice(0, n);
  const drafts = (Array.isArray(r.drafts) ? r.drafts : [])
    .map((d) => ({
      pattern: s(d.pattern, 40),
      body: s(d.body, 400),
      thread: (Array.isArray(d.thread) ? d.thread : []).map((t) => s(t, 400)).filter(Boolean).slice(0, 4),
      hashtags: (Array.isArray(d.hashtags) ? d.hashtags : []).map((h) => s(h, 30).replace(/^#/, "")).filter(Boolean).slice(0, 2),
      image: d.image && d.image.prompt ? { prompt: String(d.image.prompt).slice(0, 600), alt: s(d.image.alt, 80) } : null,
      reason: s(d.reason, 120),
    }))
    .filter((d) => d.body)
    .slice(0, Math.max(1, Math.min(10, count)));
  const guards = await guardMany(drafts.map((d) => [d.body, ...d.thread]), brand.industry);
  return drafts.map((d, i) => ({ ...d, guard: guards[i], warnings: lengthWarnings(d.body, d.thread, d.hashtags) }));
}

export function lengthWarnings(body: string, thread: string[], hashtags: string[] = []): string[] {
  const w: string[] = [];
  const tags = hashtags.length ? ` ${hashtags.map((h) => `#${h}`).join(" ")}` : "";
  if (xWeightedLength(body + tags) > 280) w.push("本文が X の上限（全角140字）を超えています");
  thread.forEach((t, i) => {
    if (xWeightedLength(t) > 280) w.push(`続き${i + 1}が X の上限（全角140字）を超えています`);
  });
  return w;
}

// ── 反応（リプライ・引用・リポスト） ─────────────────────

export type DraftedEngage = { externalId: string; action: "reply" | "quote" | "repost"; text: string; reason: string; guard: GuardVerdict };

const ENGAGE_SYSTEM = `あなたは日本の X 運用の担当者です。話題の投稿・伸びているアカウントの投稿の中から、自社アカウントが反応すると良いものを選び、反応の仕方を勧めます。
- action は reply（リプライ：役に立つ補足・経験・質問）、quote（引用：自社の視点を足して紹介）、repost（そのまま共有：自社の読者に役立つもの）のどれか
- 宣伝・売り込み・自社 URL の貼り付けはしない。相手の投稿に価値を足すことだけを書く。相手を否定しない
- 炎上・政治・宗教・個人攻撃・センシティブな話題には反応しない（選ばない）
- reply / quote の text は全角120字以内。repost は text を空にする
${RULES}

出力: {"items":[{"id":"投稿のID","action":"reply","text":"本文","reason":"なぜこの投稿にこの反応か（60字以内）"}]}`;

export async function suggestEngagements(brand: SnsSettings, cfg: XOpsConfig, candidates: ObservedPost[], count: number): Promise<DraftedEngage[]> {
  if (!candidates.length) return [];
  const user = [...brandLines(brand, cfg), "", `# 候補の投稿（${candidates.length}件）`, ...candidates.slice(0, 40).map(fmtPost), "", `# 今回\n${count}件まで選ぶ`].join("\n");
  const r = await askJson<{ items?: { id?: string; action?: string; text?: string; reason?: string }[] }>(ENGAGE_SYSTEM, user, { maxTokens: 3000, timeoutMs: 120_000 });
  const ids = new Set(candidates.map((c) => c.externalId));
  const s = (v: unknown, n: number) => normalizeJapanese(String(v ?? "").trim()).slice(0, n);
  const items = (Array.isArray(r.items) ? r.items : [])
    .map((i) => ({ externalId: String(i.id ?? ""), action: (["reply", "quote", "repost"].includes(String(i.action)) ? i.action : "reply") as DraftedEngage["action"], text: s(i.text, 300), reason: s(i.reason, 120) }))
    .filter((i) => ids.has(i.externalId) && (i.action === "repost" || i.text))
    .slice(0, count);
  const guards = await guardMany(items.map((i) => [i.text]), brand.industry);
  return items.map((i, k) => ({ ...i, text: i.action === "repost" ? "" : i.text, guard: guards[k] }));
}

// ── DM の返信 ─────────────────────

export type DraftedDm = { conversationId: string; text: string; reason: string; needsHuman: boolean; guard: GuardVerdict; target: OpsTarget };

const DM_SYSTEM = `あなたは日本の事業者の X アカウントの窓口担当です。届いた DM への返信案を作ります。
- 丁寧で短く（全角200字以内）。相手の質問に答え、分からないこと・約束できないこと（価格・日程・個別の判断）は「担当者から改めてご連絡します」とする
- 個人情報（住所・電話・カード番号など）を DM で求めない
- 営業・勧誘・スパムと思われる DM は needsHuman を true にして、返信は空でよい
- クレーム・トラブル・法的な話は needsHuman を true にして、受け止める一文だけの返信案にする
${RULES}

出力: {"items":[{"conversationId":"会話ID","text":"返信案","reason":"判断の理由（40字以内）","needsHuman":false}]}`;

export async function draftDmReplies(brand: SnsSettings, cfg: XOpsConfig, conversations: { conversationId: string; senderName: string; messages: InboxMessage[] }[]): Promise<DraftedDm[]> {
  if (!conversations.length) return [];
  const user = [
    ...brandLines(brand, cfg),
    "",
    ...conversations.slice(0, 15).map((c) => [`## 会話 ${c.conversationId}（相手：${c.senderName}）`, ...c.messages.slice(-6).map((m) => `${m.fromMe ? "自社" : "相手"}: ${m.text.replace(/\s+/g, " ").slice(0, 400)}`)].join("\n")),
  ].join("\n");
  const r = await askJson<{ items?: { conversationId?: string; text?: string; reason?: string; needsHuman?: boolean }[] }>(DM_SYSTEM, user, { maxTokens: 3000, timeoutMs: 120_000 });
  const byId = new Map(conversations.map((c) => [c.conversationId, c]));
  const s = (v: unknown, n: number) => normalizeJapanese(String(v ?? "").trim()).slice(0, n);
  const items = (Array.isArray(r.items) ? r.items : []).filter((i) => byId.has(String(i.conversationId))).map((i) => ({ conversationId: String(i.conversationId), text: s(i.text, 500), reason: s(i.reason, 80), needsHuman: i.needsHuman === true }));
  const guards = await guardMany(items.map((i) => [i.text]), brand.industry);
  return items.map((i, k) => {
    const c = byId.get(i.conversationId)!;
    const last = [...c.messages].reverse().find((m) => !m.fromMe);
    return { ...i, guard: guards[k], target: { conversationId: i.conversationId, senderName: c.senderName, lastMessage: last?.text.slice(0, 300) ?? "" } };
  });
}
