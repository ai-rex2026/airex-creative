import { askJson } from "../anthropic";
import { normalizeJapanese } from "../meo-ops/japanese";
import { ownDomainsOf, summarize } from "./prompts";
import { AIO_DRAFT_KINDS, type AioCheck, type AioDraftKind, type AioGapReport, type AioPlanItem, type AioProject, type AioPrompt } from "./types";

/**
 * Gap Analysis（競合にあって自社にない情報を特定）と、月次コンテンツ計画（Content Creation の設計）。
 * どちらも「実測の結果」を材料に AI が考える。数字・実績は与えられたものだけ。公開は人が行う。
 */

const JA_ONLY_RULE = "- 日本語の文章で通常使う漢字（常用漢字・日本の新字体）だけで書く。中国語の簡体字・繁体字は使わない";

function evidenceLines(project: AioProject, prompts: AioPrompt[], checks: AioCheck[]): string[] {
  const s = summarize(project, prompts, checks, ownDomainsOf(project));
  const latestPeriod = s.latest?.period;
  const done = checks.filter((c) => c.status === "completed" && (!latestPeriod || periodOf(c) === latestPeriod)).slice(0, 24);
  const lines: string[] = [];
  if (s.latest) {
    lines.push(`直近期 ${s.latest.period}: 言及率 ${s.latest.mentionRate ?? "–"}%・平均順位 ${s.latest.avgRank ?? "–"}・引用率 ${s.latest.citationRate ?? "–"}%・SoV ${s.latest.sov ?? "–"}%`);
  }
  if (s.competitors.length) lines.push(`AI が多く挙げた事業者: ${s.competitors.map((c) => `${c.name}（${c.mentions}回${c.isOwn ? "・自社" : ""}）`).join(" / ")}`);
  if (s.domains.length) lines.push(`AI が根拠にした媒体: ${s.domains.map((d) => `${d.domain}（${d.count}本${d.isOwn ? "・自社" : ""}）`).join(" / ")}`);
  lines.push("", "# 問いごとの結果");
  for (const c of done) {
    const p = prompts.find((x) => x.id === c.promptId);
    lines.push(
      `- 問い「${p?.text ?? c.prompt.slice(0, 60)}」: ${c.mentioned ? `自社 ${c.rank}番目` : "自社は挙がらず"}。挙がった: ${c.listed.slice(0, 6).join("、") || "（抽出なし）"}。根拠: ${[...new Set(c.citedSources.map((x) => x.domain))].slice(0, 6).join("、") || "なし"}`
    );
  }
  return lines;
}

function periodOf(c: AioCheck): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date(c.completedAt ?? c.createdAt)).slice(0, 7);
}

function facts(project: AioProject): string[] {
  return [
    "# 自社の前提",
    `事業者名: ${project.name}${project.aliases.length ? `（別名: ${project.aliases.join(", ")}）` : ""}`,
    project.url ? `URL: ${project.url}` : "",
    `探し方: ${project.area ? `${project.area}で` : ""}${project.category}`,
    project.notes ? `事業内容・強み: ${project.notes.slice(0, 1500)}` : "",
    project.siteSummary ? `Webサイトの見出し: ${project.siteSummary}` : "",
  ].filter((l) => l !== "");
}

const GAP_SYSTEM = `あなたは日本の企業の AI検索対策（AIO/GEO）コンサルタントです。
実測（AI に問いを投げて、誰が挙がり、何が根拠にされたか）を見て、「競合にはあって自社にはない情報」を特定します。

- gaps は3〜6件。topic は「AI が推薦の根拠にしている情報の種類」（例: 料金の目安が公開されている／第三者の比較記事で取り上げられている／導入事例が業種別にある／口コミサイトに評価がある）
- evidence には、どの問いで・どの競合が・どの媒体を根拠に挙がったかを、与えられた結果からそのまま書く（推測で書かない）
- media は、そのギャップを埋める掲載先（自社サイト／note／PR TIMES／Wantedly／口コミサイト／業界メディア 等）
- idea は、作るべきコンテンツを1行で（タイトル案）
- mediaTargets は、AI が根拠にしていて自社が載っていない媒体を3〜6件。action は「登録する／プレスリリースを配信する／取材を打診する」のように具体的に
- 「必ず上がる」「確実に」など効果の断定はしない
${JA_ONLY_RULE}

出力: {"summary":"全体の所見（200字以内）","gaps":[{"topic":"","evidence":"","media":"","idea":""}],"mediaTargets":[{"domain":"","reason":"","action":""}]}`;

