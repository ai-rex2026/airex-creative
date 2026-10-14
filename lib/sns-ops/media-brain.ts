import { askJson } from "../anthropic";
import { checkGuard } from "../guardrail";
import { normalizeJapanese } from "../meo-ops/japanese";
import type { GuardVerdict } from "../types";
import type { ObservedPost, PatternReport, XPattern } from "./ops-types";
import type { SnsSettings } from "./types";
import type { Material } from "./video-types";

/**
 * Instagram・TikTok・YouTube の AI：伸びた型の分析（媒体ごとのアルゴリズムの違いを前提に）・
 * Instagram のフィード投稿案・コメントへの返信案。数はコードで計算し、AI は言葉と案だけ。
 */

export type MediaPlatform = "instagram" | "tiktok" | "youtube";

const JA = "日本語の文章で通常使う漢字（常用漢字・日本の新字体）だけで書く。中国語の簡体字・繁体字を使わない";
const RULES = `守ること:
- 事実を創作しない。与えられていない数字・実績・受賞・お客様の声・価格を書かない
- 「必ず」「絶対」「No.1」「最高」「業界初」「唯一」など根拠の要る断定・最上級を使わない。効果を約束しない
- 医療・美容・健康食品・金融の効果効能を断定しない
- 他人の投稿をそのまま写さない（型だけを借りる）
- ${JA}`;

const ALGO: Record<MediaPlatform, string> = {
  instagram: "Instagram：保存・シェア・最後まで見られたか（リール）が効く。発見タブ・リールタブに出るには、最初の1秒の引きと、保存したくなる情報の密度。フィードはカルーセルで要点を順に見せる型が伸びやすい",
  tiktok: "TikTok：フォロワー数より、最後まで見られた割合・繰り返し再生・コメント・シェアで「おすすめ」に広がる。最初の2秒の一言と、テンポ、続きが気になる終わり方",
  youtube: "YouTube：クリック率（タイトル・サムネイル）と視聴維持率・総再生時間が効く。検索される言葉をタイトルに入れ、冒頭30秒で離脱させない構成、章立て",
};

const fmt = (p: ObservedPost) =>
  `[${p.externalId}] @${p.author}${p.authorFollowers ? `（フォロワー${p.authorFollowers}）` : ""} 再生/表示${p.views ?? "?"}・いいね${p.likes ?? "?"}・コメント${p.replies ?? "?"}${p.reposts !== null ? `・シェア${p.reposts}` : ""}${p.bookmarks !== null ? `・保存${p.bookmarks}` : ""}・反応率${p.rate ?? "?"}%\n${p.text.replace(/\s+/g, " ").slice(0, 300)}`;

export async function analyzeMediaPatterns(platform: MediaPlatform, brand: SnsSettings, observed: ObservedPost[]): Promise<Omit<PatternReport, "id" | "createdAt">> {
  const others = observed.filter((p) => p.source !== "own").sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0));
  const own = observed.filter((p) => p.source === "own").sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0));
  if (others.length < 3 && own.length < 3) throw new Error("分析する投稿が足りません。先に「伸びているアカウント」を登録して集めてください");
  const system = `あなたは日本の SNS 運用の責任者です。${ALGO[platform]}
伸びている投稿と、自分のアカウントの投稿の結果を読み、再現できる「型」を取り出します。
- 型は、冒頭の引き・構成・長さ・テロップや見出しの出し方・終わり方・投稿の頻度など、真似できる形で書く
- 「なぜ伸びていそうか」は見立てとして書く（断定しない）
- 自分の投稿は、反応が良かったものと悪かったものの差から、次に何を変えるかを書く
${RULES}

出力: {"summary":"いま伸びている型の要点（200字以内）","patterns":[{"name":"型の名前（20字以内）","howTo":"どう作るか","why":"伸びていそうな理由","examples":["根拠にした投稿のID"],"fit":"自社で使うなら"}],"ownLearnings":[{"finding":"","evidence":"","next":""}]}`;
  const user = [
    `発信者: ${brand.brandName}${brand.brandNotes ? `（${brand.brandNotes.slice(0, 600)}）` : ""}`,
    "",
    `# 伸びている投稿（反応率の高い順）`,
    ...others.slice(0, 30).map(fmt),
    "",
    own.length ? "# 自分の投稿（反応率の高い順）" : "# 自分の投稿：まだ無い",
    ...own.slice(0, 20).map(fmt),
  ].join("\n");
  const r = await askJson<{ summary?: string; patterns?: Partial<XPattern>[]; ownLearnings?: { finding?: string; evidence?: string; next?: string }[] }>(system, user, { maxTokens: 4000, timeoutMs: 150_000 });
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

export type IgPostDraft = { pattern: string; caption: string; hashtags: string[]; slides: { materialId: string | null; prompt: string | null; alt: string }[]; reason: string; guard: GuardVerdict };

