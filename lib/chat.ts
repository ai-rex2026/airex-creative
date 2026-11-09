import Anthropic from "@anthropic-ai/sdk";
import { checkGuardDict } from "./guardrail";
import { applyEdit, editables, type EditResult } from "./edits";
import type { Analysis } from "./analysis";
import type { GuardHit } from "./types";
import { findOwnRank } from "./meo-ops/ai-search";
import { scoreAio } from "./report-aio-types";
import { REBUILD_LABEL, REPORT_SECTIONS, sectionIdOf, sectionLabel, type RebuildProposal, type ReportPrefs } from "./report-sections";

export type { RebuildProposal } from "./report-sections";

/**
 * レポートについての質問応答と、広告原稿の書き換え。
 * 2026-11-09〜：章の表示・非表示（すぐ反映）と、指示つきの作り直しの提案（確認ボタンを押すと実行）もできる。
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

  if (a.aio && !a.aio.skipped) {
    const ok = a.aio.prompts.filter((p) => p.status === "ok");
    lines.push(`\n# AI検索での見え方（AIO）\n照合した名前: ${a.aio.ownNames.join("／") || "なし"}\n${ok.length}問中 ${ok.filter((p) => p.rank != null).length}問で候補に挙がった`);
  }

  const prefs = a.report_prefs ?? {};
  const hidden = new Set(prefs.hidden ?? []);
  lines.push(`\n# レポートの章（id: 見出し・表示状態）\n${REPORT_SECTIONS.map((x) => `${x.id}: ${x.label}${hidden.has(x.id) ? "（非表示）" : ""}`).join("\n")}`);
  if (prefs.directives?.length || prefs.excludeChannels?.length) {
    lines.push(
      `\n# 作り直しの指示（保存済み。以後の作り直しにも効く）\n${[...(prefs.directives ?? []), ...(prefs.excludeChannels?.length ? [`使わない媒体：${prefs.excludeChannels.join("、")}`] : [])].map((x) => `- ${x}`).join("\n")}`
    );
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
質問に答えるほか、次のことができます。
- **広告原稿の書き換え**（edit_copy）
- **章の表示・非表示**（set_sections）。「〇〇を非表示に」「〇〇を出して」と言われたら使う。すぐ反映され、画面と PDF 出力の両方に効く。データは消えない
- **指示つきの作り直し**（propose_rebuild）。「〇〇媒体を除いて再設計して」「〇〇の前提で施策を作り直して」と言われたら使う。
  作り直せるのは ad_plan（広告手法一覧・広告運用設計・広告以外の施策と実行スケジュール。5〜10分）、measures（優先度の高い施策とカテゴリ別評価。1〜2分）、aio（AIO の所見と施策。1分ほど）。
  このツールは**提案を出すだけ**で、利用者が画面のボタンを押すと作り直す。だから「作り直しました」とは言わず「ボタンを押すと作り直します」と言う。
  媒体を外す指示は exclude_channels にも入れる（広告手法一覧から確実に外すため）。指示は以後の作り直しにも効く
- **保存した指示の取り消し**（clear_directives）
- **AIO の照合する名前の変更**（set_aio_names）。「照合した名前を A／B／C にして」と言われたら、言われた名前の一覧をそのまま渡す（足すのでなく置き換える）。
  測ったときの AI の回答に対して照合し直すので、候補に挙がった問いの数と評価はすぐ変わる。AI に問い合わせ直すわけではない。
  所見と施策の文章は古い名前で書いたものなので、続けて propose_rebuild（target=aio）で書き直しのボタンも出す
- 章の中の一部分（公式SNSアカウントの LINEプラン・SNSキャンペーン案・媒体ごとの欄）も set_sections で隠せる（「レポートの章」の sub- で始まる id）
- MEO は、PDF 出力では全店舗の情報を順に出す（画面は選んだ店舗だけ）。全店舗を PDF に出したいと言われたら、そのまま PDF 出力すればよいと案内する
- 「再出力」「出し直し」と言われたら、表示の変更なら set_sections のあと「PDF 出力ボタンで出せます」と案内する。内容を変えたいなら propose_rebuild を使う
- サイトの実測をやり直す・レポート全体を分析し直すことはチャットではできない。必要なら「新規分析で同じ URL を分析し直してください」と案内する

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

/** モデルが <answer> のような囲みを付けてくることがあるので落とす */
function clean(raw: string) {
  return raw
    .replace(/^\s*<answer>\s*/i, "")
    .replace(/\s*<\/answer>\s*$/i, "")
    .trim();
}

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
  {
    name: "set_sections",
    description: "レポートの章を非表示にする／表示に戻す。すぐ反映される。章は「レポートの章」の id で指定する",
    input_schema: {
      type: "object",
      properties: {
        hide: { type: "array", items: { type: "string" }, description: "非表示にする章の id" },
        show: { type: "array", items: { type: "string" }, description: "表示に戻す章の id。all で全部戻す" },
      },
    },
  },
  {
    name: "propose_rebuild",
    description: "指示つきの作り直しを提案する（画面に確認ボタンを出す。押されるまで作り直さない）",
    input_schema: {
      type: "object",
      properties: {
        target: { type: "string", enum: ["ad_plan", "measures", "aio"], description: "ad_plan＝広告手法一覧〜実行スケジュール、measures＝優先度の高い施策、aio＝AIOの所見と施策" },
        instruction: { type: "string", description: "作り直すときに守らせる指示。利用者の言った背景・前提を具体的に1〜3文で" },
        exclude_channels: { type: "array", items: { type: "string" }, description: "広告手法一覧から外す媒体（例：Meta広告、LINE広告）" },
      },
      required: ["target", "instruction"],
    },
  },
  {
    name: "set_aio_names",
    description: "AIO（AI検索での見え方）で自社として照合する名前を置き換え、測ったときの回答に照合し直す（AI には問い合わせ直さない）",
    input_schema: {
      type: "object",
      properties: { names: { type: "array", items: { type: "string" }, description: "照合する名前の一覧（最大8件）" } },
      required: ["names"],
    },
  },
  {
    name: "clear_directives",
    description: "保存済みの作り直しの指示と、外した媒体の指定を消す（次の作り直しから効く）",
    input_schema: { type: "object", properties: {} },
  },
];