export async function analyzeGap(project: AioProject, prompts: AioPrompt[], checks: AioCheck[]): Promise<Omit<AioGapReport, "id" | "createdAt" | "period">> {
  const done = checks.filter((c) => c.status === "completed");
  if (!done.length) throw new Error("実測の結果がまだありません。先に対策プロンプトを実測してください");
  const lines = [...facts(project), "", "# 実測の結果", ...evidenceLines(project, prompts, checks)];
  const res = await askJson<{ summary?: string; gaps?: Record<string, unknown>[]; mediaTargets?: Record<string, unknown>[] }>(GAP_SYSTEM, lines.join("\n"), { maxTokens: 3000, timeoutMs: 120_000 });
  const str = (v: unknown, n: number) => normalizeJapanese(String(v ?? "").trim()).slice(0, n);
  return {
    summary: str(res.summary, 400),
    gaps: (res.gaps ?? []).slice(0, 6).map((g) => ({ topic: str(g.topic, 120), evidence: str(g.evidence, 400), media: str(g.media, 80), idea: str(g.idea, 120) })).filter((g) => g.topic),
    mediaTargets: (res.mediaTargets ?? []).slice(0, 6).map((m) => ({ domain: str(m.domain, 100), reason: str(m.reason, 200), action: str(m.action, 160) })).filter((m) => m.domain),
  };
}

const KINDS = AIO_DRAFT_KINDS.map((k) => k.kind);

const PLAN_SYSTEM = `あなたは日本の企業の AI検索対策（AIO/GEO）の編集長です。
ギャップ分析と対策プロンプトをもとに、来月に作るコンテンツの計画（8〜10本）を組みます。

- kind は次から選ぶ: site_article（自社サイト記事）/ note_article（note）/ press_release（プレスリリース）/ survey_article（アンケート記事）/ faq_schema（FAQ＋構造化データ）/ wantedly_story（Wantedly・採用）/ job_posting_schema（採用ページの構造化データ）/ listing_memo（掲載先の整理）
- 配分の目安: プレスリリース1本・自社サイト記事2〜3本・note 3〜4本・残りはギャップに合わせて。採用の問いが無ければ wantedly_story / job_posting_schema は入れない
- title は見込み客の検索語を含む具体的なもの。target は「どの問い（対策プロンプト）に答える内容か」を1本選んで書く
- outline は見出し3〜5個を「／」でつないだ1行
- week は 1〜4（公開する週）。プレスリリースは第1週、アンケート記事は設問→回収→記事なので第3週以降
- 数字・実績を作らない。「事業の前提」に無い数字をタイトルに入れない
${JA_ONLY_RULE}

出力: {"items":[{"kind":"site_article","title":"","target":"","outline":"","week":1}]}`;

export async function planMonth(project: AioProject, prompts: AioPrompt[], checks: AioCheck[], gap: AioGapReport | null, month: string): Promise<AioPlanItem[]> {
  const active = prompts.filter((p) => p.active);
  const lines = [
    `# 対象月: ${month}`,
    ...facts(project),
    "",
    "# 対策プロンプト（答えるべき問い）",
    ...(active.length ? active.map((p) => `- [${p.category}] ${p.text}`) : ["（未登録）"]),
    "",
    "# ギャップ分析",
    gap ? [gap.summary, ...gap.gaps.map((g) => `- ${g.topic}: ${g.idea}（${g.media}）`), ...gap.mediaTargets.map((m) => `- 媒体: ${m.domain} → ${m.action}`)].join("\n") : "（未実施。実測の結果だけから考える）",
    "",
    "# 実測の要点",
    ...evidenceLines(project, prompts, checks).slice(0, 12),
  ];
  const res = await askJson<{ items?: Record<string, unknown>[] }>(PLAN_SYSTEM, lines.join("\n"), { maxTokens: 3000, timeoutMs: 120_000 });
  const str = (v: unknown, n: number) => normalizeJapanese(String(v ?? "").trim()).slice(0, n);
  const items: AioPlanItem[] = (res.items ?? [])
    .slice(0, 12)
    .map((i) => ({
      id: crypto.randomUUID(),
      kind: (KINDS.includes(i.kind as AioDraftKind) ? i.kind : "site_article") as AioDraftKind,
      title: str(i.title, 120),
      target: str(i.target, 160),
      outline: str(i.outline, 300),
      week: Math.min(4, Math.max(1, Math.round(Number(i.week) || 1))),
      status: "planned" as const,
      draftId: null,
    }))
    .filter((i) => i.title);
  if (!items.length) throw new Error("計画を作れませんでした。対策プロンプトと事業内容を入れてもう一度お試しください");
  return items.sort((a, b) => a.week - b.week);
}
