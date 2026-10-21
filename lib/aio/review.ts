import { askJson } from "../anthropic";
import { normalizeJapanese } from "../meo-ops/japanese";
import { CHANNEL_LABEL, type AioArticle, type AioChannel, type AioChannelKind, type AioContentReview, type AioMetric } from "./content-types";
import type { AioProject } from "./types";

/**
 * 数字（Search Console・GA4・note の数字）を読んで、直す記事と次に書く記事を出す。
 * 数字はこちらで並べて渡し、AI には「なぜそうなっていそうか・何をするか」だけを考えさせる。
 * 効果は約束しない（「〜を狙う」「〜を試す」の形）。
 */

export type NoteRow = { title: string; url: string; views: number | null; likes: number | null; comments: number | null };

const num = (s: string | undefined): number | null => {
  if (s === undefined) return null;
  const t = s.replace(/[,，\s]/g, "").replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
};

function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/**
 * note の数字を貼り付け／CSV から読む。
 * 1行目が見出しなら列名（タイトル・URL・ビュー・スキ・コメント）で判断し、無ければ「タイトル, ビュー, スキ, コメント」の順とみなす。
 * note の「アクセス状況」画面の表をそのまま貼った形（タブ区切り）も読む
 */
export function parseNoteMetrics(text: string): NoteRow[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const sep = lines[0].includes("\t") ? "\t" : ",";
  const head = splitCsvLine(lines[0], sep).map((h) => h.toLowerCase());
  const find = (re: RegExp) => head.findIndex((h) => re.test(h));
  const hasHeader = head.some((h) => /タイトル|title|記事|ビュー|view|閲覧|スキ|like|コメント|comment|url/.test(h));
  const idx = hasHeader
    ? { title: find(/タイトル|title|記事/), url: find(/url|リンク/), views: find(/ビュー|view|閲覧|pv/), likes: find(/スキ|like|いいね/), comments: find(/コメント|comment/) }
    : { title: 0, url: -1, views: 1, likes: 2, comments: 3 };
  const rows = (hasHeader ? lines.slice(1) : lines).map((l) => splitCsvLine(l, sep));
  return rows
    .map((c) => {
      const pick = (i: number) => (i >= 0 ? c[i] : undefined);
      let title = pick(idx.title) ?? "";
      let url = pick(idx.url) ?? "";
      if (!url && /^https?:\/\//.test(title)) [url, title] = [title, ""];
      return { title: title.slice(0, 200), url: /^https:\/\/note\.com\//.test(url) ? url.slice(0, 400) : "", views: num(pick(idx.views)), likes: num(pick(idx.likes)), comments: num(pick(idx.comments)) };
    })
    .filter((r) => (r.title || r.url) && (r.views !== null || r.likes !== null || r.comments !== null))
    .slice(0, 300);
}

const SYSTEM = `あなたは日本のオウンドメディア（自社サイトのコラム・note）の運用担当です。記事ごとの数字を読み、改善案を出します。
- 数字はこちらで並べて渡す。数字を作らない・計算し直さない。渡していない数字に触れない
- 「なぜそうなっていそうか」は見立てとして書く（断定しない）。効果や順位を約束しない（「〜を狙う」「〜を試す」）
- 直す記事は、表示は多いのにクリックが少ない（タイトル・説明文）、順位が 8〜20 位（見出しと中身の追加）、読まれているのに次の行動につながらない（案内の追加）、の順で優先する
- note は、ビューに対するスキ・コメントの多さで、読者が反応したテーマを読む
- 次に書く記事は、実際に表示されている検索語・反応が良かったテーマ・まだ書いていない問いから選ぶ。既存記事と重ねない
- 日本語の文章で通常使う漢字だけで書く

出力: {"summary":"今の状態と、今月いちばん効くこと（200字以内）","working":[{"title":"よく読まれている記事","why":"理由の見立て"}],"fixes":[{"title":"記事タイトル","url":"URL","problem":"数字から見えること","action":"具体的な直し方（タイトル案・足す見出し・案内の位置など）","priority":"高"}],"next":[{"title":"次に書く記事のタイトル案","target":"答える問い・狙う語","why":"選んだ理由（どの数字・テーマから）"}]}`;

export async function reviewContent(
  kind: AioChannelKind,
  project: AioProject,
  ch: AioChannel | null,
  metrics: AioMetric[],
  articles: AioArticle[]
): Promise<Omit<AioContentReview, "id" | "createdAt">> {
  // 記事ごとに直近の値だけを使う（同じ記事を何度も取得・入力しているため）
  const latest = new Map<string, AioMetric[]>();
  for (const m of metrics) {
    const k = `${m.source}|${m.url || m.title}`;
    if (!latest.has(k)) latest.set(k, [m]);
  }
  const rows = [...latest.values()].map((v) => v[0]);
  if (!rows.length) throw new Error("数字がまだありません。先に数字を取り込んでください");

  const fmt = (m: AioMetric) => {
    const parts = [
      m.views !== null ? `閲覧${m.views}` : "",
      m.clicks !== null ? `クリック${m.clicks}` : "",
      m.impressions !== null ? `表示${m.impressions}` : "",
      m.impressions ? `CTR${((100 * (m.clicks ?? 0)) / m.impressions).toFixed(1)}%` : "",
      m.position !== null ? `平均順位${m.position}` : "",
      m.engagementSec !== null ? `平均滞在${m.engagementSec}秒` : "",
      m.likes !== null ? `スキ${m.likes}` : "",
      m.comments !== null ? `コメント${m.comments}` : "",
    ].filter(Boolean);
    const q = m.queries.length ? `\n  検索語: ${m.queries.slice(0, 5).map((x) => `${x.query}（表示${x.impressions}・順位${x.position}）`).join(" / ")}` : "";
    return `- ${m.title || "（タイトル不明）"} ${m.url}\n  ${parts.join("・")}${q}`;
  };
  const merged = new Map<string, AioMetric>();
  for (const r of rows) {
    const k = (r.url || r.title).replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, "");
    const cur = merged.get(k);
    merged.set(k, cur ? { ...cur, ...Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null && !(Array.isArray(v) && !v.length) && v !== "")) } : r);
  }
  const list = [...merged.values()].sort((a, b) => (b.views ?? b.impressions ?? 0) - (a.views ?? a.impressions ?? 0)).slice(0, 40);

  const user = [
    `媒体: ${CHANNEL_LABEL[kind]}`,
    `事業者: ${project.name}（見込み客の探し方: ${project.area ? `${project.area}で` : ""}${project.category}）`,
    ch?.style ? `媒体のトンマナ: ${ch.style.summary}` : "",
    ch?.style?.topics.length ? `既存記事のテーマ: ${ch.style.topics.join(" / ")}` : "",
    articles.length ? `この画面で作った記事: ${articles.slice(0, 20).map((a) => `${a.title}${a.publishedUrl ? `（${a.publishedUrl}）` : "（未公開）"}`).join(" / ")}` : "",
    rows[0]?.periodFrom ? `期間: ${rows[0].periodFrom}〜${rows[0].periodTo}` : "",
    "",
    "# 記事ごとの数字",
    ...list.map(fmt),
  ]
    .filter(Boolean)
    .join("\n");

  const r = await askJson<{
    summary?: string;
    working?: { title?: string; why?: string }[];
    fixes?: { title?: string; url?: string; problem?: string; action?: string; priority?: string }[];
    next?: { title?: string; target?: string; why?: string }[];
  }>(SYSTEM, user, { maxTokens: 4000, timeoutMs: 150_000 });
  const s = (v: unknown, n: number) => normalizeJapanese(String(v ?? "").trim()).slice(0, n);
  return {
    channel: kind,
    summary: s(r.summary, 400),
    working: (Array.isArray(r.working) ? r.working : []).map((w) => ({ title: s(w?.title, 160), why: s(w?.why, 240) })).filter((w) => w.title).slice(0, 5),
    fixes: (Array.isArray(r.fixes) ? r.fixes : [])
      .map((f) => ({ title: s(f?.title, 160), url: /^https?:\/\//.test(String(f?.url ?? "")) ? String(f!.url).slice(0, 400) : "", problem: s(f?.problem, 240), action: s(f?.action, 400), priority: (["高", "中", "低"].includes(String(f?.priority)) ? f!.priority : "中") as "高" | "中" | "低" }))
      .filter((f) => f.title && f.action)
      .slice(0, 10),
    next: (Array.isArray(r.next) ? r.next : []).map((n) => ({ title: s(n?.title, 160), target: s(n?.target, 160), why: s(n?.why, 240) })).filter((n) => n.title).slice(0, 8),
  };
}
