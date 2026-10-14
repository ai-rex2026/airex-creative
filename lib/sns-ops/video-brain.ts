import { askJson } from "../anthropic";
import { checkGuard } from "../guardrail";
import { normalizeJapanese } from "../meo-ops/japanese";
import type { GuardVerdict } from "../types";
import type { PatternReport } from "./ops-types";
import type { SnsSettings } from "./types";
import { CHARS_PER_SEC, FORMAT_SPEC, type Material, type VideoChapter, type VideoPlatform, type VideoScene } from "./video-types";

/**
 * 動画の台本（場面・ナレーション・テロップ・使う素材）を作る。
 * ショートは1回で全部、長尺（YouTube 10〜20分）は「章立て → 章ごとの場面」に分けて、1章ずつ保存しながら作る。
 * どの台本も生成と同時に法令チェックを通す（AGENTS.md）。
 */

const JA = "日本語の文章で通常使う漢字（常用漢字・日本の新字体）だけで書く。中国語の簡体字・繁体字を使わない";
const RULES = `守ること:
- 事実を創作しない。素材・事業の説明に無い数字・実績・受賞・お客様の声・価格を言わない
- 「必ず」「絶対」「No.1」「最高」「業界初」「唯一」など根拠の要る断定・最上級を使わない。効果を約束しない
- 医療・美容・健康食品・金融の効果効能を断定しない。体験談を効果の根拠にしない
- 実在の人物・他社の商品を映す指示をしない
- ${JA}`;

const PLATFORM_HINT: Record<VideoPlatform, string> = {
  tiktok: "TikTok。最初の2秒で手を止めさせる一言（問いかけ・意外な事実）。テンポよく場面を切り替え、最後は「保存」「フォロー」につながる一言",
  instagram: "Instagram リール。最初の2秒で引き、見た目の世界観をそろえる。最後に「保存して見返せる」要点",
  youtube: "YouTube。冒頭30秒で「この動画で分かること」を示し、章ごとに要点→具体例→まとめ。最後にチャンネル登録と関連動画への案内",
};

function brandLines(b: SnsSettings): string[] {
  return [
    `発信者: ${b.brandName || "（未設定）"}`,
    b.brandUrl ? `URL: ${b.brandUrl}` : "",
    b.brandNotes ? `事業内容・強み・NG: ${b.brandNotes.slice(0, 1500)}` : "",
  ].filter(Boolean);
}

function materialLines(ms: Material[]): string[] {
  const visual = ms.filter((m) => m.kind !== "text").slice(0, 60);
  const text = ms.filter((m) => m.kind === "text").slice(0, 15);
  return [
    visual.length ? `# 使える素材（写真・動画。場面に使うなら materialId に ID を入れる）\n${visual.map((m) => `- [${m.id}] ${m.kind === "video" ? "動画" : "写真"}（${m.source}）${m.title || m.body ? `：${(m.title + " " + m.body).trim().slice(0, 80)}` : "：説明なし"}`).join("\n")}` : "# 使える素材：無し（場面は imagePrompt で AI 画像にする）",
    text.length ? `# 事実・データ（台本の根拠に使う。ここに無い事実は言わない）\n${text.map((m) => `- ${m.title ? `${m.title}：` : ""}${m.body.slice(0, 600)}`).join("\n")}` : "",
  ].filter(Boolean);
}

const SCENE_RULES = `場面（scenes）の書き方:
- narration：その場面で読み上げる文（話し言葉）。caption：画面に大きく出すテロップ（全角16字以内。要点だけ）
- materialId：素材を使うときはその ID。使わないときは null にして imagePrompt に英語で画像の説明（写真風の場面・物・雰囲気。文字・看板・ロゴ・画面のスクリーンショット・グラフ・実在の人物は描かせない）
- 同じ素材を続けて使わない`;

type RawScene = { narration?: string; caption?: string; plannedSec?: number; materialId?: string | null; imagePrompt?: string | null };

function toScenes(raw: RawScene[], chapter: number, ids: Set<string>, startKey: number): VideoScene[] {
  const s = (v: unknown, n: number) => normalizeJapanese(String(v ?? "").trim()).slice(0, n);
  return raw
    .map((r, i) => {
      const narration = s(r.narration, 600);
      const mid = r.materialId && ids.has(String(r.materialId)) ? String(r.materialId) : null;
      const prompt = mid ? null : String(r.imagePrompt ?? "").trim().slice(0, 600) || "A calm, clean editorial photo related to the topic, natural light, no people, no text";
      return {
        key: `s${startKey + i}`,
        chapter,
        narration,
        caption: s(r.caption, 40),
        plannedSec: Math.max(2, Math.min(20, Number(r.plannedSec) || Math.ceil(Array.from(narration).length / CHARS_PER_SEC) || 4)),
        materialId: mid,
        imagePrompt: prompt,
        imagePath: null,
        audioPath: null,
        audioSec: null,
      } satisfies VideoScene;
    })
    .filter((x) => x.narration || x.caption);
}

