import Anthropic from "@anthropic-ai/sdk";
import { checkGuardDict } from "./guardrail";
import type { Analysis } from "./analysis";
import type { GuardHit } from "./types";

/**
 * レポートについての質問応答。
 *
 * この段階では**レポートを書き換えない**。読んで答えるだけ。
 * 書き換えを入れるときは、差し替え後の文言をガードレールに通し直す必要がある
 * （Docs/ai-chat-design.md）。
 */

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

/** レポートの要点だけを渡す。全部渡すと毎回の入力が膨らんで費用が跳ねる */
export function buildContext(a: Analysis): string {
  const d = a.diagnosis;
  const lines: string[] = [];

  lines.push(`# 分析対象\nURL: ${a.url ?? "（テキスト入力）"}`);
  if (d) {
    lines.push(`商材: ${d.product}`);
    lines.push(`ターゲット: ${d.audience}`);
    lines.push(`業種: ${d.industry}`);
    lines.push(`強み: ${d.strengths.join(" / ")}`);
    lines.push(`買わない理由: ${d.objections.join(" / ")}`);
    lines.push(`訴求軸: ${d.angles.map((x) => `${x.name}（${x.why}）`).join(" / ")}`);
  }

  if (a.site) {
    const ng = a.site.headers.filter((h) => !h.pass).map((h) => h.label);
    lines.push(
      `\n# サイトの実測\nHTTPS:${a.site.https ? "対応" : "未対応"} / robots:${a.site.robotsTxt ? "有" : "無"} / sitemap:${a.site.sitemapXml ? "有" : "無"} / 構造化データ:${a.site.structuredData ? "有" : "無"}`
    );
    lines.push(`セキュリティ ${a.site.passed}/${a.site.total} 通過。未設定: ${ng.join("・") || "なし"}`);
    lines.push(`検出した広告タグ: ${a.site.adTags.join("・") || "なし"}`);
    if (a.site.social.length) lines.push(`公式SNS: ${a.site.social.map((s) => `${s.platform}(${s.handle})`).join(" / ")}`);
  }

  if (a.meo?.self) {
    lines.push(
      `\n# MEO（Googleマップ実測）\n${a.meo.self.name} 評価${a.meo.self.rating ?? "—"} / レビュー${a.meo.self.reviews}件 / 近隣${a.meo.totalShops}店中 評価${a.meo.ratingRank}位・レビュー数${a.meo.reviewRank}位（近隣平均 評価${a.meo.avgRating ?? "—"}・レビュー${a.meo.avgReviews ?? "—"}件）。スコア${a.meo.score}/100`
    );
  }

  if (a.gsc?.queries?.length) {
    lines.push(
      `\n# Search Console（直近28日・実測）\n${a.gsc.queries.slice(0, 8).map((q) => `${q.query}: 表示${q.impressions} クリック${q.clicks} 平均${q.position.toFixed(1)}位`).join("\n")}`
    );
  }
  if (a.ga4?.sessions) {
    lines.push(`\n# GA4（実測）\nセッション ${a.ga4.sessions} / ユーザー ${a.ga4.users}`);
  }

  if (a.media_plan?.length) {
    lines.push(`\n# 媒体配分\n${a.media_plan.map((m) => `${m.channel} ${m.share}%（${m.priority}）: ${m.reason}`).join("\n")}`);
  }
  if (a.budget) lines.push(`月間予算の区分: ${a.budget}`);

  if (a.ad_ops?.campaigns?.length) {
    lines.push(
      `\n# 広告運用設計\n${a.ad_ops.campaigns.map((c) => `${c.name}（${c.channel}）: ${(c.groups ?? []).map((g) => g.name).join("・")}`).join("\n")}`
    );
    const ng = a.ad_ops.tags.filter((t) => t.need === "必須" && t.status !== "導入済み");
    if (ng.length) lines.push(`未導入の必須タグ: ${ng.map((t) => `${t.name}(${t.status})`).join("・")}`);
  }

  if (a.keywords?.rows?.length) {
    lines.push(`\n# 対策キーワード\n${a.keywords.rows.slice(0, 12).map((r) => `${r.keyword}（${r.kind}・難易度${r.difficulty}・優先${r.priority}）`).join("\n")}`);
  }
  if (a.suggests?.rows?.length) {
    const risky = a.suggests.rows.filter((r) => r.kind !== "中立");
    lines.push(`\n# 検索サジェスト（実測）\n${a.suggests.rows.map((r) => `${r.suggestion}（${r.kind}）`).join(" / ")}`);
    if (risky.length) lines.push(`要注意: ${risky.map((r) => r.suggestion).join("・")}`);
  }
  if (a.tactics?.items?.length) {
    lines.push(`\n# 広告以外の施策\n${a.tactics.items.map((t) => `${t.area}: ${t.summary}`).join("\n")}`);
  }
  if (a.copies?.length) {
    lines.push(
      `\n# 作ったコピー（法令チェック済み）\n${a.copies.slice(0, 6).map((c) => `「${c.headline.join("")}」${c.guard?.level === "red" ? "【要修正】" : ""}`).join("\n")}`
    );
  }
  if (a.summary) {
    lines.push(`\n# 総評\n${a.summary.overall} / 良い点: ${a.summary.best} / 課題: ${a.summary.worst}`);
  }

  return lines.join("\n");
}

const SYSTEM = `あなたは AI-REX Studio のレポートについて答えるアシスタントです。

守ること:
- 渡されたレポートの内容だけを根拠に答える。書かれていないことは「レポートには含まれていません」と言う
- 数値を作らない。レポートにある実測値だけを引用する。推測した数字は絶対に出さない
- **広告のコピー案・見出し案・キャッチコピーは書かない**。
  求められたら「コピーはレポートの『コピーと法令チェック』で法令検査を通したものを使ってください。
  チャットで作った文言は検査を通っていません」と答える
- 効果や結果を断定しない。「必ず」「確実に」「保証」は使わない
- answers は日本語で、3〜5文程度。長くしない
- レポートを書き換えることはできない。修正依頼には「この画面からは変更できません」と答える`;

export type ChatAnswer = { text: string; flags: GuardHit[] };

export async function askAboutReport(
  a: Analysis,
  history: { role: "user" | "assistant"; content: string }[],
  question: string
): Promise<ChatAnswer> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const res = await client.messages.create(
    {
      model: MODEL,
      max_tokens: 1200,
      system: `${SYSTEM}\n\n---\n以下がレポートの内容です。\n\n${buildContext(a)}`,
      // 直近のやり取りだけを渡す。全部渡すと入力が膨らみ続ける
      messages: [...history.slice(-6), { role: "user" as const, content: question }],
    },
    { timeout: 60_000, maxRetries: 1 }
  );

  const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();

  // 回答に法令上まずい語が混ざっていないか、辞書だけで確認する。
  // AI を通すとチャット1往復ごとに費用がかかるので、無料の辞書で足切りする
  const flags = a.diagnosis ? checkGuardDict([text], a.diagnosis.industry) : [];

  return { text, flags };
}
