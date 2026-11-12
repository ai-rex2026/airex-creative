import { askJsonWithImages } from "../anthropic";
import type { BannerReview } from "./types";

/**
 * 出来上がったバナー（PNG）を AI に見せて点数と直し方を出す（2026-11-12・F）。
 * 見る観点は、成果の出るバナーの共通点（Google・LINEヤフーの公式ガイド、事例分析）から。
 * 1枚につき AI 1回。結果は呼び出し側が banner_projects.reviews に保存する。
 */

const SYSTEM = `あなたは日本の広告代理店のクリエイティブディレクターです。完成したバナー画像を1枚見て、出稿前の品質チェックをします。
観点（各項目を ok/NG で判定し、NG なら理由を1文で）:
1. 1秒で伝わる：スマホで一瞬見ただけで、何の広告で何を言いたいか分かるか
2. メッセージは1つ：言いたいことが散らばっていないか、要素を詰め込みすぎていないか
3. 強弱：いちばん大きい要素が、いちばん伝えたいこと（見出し・数字・特典）になっているか
4. 主役：商品・人などの主役が十分大きく、文字と重なっていないか
5. 読みやすさ：文字と背景の対比が十分か、表示サイズで文字が小さすぎないか
6. CTA：行動を促すボタンがあり、ほかの要素から際立っているか
7. 絵の質：不自然な合成・崩れた手や顔・紛れ込んだ文字・低解像度がないか
8. 信頼：提供元（ロゴやブランド名）が分かるか
9. 表現：誇大・断定・最上級など、広告の表現として危うい言い回しがないか

score は 0〜100（出稿して問題ないなら70以上）。100点や0点は付けない。
fixes は直し方を最大4つ、具体的に（例：「見出しを1行に縮め、文字を1.3倍に」）。日本語。

出力: {"score":72,"checks":[{"item":"1秒で伝わる","ok":true,"note":""}],"fixes":[""]}`;

export type ReviewDeps = { askImage: (system: string, user: string, image: { media: string; base64: string }) => Promise<unknown> };

const VISION_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

export const defaultReviewDeps = (): ReviewDeps => ({
  askImage: (s, u, im) => askJsonWithImages(s, u, [im], { maxTokens: 1500, timeoutMs: 90_000, model: VISION_MODEL, forceAnthropic: true }),
});

export async function reviewBanner(
  image: { media: string; base64: string },
  meta: { size: string; w: number; h: number; archetype: string; brand: string },
  deps: ReviewDeps = defaultReviewDeps()
): Promise<BannerReview> {
  const user = `媒体・サイズ: ${meta.size}（実寸 ${meta.w}×${meta.h}px。画像は縮小している場合があります）
訴求の型: ${meta.archetype}
ブランド: ${meta.brand}`;
  const raw = (await deps.askImage(SYSTEM, user, image)) as { score?: unknown; checks?: unknown; fixes?: unknown };
  const score = Math.max(1, Math.min(99, Math.round(Number(raw?.score) || 0)));
  const checks = (Array.isArray(raw?.checks) ? raw.checks : [])
    .map((c) => c as { item?: unknown; ok?: unknown; note?: unknown })
    .filter((c) => c.item)
    .slice(0, 12)
    .map((c) => ({ item: String(c.item).slice(0, 30), ok: c.ok === true, note: String(c.note ?? "").slice(0, 120) }));
  const fixes = (Array.isArray(raw?.fixes) ? raw.fixes : []).map((f) => String(f).slice(0, 120)).filter(Boolean).slice(0, 4);
  if (!checks.length) throw new Error("チェック結果を読めませんでした");
  return { score, checks, fixes, at: new Date().toISOString() };
}