/** Instagram のフィード投稿案（1〜5枚のカルーセル。日本語の見出しは画像に入れない＝キャプションで伝える） */
export async function draftIgPosts(brand: SnsSettings, report: PatternReport | null, materials: Material[], recent: string[], count: number, theme?: string): Promise<IgPostDraft[]> {
  const visuals = materials.filter((m) => m.kind === "image").slice(0, 50);
  const system = `あなたは日本の Instagram 運用の担当者です。${ALGO.instagram}
フィード投稿案（1〜5枚の写真のカルーセル＋キャプション）を作ります。
- キャプションは1行目で引き、改行で読みやすく、最後に保存・プロフィールへの案内。全角600字以内
- 写真は素材があれば materialId、無ければ prompt に英語で写真の説明（文字・看板・ロゴ・実在の人物は描かせない）
- ハッシュタグは5〜10個（#なし）。最近の案と同じ話題にしない
${RULES}

出力: {"posts":[{"pattern":"使った型","caption":"","hashtags":[],"slides":[{"materialId":null,"prompt":"English description","alt":"日本語の代替テキスト"}],"reason":"狙い（60字以内）"}]}`;
  const user = [
    `発信者: ${brand.brandName}${brand.brandNotes ? `（${brand.brandNotes.slice(0, 1200)}）` : ""}`,
    report ? `\n# 伸びている型\n${report.patterns.map((p) => `- ${p.name}：${p.howTo}`).join("\n")}` : "",
    visuals.length ? `\n# 使える写真\n${visuals.map((m) => `- [${m.id}] ${(m.title + " " + m.body).trim().slice(0, 80) || "説明なし"}`).join("\n")}` : "",
    materials.some((m) => m.kind === "text") ? `\n# 事実・データ\n${materials.filter((m) => m.kind === "text").slice(0, 10).map((m) => `- ${m.title}：${m.body.slice(0, 400)}`).join("\n")}` : "",
    recent.length ? `\n# 最近の案（重ねない）\n${recent.slice(0, 15).map((t) => `- ${t.slice(0, 50)}`).join("\n")}` : "",
    `\n# 今回\n${count}本。${theme ? `テーマ：${theme}` : ""}`,
  ]
    .filter(Boolean)
    .join("\n");
  const r = await askJson<{ posts?: { pattern?: string; caption?: string; hashtags?: unknown[]; slides?: { materialId?: string | null; prompt?: string | null; alt?: string }[]; reason?: string }[] }>(system, user, { maxTokens: 5000, timeoutMs: 150_000 });
  const ids = new Set(visuals.map((m) => m.id));
  const s = (v: unknown, n: number) => normalizeJapanese(String(v ?? "").trim()).slice(0, n);
  const posts = (Array.isArray(r.posts) ? r.posts : [])
    .map((p) => ({
      pattern: s(p.pattern, 40),
      caption: s(p.caption, 2000),
      hashtags: (Array.isArray(p.hashtags) ? p.hashtags : []).map((h) => s(h, 30).replace(/^#/, "")).filter(Boolean).slice(0, 15),
      slides: (Array.isArray(p.slides) ? p.slides : [])
        .map((x) => ({ materialId: x.materialId && ids.has(String(x.materialId)) ? String(x.materialId) : null, prompt: x.materialId && ids.has(String(x.materialId)) ? null : String(x.prompt ?? "").slice(0, 600) || null, alt: s(x.alt, 80) }))
        .filter((x) => x.materialId || x.prompt)
        .slice(0, 5),
      reason: s(p.reason, 120),
    }))
    .filter((p) => p.caption && p.slides.length)
    .slice(0, Math.max(1, Math.min(5, count)));
  const guards = await Promise.allSettled(posts.map((p) => checkGuard([p.caption], brand.industry)));
  return posts.map((p, i) => ({ ...p, guard: guards[i].status === "fulfilled" ? guards[i].value : { level: "yellow", hits: [{ text: "", reason: "表現チェックを実行できませんでした。内容を確認してから承認してください", law: "", suggestion: "", severity: "medium" }] } }));
}

export type CommentDraft = { commentId: string; text: string; reason: string; needsHuman: boolean; guard: GuardVerdict };

/** 自分の投稿・動画についたコメントへの返信案 */
export async function draftCommentReplies(platform: "instagram" | "youtube", brand: SnsSettings, comments: { id: string; text: string; author: string; context: string }[]): Promise<CommentDraft[]> {
  if (!comments.length) return [];
  const system = `あなたは日本の事業者の ${platform === "youtube" ? "YouTube チャンネル" : "Instagram アカウント"}の担当者です。自分の投稿についたコメントへの返信案を作ります。
- 短く（全角80字以内）、感謝と、質問には答えを。分からないこと・約束できないこと（価格・日程・個別の判断）は「DM／お問い合わせから」と案内する
- スパム・誹謗中傷・荒らしには返信しない（needsHuman を true、text は空）。クレームは needsHuman を true にして、受け止める一文だけ
${RULES}

出力: {"items":[{"id":"コメントのID","text":"返信","reason":"判断の理由（30字以内）","needsHuman":false}]}`;
  const user = [`発信者: ${brand.brandName}${brand.brandNotes ? `（${brand.brandNotes.slice(0, 800)}）` : ""}`, "", ...comments.slice(0, 30).map((c) => `[${c.id}] ${c.author}：${c.text.slice(0, 300)}（投稿：${c.context.slice(0, 60)}）`)].join("\n");
  const r = await askJson<{ items?: { id?: string; text?: string; reason?: string; needsHuman?: boolean }[] }>(system, user, { maxTokens: 3000, timeoutMs: 120_000 });
  const ids = new Set(comments.map((c) => c.id));
  const s = (v: unknown, n: number) => normalizeJapanese(String(v ?? "").trim()).slice(0, n);
  const items = (Array.isArray(r.items) ? r.items : []).filter((i) => ids.has(String(i.id))).map((i) => ({ commentId: String(i.id), text: s(i.text, 300), reason: s(i.reason, 60), needsHuman: i.needsHuman === true }));
  const guards = await Promise.allSettled(items.map((i) => (i.text ? checkGuard([i.text], brand.industry) : Promise.resolve<GuardVerdict>({ level: "green", hits: [] }))));
  return items.map((i, k) => ({ ...i, guard: guards[k].status === "fulfilled" ? guards[k].value : { level: "yellow", hits: [] } }));
}
