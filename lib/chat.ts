import Anthropic from "@anthropic-ai/sdk";
import { checkGuardDict } from "./guardrail";
import { applyEdit, editables, type EditResult } from "./edits";
import type { Analysis } from "./analysis";
import type { GuardHit } from "./types";

/**
 * レポートについての質問応答と、広告原稿の書き換え。
 *
 * 書き換えは edit_copy ツール経由でのみ行う。会話文に新しい原稿を書かせない。
 * 差し替える前に必ずガードレールと文字数を通す（Docs/ai-chat-design.md）。
 * 実測値は書き換え対象に含めない。
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

  const ed = editables(a);
  if (ed.length) {
    lines.push(
      `\n# 書き換えられる原稿（この番号で指定する）\n${ed
        .map((e) => `[${e.id}] ${e.label}${e.limit ? `（上限${e.limit / 2}文字）` : ""}: ${e.text}`)
        .join("\n")}`
    );
  }

  return lines.join("\n");
}

const SYSTEM = `あなたは AI-REX Studio のレポートについて答えるアシスタントです。
質問に答えるほか、**広告原稿の書き換え**ができます。

答えるときに守ること:
- 渡されたレポートの内容だけを根拠に答える。書かれていないことは「レポートには含まれていません」と言う
- 数値を作らない。レポートにある実測値だけを引用する。推測した数字は絶対に出さない
- 効果や結果を断定しない。「必ず」「確実に」「保証」は使わない
- 3〜5文程度。長くしない

書き換えについて:
- 書き換えたいときは edit_copy ツールを使う。会話文の中に新しい原稿を書くだけでは反映されない
- 対象は「書き換えられる原稿」に載っている番号のものだけ。1回のツール呼び出しで1件
- **実測値は書き換えられない**。サイトの検査結果、MEOのスコアと順位、Search Console と GA4 の数値、
  検索サジェストの取得結果は、測って得たものなので変更できない。
  頼まれたら「実測値なので変更できません」と答え、代わりにその数値を実際に良くする方法を答える
- 書き換えた原稿は自動で法令チェックと文字数チェックにかかる。
  通らなかった場合は理由が返るので、それを踏まえて言い換えを提案する
- ツールを使わずに新しいコピーを会話文で書かない。検査を通っていない文言を渡すことになる`

const TOOLS: Anthropic.Tool[] = [
  {
    name: "edit_copy",
    description:
      "レポート内の広告原稿を1件書き換える。実測値（スコア・順位・アクセス数・サジェスト）は書き換えられない。",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "書き換える原稿の番号（例: C1-1、A1-2-H3）" },
        text: { type: "string", description: "新しい文言" },
      },
      required: ["id", "text"],
    },
  },
];

export type ChatAnswer = { text: string; flags: GuardHit[]; edits: EditResult[]; patch: Record<string, unknown> };

export async function askAboutReport(
  a: Analysis,
  history: { role: "user" | "assistant"; content: string }[],
  question: string
): Promise<ChatAnswer> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const system = `${SYSTEM}\n\n---\n以下がレポートの内容です。\n\n${buildContext(a)}`;

  const msgs: Anthropic.MessageParam[] = [
    ...history.slice(-6).map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: question },
  ];

  const edits: EditResult[] = [];
  let patch: Record<string, unknown> = {};
  // 書き換えのたびにレポートが変わるので、その都度反映してから次を判断させる
  let current: Analysis = a;
  let text = "";

  for (let turn = 0; turn < 4; turn++) {
    const res = await client.messages.create(
      { model: MODEL, max_tokens: 1500, system, tools: TOOLS, messages: msgs },
      { timeout: 60_000, maxRetries: 1 }
    );

    text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    const calls = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (calls.length === 0) break;

    msgs.push({ role: "assistant", content: res.content });
    const results: Anthropic.ToolResultBlockParam[] = [];

    for (const call of calls) {
      const { id, text: next } = call.input as { id?: string; text?: string };
      if (!id || typeof next !== "string") {
        results.push({ type: "tool_result", tool_use_id: call.id, content: "番号と本文の両方が要ります", is_error: true });
        continue;
      }
      const { result, patch: p } = await applyEdit(current, id, next);
      edits.push(result);
      if (result.ok) {
        patch = { ...patch, ...p };
        current = { ...current, ...p } as Analysis;
        results.push({ type: "tool_result", tool_use_id: call.id, content: `書き換えました：「${result.before}」→「${result.after}」` });
      } else {
        results.push({ type: "tool_result", tool_use_id: call.id, content: `書き換えできません：${result.reason}`, is_error: true });
      }
    }
    msgs.push({ role: "user", content: results });
  }

  // 会話文にまずい語が混ざっていないか、辞書だけで確認する。AI を使わないので無料
  const flags = a.diagnosis ? checkGuardDict([text], a.diagnosis.industry) : [];

  return { text, flags, edits, patch };
}