async function guardScenes(title: string, scenes: VideoScene[], industry: SnsSettings["industry"]): Promise<GuardVerdict> {
  const texts = [title, ...scenes.map((s) => `${s.caption}\n${s.narration}`)].filter(Boolean);
  // 長い台本は分けて通す（AI の指摘は1回で数件までなので、まとめると見落とす）
  const chunks: string[][] = [];
  for (let i = 0; i < texts.length; i += 12) chunks.push(texts.slice(i, i + 12));
  const settled = await Promise.allSettled(chunks.map((c) => checkGuard(c, industry)));
  const hits = settled.flatMap((r) => (r.status === "fulfilled" ? r.value.hits : [{ text: "", reason: "表現チェックを一部実行できませんでした。内容を確認してから承認してください", law: "", suggestion: "", severity: "medium" as const }]));
  const level = settled.some((r) => r.status === "fulfilled" && r.value.level === "red") ? "red" : hits.some((h) => h.severity === "medium" || h.severity === "high") ? "yellow" : "green";
  return { level, hits };
}

export type ShortScript = { title: string; description: string; hashtags: string[]; scenes: VideoScene[]; pattern: string; reason: string; guard: GuardVerdict };

const SHORT_SYSTEM = (platform: VideoPlatform) => `あなたは日本の ${platform === "tiktok" ? "TikTok" : platform === "instagram" ? "Instagram リール" : "YouTube ショート"} の構成作家です。縦型の短い動画の台本を作ります。
- 媒体: ${PLATFORM_HINT[platform]}
- 長さは合計${FORMAT_SPEC.short.minSec}〜${FORMAT_SPEC.short.maxSec}秒。場面は5〜8個（1場面3〜5秒）。ナレーションは合計${Math.round(FORMAT_SPEC.short.minSec * CHARS_PER_SEC)}〜${Math.round(FORMAT_SPEC.short.maxSec * CHARS_PER_SEC)}字
${SCENE_RULES}
${RULES}

出力: {"title":"動画のタイトル（キャプションの1行目）","description":"説明文（150字以内）","hashtags":["3〜5個。#なし"],"pattern":"使った型","reason":"この動画で狙うこと（60字以内）","scenes":[{"narration":"","caption":"","plannedSec":4,"materialId":null,"imagePrompt":"English description"}]}`;

