import { askJson } from "../anthropic";
import { normalizeJapanese } from "../meo-ops/japanese";
import { AIO_PROMPT_CATEGORY_LABEL, type AioCheck, type AioPrompt, type AioPromptCategory, type AioProject } from "./types";

/**
 * 対策プロンプトの設計と、実測結果の集計。
 *
 * Vector 等の AIO サービスの型（Prompt Design → Monitoring → Gap Analysis → … → Measure & Expand）をそのまま入れる。
 * ここは「狙う問いを決める」「月次で測った結果を数字にする」の部分。因果は主張せず、実測の集計だけを出す。
 */

const CATEGORIES = Object.keys(AIO_PROMPT_CATEGORY_LABEL) as AioPromptCategory[];

const SUGGEST_SYSTEM = `あなたは日本の企業の AI検索対策（AIO/GEO）コンサルタントです。
見込み客（採用なら求職者）が ChatGPT や Gemini に実際に入力しそうな「問い」を、事業の前提から20本考えます。
AI に推薦されるかは「どんな問いに答えられるか」で決まるので、問いは自社名を含めず、見込み客の課題・目的の言葉で書きます。

カテゴリ（それぞれ2〜4本、合計20本）:
- issue: 課題型「〇〇を解決できる会社は？」
- recommend: おすすめ型「〇〇に強い会社を教えて」
- compare: 比較型「〇〇と△△の違いは？」（自社と競合、または手法どうし）
- track_record: 実績型「〇〇業界で実績がある会社は？」
- select: 選定型「〇〇を任せるならどこがいい？」
- trust: 信頼性型「〇〇社の評判や強みは？」（ここだけ自社名を入れてよい）
- recruit: 採用型「〇〇業界で働きやすい会社は？」（採用も狙うときだけ。不要なら0本）

- 地域に依存する事業なら、半分くらいの問いに地域名を入れる
- 実際に人が打ちそうな、自然な日本語の一文にする（20〜50字）
- 似た問いを並べない。切り口（用途・予算・規模・職種・比較相手）を変える
- 日本語の文章で通常使う漢字だけで書く

出力: {"prompts":[{"category":"issue|recommend|compare|track_record|select|trust|recruit","text":"問い"}]}`;

export async function suggestPrompts(project: AioProject, existing: string[]): Promise<{ category: AioPromptCategory; text: string }[]> {
  const lines = [
    "# 事業の前提",
    `事業者名: ${project.name}`,
    project.aliases.length ? `サービス名・別名: ${project.aliases.join(", ")}` : "",
    `見込み客の探し方: ${project.area ? `${project.area}で` : ""}${project.category}`,
    project.notes ? `事業内容・強み: ${project.notes.slice(0, 1500)}` : "",
    project.siteSummary ? `Webサイトの見出し: ${project.siteSummary}` : "",
    existing.length ? `\n# 登録済み（これと重ならないもの）\n${existing.map((e) => `- ${e}`).join("\n")}` : "",
  ].filter((l) => l !== "");
  const res = await askJson<{ prompts?: { category?: string; text?: string }[] }>(SUGGEST_SYSTEM, lines.join("\n"), { maxTokens: 2500, timeoutMs: 90_000 });
  const seen = new Set(existing.map((e) => e.replace(/\s+/g, "")));
  const out: { category: AioPromptCategory; text: string }[] = [];
  for (const p of res.prompts ?? []) {
    const text = normalizeJapanese(String(p.text ?? "").trim()).slice(0, 120);
    const key = text.replace(/\s+/g, "");
    if (!text || seen.has(key)) continue;
    seen.add(key);
    const category = CATEGORIES.includes(p.category as AioPromptCategory) ? (p.category as AioPromptCategory) : "recommend";
    out.push({ category, text });
    if (out.length >= 20) break;
  }
  return out;
}

// ── 集計（Monitoring） ──────────────────────────────

export type AioPeriodStats = {
  period: string;
  checks: number;
  mentioned: number;
  /** 言及率（%） */
  mentionRate: number | null;
  /** 言及したときの平均順位 */
  avgRank: number | null;
  /** 引用率（自社ドメインが根拠として引用された割合、%） */
  citationRate: number | null;
  /** Share of Voice（AI が挙げた事業者の延べ数に占める自社の割合、%） */
  sov: number | null;
};

export type AioCompetitorRow = { name: string; mentions: number; share: number; isOwn: boolean };
export type AioDomainRow = { domain: string; count: number; isOwn: boolean };

export type AioSummary = {
  latest: AioPeriodStats | null;
  previous: AioPeriodStats | null;
  history: AioPeriodStats[];
  /** 直近期の、プロンプトごとの最新結果 */
  byPrompt: { prompt: AioPrompt; check: AioCheck | null }[];
  competitors: AioCompetitorRow[];
  domains: AioDomainRow[];
  byEngine: { engine: string; checks: number; mentioned: number }[];
};

