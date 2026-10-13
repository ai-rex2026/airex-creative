import { askJson } from "../anthropic";
import { checkGuard } from "../guardrail";
import { normalizeJapanese } from "../meo-ops/japanese";
import { fetchSiteSummary } from "../meo-ops/writer";
import type { SnsPlatform } from "../social-connect/platforms";
import type { GuardVerdict } from "../types";
import { PLATFORM_STYLE, type SnsSettings } from "./types";

/**
 * SNS投稿案の生成。1つのテーマから、連携している媒体ごとに文面を変えて作る
 * （同じ文章を全媒体に流さない：2026-10-13 のミーティングで決めた方針）。
 * どの案も生成と同時に法令チェックを通し、指摘を一緒に返す（AGENTS.md の決めごと）。
 */

const JA_ONLY_RULE = "- 日本語の文章で通常使う漢字（常用漢字・日本の新字体）だけで書く。中国語の簡体字・繁体字は使わない";

const SYSTEM = `あなたは日本の企業・店舗の公式SNSアカウントを運用する担当者です。
与えられたテーマと事業の前提から、媒体ごとに文面を変えた投稿案を作ります。

守ること:
- 媒体ごとに体裁と長さを変える（同じ文章の使い回しにしない）。各媒体の制約は入力に書いてある
- 事実を創作しない。与えられていない数字・実績・受賞・日付・価格を書かない
- 「必ず」「絶対」「No.1」「最高」「業界初」など、根拠の要る断定・最上級の表現は使わない
- 医療・美容・健康食品・金融に関わる効果効能の断定をしない
- 読み手が次に何をすればよいか（見る・来る・問い合わせる 等）を一言入れる
- 絵文字は使っても1〜2個まで。記号の多用はしない
${JA_ONLY_RULE}

出力: {"posts":[{"platform":"x|meta|tiktok","body":"本文（ハッシュタグは含めない）","hashtags":["タグ1","タグ2"]}]}`;

export type SnsDraft = { platform: SnsPlatform; body: string; hashtags: string[]; guard: GuardVerdict };

function facts(settings: SnsSettings, site: string) {
  return [
    settings.brandName ? `事業者名: ${settings.brandName}` : "",
    settings.brandUrl ? `Webサイト: ${settings.brandUrl}` : "",
    settings.brandNotes ? `事業の前提（内容・強み・NG事項）: ${settings.brandNotes.slice(0, 1200)}` : "",
    site ? `Webサイトの見出し: ${site}` : "",
  ].filter(Boolean);
}

/** テーマから媒体ごとの投稿案を作る。platforms は連携済みの媒体だけを渡す */
export async function draftSnsPosts(topic: string, platforms: SnsPlatform[], settings: SnsSettings): Promise<SnsDraft[]> {
  if (!platforms.length) throw new Error("連携済みの媒体がありません");
  const site = await fetchSiteSummary(settings.brandUrl || null);
  const lines = [
    `# テーマ`,
    topic.trim().slice(0, 600),
    "",
    "# 事業の前提",
    ...facts(settings, site),
    "",
    "# 作る媒体とその制約",
    ...platforms.map((p) => `- ${p}: ${PLATFORM_STYLE[p].name}。${PLATFORM_STYLE[p].hint}（本文は${PLATFORM_STYLE[p].maxChars}字以内）`),
  ];
  const res = await askJson<{ posts?: { platform?: string; body?: string; hashtags?: unknown }[] }>(SYSTEM, lines.join("\n"), {
    maxTokens: 2500,
    timeoutMs: 90_000,
  });

  const wanted = new Set(platforms);
  const drafts: SnsDraft[] = [];
  for (const p of res.posts ?? []) {
    const platform = String(p.platform ?? "") as SnsPlatform;
    if (!wanted.has(platform) || drafts.some((d) => d.platform === platform)) continue;
    const body = normalizeJapanese(String(p.body ?? "").trim()).slice(0, PLATFORM_STYLE[platform].maxChars);
    if (!body) continue;
    const hashtags = (Array.isArray(p.hashtags) ? p.hashtags : [])
      .map((h) => String(h ?? "").trim().replace(/^#/, "").replace(/\s+/g, ""))
      .filter(Boolean)
      .slice(0, 10);
    // 法令チェックは生成と同時に（辞書＋AI）。AI が落ちても辞書判定は返る
    const guard = await checkGuard([body], settings.industry);
    drafts.push({ platform, body, hashtags, guard });
  }
  if (!drafts.length) throw new Error("投稿案を作れませんでした。テーマを具体的にしてもう一度お試しください");
  return drafts;
}

const TOPIC_SYSTEM = `あなたは日本の企業・店舗の公式SNSの編集担当です。
事業の前提と最近の投稿テーマを見て、次の週に投稿するテーマを1つ提案します。
最近のテーマと重ならないもの、季節・時期に合うもの、事業の強みが伝わるものを選びます。
事実を創作しない（与えられていないキャンペーンや実績を前提にしない）。

出力: {"topic":"テーマ（80字以内。何を伝える投稿か）","reason":"そう選んだ理由（60字以内）"}`;

/** 週1の自動生成で使うテーマを AI に決めさせる。recentTopics は重複を避けるために渡す */
export async function suggestWeeklyTopic(settings: SnsSettings, recentTopics: string[]): Promise<{ topic: string; reason: string }> {
  const site = await fetchSiteSummary(settings.brandUrl || null);
  const today = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric" }).format(new Date());
  const lines = [`今日: ${today}`, "", "# 事業の前提", ...facts(settings, site), "", "# 最近の投稿テーマ", ...(recentTopics.length ? recentTopics.map((t) => `- ${t}`) : ["（まだない）"])];
  const res = await askJson<{ topic?: string; reason?: string }>(TOPIC_SYSTEM, lines.join("\n"), { maxTokens: 400, timeoutMs: 40_000 });
  const topic = normalizeJapanese(String(res.topic ?? "").trim()).slice(0, 120);
  if (!topic) throw new Error("テーマを決められませんでした");
  return { topic, reason: normalizeJapanese(String(res.reason ?? "").trim()).slice(0, 120) };
}