export async function scriptShort(platform: VideoPlatform, brand: SnsSettings, report: PatternReport | null, materials: Material[], theme: string): Promise<ShortScript> {
  const user = [
    ...brandLines(brand),
    report ? `\n# この媒体で伸びている型\n${report.patterns.map((p) => `- ${p.name}：${p.howTo}`).join("\n")}` : "",
    report?.ownLearnings.length ? `# 自分の投稿の結果から\n${report.ownLearnings.map((l) => `- ${l.finding} → ${l.next}`).join("\n")}` : "",
    "",
    ...materialLines(materials),
    "",
    `# 今回のテーマ\n${theme || "事業内容から、見込み客が保存したくなるテーマを選ぶ"}`,
  ]
    .filter((l) => l !== "")
    .join("\n");
  const r = await askJson<{ title?: string; description?: string; hashtags?: unknown[]; pattern?: string; reason?: string; scenes?: RawScene[] }>(SHORT_SYSTEM(platform), user, { maxTokens: 3500, timeoutMs: 150_000 });
  const ids = new Set(materials.map((m) => m.id));
  const scenes = toScenes(Array.isArray(r.scenes) ? r.scenes.slice(0, 10) : [], 0, ids, 1);
  if (scenes.length < 3) throw new Error("台本を作れませんでした。テーマか事業内容を足してもう一度お試しください");
  const s = (v: unknown, n: number) => normalizeJapanese(String(v ?? "").trim()).slice(0, n);
  const title = s(r.title, 100) || theme.slice(0, 60);
  return {
    title,
    description: s(r.description, 600),
    hashtags: (Array.isArray(r.hashtags) ? r.hashtags : []).map((h) => s(h, 30).replace(/^#/, "")).filter(Boolean).slice(0, 5),
    scenes,
    pattern: s(r.pattern, 40),
    reason: s(r.reason, 120),
    guard: await guardScenes(title, scenes, brand.industry),
  };
}

export type LongOutline = { title: string; description: string; hashtags: string[]; chapters: VideoChapter[]; pattern: string; reason: string };

const OUTLINE_SYSTEM = `あなたは日本の YouTube の構成作家です。${FORMAT_SPEC.long.minSec / 60}〜${FORMAT_SPEC.long.maxSec / 60}分の解説動画の章立てを作ります。
- ${PLATFORM_HINT.youtube}
- 章は5〜8個。各章の分数（minutes）の合計が10〜20分になるようにする。1章目は「導入（この動画で分かること）」、最後は「まとめと次の行動」
- タイトルは検索されやすい言葉を含め、内容を誇張しない（全角40字以内）
- 説明文は動画の要約（300字以内）。目次はこちらで付けるので書かない
${RULES}

出力: {"title":"","description":"","hashtags":["3個まで。#なし"],"pattern":"使った型","reason":"この動画で狙うこと（60字以内）","chapters":[{"title":"章の見出し","points":["話す要点"],"minutes":2}]}`;

export async function outlineLong(brand: SnsSettings, report: PatternReport | null, materials: Material[], theme: string, targetMinutes: number): Promise<LongOutline> {
  const user = [
    ...brandLines(brand),
    report ? `\n# YouTube で伸びている型\n${report.patterns.map((p) => `- ${p.name}：${p.howTo}`).join("\n")}` : "",
    "",
    ...materialLines(materials).slice(1),
    "",
    `# 今回\nテーマ：${theme || "事業内容から、見込み客が検索しそうな悩みを選ぶ"}\n長さ：${targetMinutes}分前後`,
  ]
    .filter((l) => l !== "")
    .join("\n");
  const r = await askJson<{ title?: string; description?: string; hashtags?: unknown[]; pattern?: string; reason?: string; chapters?: { title?: string; points?: unknown[]; minutes?: number }[] }>(OUTLINE_SYSTEM, user, { maxTokens: 3000, timeoutMs: 120_000 });
  const s = (v: unknown, n: number) => normalizeJapanese(String(v ?? "").trim()).slice(0, n);
  const chapters = (Array.isArray(r.chapters) ? r.chapters : [])
    .map((c) => ({ title: s(c.title, 60), points: (Array.isArray(c.points) ? c.points : []).map((p) => s(p, 120)).filter(Boolean).slice(0, 6), minutes: Math.max(1, Math.min(6, Number(c.minutes) || 2)) }))
    .filter((c) => c.title)
    .slice(0, 9);
  if (chapters.length < 3) throw new Error("章立てを作れませんでした。テーマを変えてもう一度お試しください");
  return { title: s(r.title, 100) || theme.slice(0, 60), description: s(r.description, 1200), hashtags: (Array.isArray(r.hashtags) ? r.hashtags : []).map((h) => s(h, 30).replace(/^#/, "")).filter(Boolean).slice(0, 3), chapters, pattern: s(r.pattern, 40), reason: s(r.reason, 120) };
}

const CHAPTER_SYSTEM = `あなたは日本の YouTube の構成作家です。章立ての1章分の場面（scenes）を書きます。
- ${PLATFORM_HINT.youtube}
- 1場面は6〜12秒（ナレーション30〜65字）。章の分数に合わせて場面の数を決める（1分＝6〜8場面）
- 前の章からの流れを受けて、要点→具体例→小まとめの順に話す。同じことを繰り返さない
${SCENE_RULES}
${RULES}

出力: {"scenes":[{"narration":"","caption":"","plannedSec":8,"materialId":null,"imagePrompt":"English description"}]}`;

export async function chapterScenes(brand: SnsSettings, outline: LongOutline | { title: string; chapters: VideoChapter[] }, idx: number, materials: Material[], startKey: number, industry: SnsSettings["industry"]): Promise<{ scenes: VideoScene[]; guard: GuardVerdict }> {
  const ch = outline.chapters[idx];
  const user = [
    ...brandLines(brand),
    "",
    `# 動画のタイトル：${outline.title}`,
    `# 章立て\n${outline.chapters.map((c, i) => `${i === idx ? "▶" : " "} ${i + 1}. ${c.title}（${c.minutes}分）`).join("\n")}`,
    `\n# 今回書く章：${idx + 1}. ${ch.title}（${ch.minutes}分）\n要点：${ch.points.join(" / ")}`,
    "",
    ...materialLines(materials),
  ].join("\n");
  const r = await askJson<{ scenes?: RawScene[] }>(CHAPTER_SYSTEM, user, { maxTokens: 6000, timeoutMs: 150_000 });
  const ids = new Set(materials.map((m) => m.id));
  const scenes = toScenes(Array.isArray(r.scenes) ? r.scenes.slice(0, 60) : [], idx, ids, startKey);
  if (scenes.length < 2) throw new Error(`第${idx + 1}章の場面を作れませんでした`);
  return { scenes, guard: await guardScenes(ch.title, scenes, industry) };
}

/** YouTube の説明文の目次（実際の場面の長さから、コードで計算する） */
export function chapterTimestamps(chapters: VideoChapter[], scenes: { chapter: number; sec: number }[]): string {
  const starts = new Map<number, number>();
  let t = 0;
  for (const s of scenes) {
    if (!starts.has(s.chapter)) starts.set(s.chapter, t);
    t += s.sec;
  }
  const fmt = (sec: number) => {
    const m = Math.floor(sec / 60);
    const ss = Math.floor(sec % 60);
    const h = Math.floor(m / 60);
    return h ? `${h}:${String(m % 60).padStart(2, "0")}:${String(ss).padStart(2, "0")}` : `${m}:${String(ss).padStart(2, "0")}`;
  };
  return chapters.map((c, i) => (starts.has(i) ? `${fmt(i === 0 ? 0 : starts.get(i)!)} ${c.title}` : "")).filter(Boolean).join("\n");
}