const NOISE = /[\s\-‐‑–—ー・\/／|｜()（）[\]「」『』"'’、。．,.!！?？&＆]/g;
const LEGAL = /株式会社|\(株\)|有限会社|\(有\)|合同会社|\(合\)|\(同\)/g;
const norm = (s: string) => s.normalize("NFKC").replace(LEGAL, "").replace(NOISE, "").toLowerCase();

function isOwnName(name: string, own: string[]): boolean {
  const n = norm(name);
  if (!n) return false;
  return own.some((o) => {
    const on = norm(o);
    return !!on && (n === on || (Math.min(n.length, on.length) >= 5 && (n.includes(on) || on.includes(n))));
  });
}

function periodOf(c: AioCheck): string {
  const d = new Date(c.completedAt ?? c.createdAt);
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(d).slice(0, 7);
}

function statsFor(period: string, checks: AioCheck[], own: string[]): AioPeriodStats {
  const done = checks.filter((c) => c.status === "completed");
  const mentioned = done.filter((c) => c.mentioned);
  const ranks = mentioned.map((c) => c.rank).filter((r): r is number => r != null);
  const cited = done.filter((c) => c.ownSourceDomains.length > 0).length;
  let total = 0;
  let ownCount = 0;
  for (const c of done) {
    for (const n of c.listed) {
      total++;
      if (isOwnName(n, own)) ownCount++;
    }
  }
  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
  return {
    period,
    checks: done.length,
    mentioned: mentioned.length,
    mentionRate: pct(mentioned.length, done.length),
    avgRank: ranks.length ? Math.round((ranks.reduce((a, b) => a + b, 0) / ranks.length) * 10) / 10 : null,
    citationRate: pct(cited, done.length),
    sov: pct(ownCount, total),
  };
}

/** 画面用の集計（純粋関数。AI も DB も呼ばない） */
export function summarize(project: AioProject, prompts: AioPrompt[], checks: AioCheck[], ownDomains: string[]): AioSummary {
  const own = [project.name, ...project.aliases].filter((s) => s.trim());
  const byPeriod = new Map<string, AioCheck[]>();
  for (const c of checks) {
    const p = periodOf(c);
    byPeriod.set(p, [...(byPeriod.get(p) ?? []), c]);
  }
  const periods = [...byPeriod.keys()].sort();
  const history = periods.map((p) => statsFor(p, byPeriod.get(p)!, own)).filter((s) => s.checks > 0);
  const latest = history.at(-1) ?? null;
  const previous = history.at(-2) ?? null;

  // プロンプトごとの最新結果（完了したものを優先、無ければ実行中/失敗）
  const byPrompt = prompts
    .filter((p) => p.active)
    .map((p) => {
      const mine = checks.filter((c) => c.promptId === p.id).sort((a, b) => (b.completedAt ?? b.createdAt).localeCompare(a.completedAt ?? a.createdAt));
      return { prompt: p, check: mine.find((c) => c.status === "completed") ?? mine[0] ?? null };
    });

  // 競合（直近期に AI が挙げた事業者の延べ数）
  const latestChecks = latest ? (byPeriod.get(latest.period) ?? []).filter((c) => c.status === "completed") : [];
  const counts = new Map<string, { name: string; mentions: number; isOwn: boolean }>();
  let total = 0;
  for (const c of latestChecks) {
    for (const n of c.listed) {
      total++;
      const isOwn = isOwnName(n, own);
      const key = isOwn ? "__own__" : norm(n);
      const cur = counts.get(key) ?? { name: isOwn ? project.name : n, mentions: 0, isOwn };
      cur.mentions++;
      counts.set(key, cur);
    }
  }
  const competitors = [...counts.values()]
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, 10)
    .map((c) => ({ ...c, share: total ? Math.round((c.mentions / total) * 1000) / 10 : 0 }));

  // 引用元ドメイン（直近期）
  const dcount = new Map<string, number>();
  for (const c of latestChecks) {
    for (const d of new Set(c.citedSources.map((s) => s.domain).filter(Boolean))) dcount.set(d, (dcount.get(d) ?? 0) + 1);
  }
  const ownD = new Set(ownDomains.map((d) => d.toLowerCase().replace(/^www\./, "")));
  const domains = [...dcount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([domain, count]) => ({ domain, count, isOwn: ownD.has(domain) || [...ownD].some((o) => !!o && domain.endsWith(`.${o}`)) }));

  // エンジン別
  const emap = new Map<string, { checks: number; mentioned: number }>();
  for (const c of latestChecks) {
    const cur = emap.get(c.engine) ?? { checks: 0, mentioned: 0 };
    cur.checks++;
    if (c.mentioned) cur.mentioned++;
    emap.set(c.engine, cur);
  }
  const byEngine = [...emap.entries()].map(([engine, v]) => ({ engine, ...v }));

  return { latest, previous, history, byPrompt, competitors, domains, byEngine };
}

/** 自社ドメイン（URL から） */
export function ownDomainsOf(project: AioProject): string[] {
  try {
    return project.url ? [new URL(project.url).hostname.toLowerCase().replace(/^www\./, "")] : [];
  } catch {
    return [];
  }
}