export type ChatAnswer = { text: string; flags: GuardHit[]; edits: EditResult[]; patch: Record<string, unknown>; proposals: RebuildProposal[]; prefsChanged: boolean };

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
  const proposals: RebuildProposal[] = [];
  let prefs: ReportPrefs = { ...(a.report_prefs ?? {}) };
  let prefsChanged = false;
  let patch: Record<string, unknown> = {};
  // 書き換えのたびにレポートが変わるので、その都度反映してから次を判断させる
  let current: Analysis = a;
  let text = "";

  for (let turn = 0; turn < 4; turn++) {
    const res = await client.messages.create(
      { model: MODEL, max_tokens: 1500, system, tools: TOOLS, messages: msgs },
      { timeout: 60_000, maxRetries: 1 }
    );

    text = clean(res.content.map((b) => (b.type === "text" ? b.text : "")).join(""));
    const calls = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (calls.length === 0) break;

    msgs.push({ role: "assistant", content: res.content });
    const results: Anthropic.ToolResultBlockParam[] = [];

    for (const call of calls) {
      if (call.name === "set_sections") {
        const inp = call.input as { hide?: unknown; show?: unknown };
        const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
        const showAll = list(inp.show).some((x) => x.trim().toLowerCase() === "all");
        const hide = list(inp.hide).map(sectionIdOf);
        const show = list(inp.show).map(sectionIdOf);
        const unknown = [...list(inp.hide), ...list(inp.show)].filter((x, i, arr) => x.trim().toLowerCase() !== "all" && sectionIdOf(x) === null && arr.indexOf(x) === i);
        const next = new Set(showAll ? [] : prefs.hidden ?? []);
        for (const h of hide) if (h) next.add(h);
        for (const h of show) if (h) next.delete(h);
        prefs = { ...prefs, hidden: [...next] };
        prefsChanged = true;
        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: `いま非表示の章：${prefs.hidden?.length ? prefs.hidden.map(sectionLabel).join("、") : "なし"}${unknown.length ? `。見つからなかった章：${unknown.join("、")}` : ""}`,
        });
        continue;
      }
      if (call.name === "propose_rebuild") {
        const inp = call.input as { target?: unknown; instruction?: unknown; exclude_channels?: unknown };
        const target = inp.target === "ad_plan" || inp.target === "measures" || inp.target === "aio" ? inp.target : null;
        const instruction = typeof inp.instruction === "string" ? inp.instruction.trim().slice(0, 300) : "";
        if (!target || !instruction) {
          results.push({ type: "tool_result", tool_use_id: call.id, content: "target（ad_plan か measures）と instruction が要ります", is_error: true });
          continue;
        }
        const excludeChannels = (Array.isArray(inp.exclude_channels) ? inp.exclude_channels : []).filter((x): x is string => typeof x === "string" && !!x.trim()).slice(0, 8);
        if (!proposals.some((p) => p.target === target)) proposals.push({ target, instruction, excludeChannels });
        results.push({ type: "tool_result", tool_use_id: call.id, content: `画面に「${REBUILD_LABEL[target]}をこの指示で作り直す」ボタンを出しました。押されるまで作り直しません` });
        continue;
      }
      if (call.name === "set_aio_names") {
        const raw = (call.input as { names?: unknown }).names;
        const names = [...new Set((Array.isArray(raw) ? raw : []).map((x) => String(x ?? "").trim().slice(0, 60)).filter(Boolean))].slice(0, 8);
        const aio = (current as Analysis).aio;
        if (!aio || aio.skipped || !aio.prompts.length) {
          results.push({ type: "tool_result", tool_use_id: call.id, content: "このレポートには AIO の実測がありません", is_error: true });
          continue;
        }
        if (!names.length) {
          results.push({ type: "tool_result", tool_use_id: call.id, content: "名前が空です", is_error: true });
          continue;
        }
        const prompts = aio.prompts.map((p) => (p.status === "ok" ? { ...p, rank: findOwnRank(p.listed ?? [], names) } : p));
        const next = { ...aio, ownNames: names, prompts };
        const { score, basis } = scoreAio(next);
        const updated = { ...next, score, basis };
        patch = { ...patch, aio: updated };
        current = { ...current, aio: updated } as Analysis;
        const ok = prompts.filter((p) => p.status === "ok");
        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: `照合する名前を「${names.join("／")}」にして照合し直しました：${ok.length}問中 ${ok.filter((p) => p.rank != null).length}問で候補に挙がった（評価：${score ?? "—"}）。所見と施策の文章はまだ古い名前のままです`,
        });
        continue;
      }
      if (call.name === "clear_directives") {
        prefs = { ...prefs, directives: [], excludeChannels: [] };
        prefsChanged = true;
        results.push({ type: "tool_result", tool_use_id: call.id, content: "保存済みの指示を消しました。次の作り直しから効きます（今の内容は変わりません）" });
        continue;
      }
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

  if (prefsChanged) patch = { ...patch, report_prefs: prefs };
  return { text, flags, edits, patch, proposals, prefsChanged };
}
