import { askJson, MODEL_FAST } from "../anthropic";
import { GeminiUnavailableError, geminiGenerate, hasGemini } from "../gemini";
import { normalizeJapanese } from "../meo-ops/japanese";
import { fetchHtml, htmlToText } from "./net";

/**
 * サテライトの比較記事の「比較表の下調べ」（2026-10-21）。記事ごとに、テーマに合う比較項目を決めて各社の値を集める。
 * 1. 比較項目を決める（記事のタイトル・狙う語・基準から。AI 1回・少量）
 * 2. 各社の公式サイトを読む：トップ＋会社概要・料金・機能・実績・FAQ・サポートを種類ごとに1ページずつ（読んだ本文は数日使い回す）
 * 3. 決めた項目に沿って、読んだ本文に書かれている値だけを表の形で抜き出す（Gemini 3.1 Flash-Lite。使えなければ Claude Haiku）
 * 4. 公式サイトで埋まらなかった項目だけを Google 検索つきの Gemini で補う（根拠の出典が無い回答は捨てる）
 * 表は人が確かめて直してから、本文を書く。外部は ComparisonDeps で差し替えて検証できる
 */

export type CmpCell = { value: string; source: string | null; via: "site" | "search" | "manual" };
export type CmpCells = Record<string, CmpCell>;
export type SitePage = { url: string; kind: string; text: string };

export type ComparisonDeps = {
  fetchPage: (url: string) => Promise<{ html: string; finalUrl: string }>;
  /** JSON を返す安い AI（抜き出し・項目決め） */
  json: <T>(system: string, user: string) => Promise<T>;
  /** Google 検索つき。使えない環境では null */
  search: ((system: string, question: string) => Promise<{ text: string; sources: { uri: string; title: string }[] }>) | null;
};

function parseJson<T>(text: string): T {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(t) as T;
  } catch {
    const m = t.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]) as T;
    throw new Error("AI の出力を読めませんでした");
  }
}

export const defaultComparisonDeps = (): ComparisonDeps => ({
  fetchPage: (url) => fetchHtml(url, { browserUa: true, timeoutMs: 12_000 }),
  json: async <T,>(system: string, user: string) => {
    if (hasGemini()) {
      try {
        const r = await geminiGenerate({ system: `${system}\n\n必ず JSON のみを出力すること。`, parts: [{ text: user }], maxTokens: 4000, json: true, timeoutMs: 90_000 });
        return parseJson<T>(r.text);
      } catch (e) {
        // 残高切れ・上限など Gemini 側の事情のときだけ Claude（安いモデル）に切り替える
        if (!(e instanceof GeminiUnavailableError)) throw e;
      }
    }
    return askJson<T>(system, user, { model: MODEL_FAST, maxTokens: 4000, timeoutMs: 90_000, forceAnthropic: true });
  },
  search: hasGemini()
    ? async (system, question) => {
        const r = await geminiGenerate({ system, parts: [{ text: question }], maxTokens: 3000, search: true, timeoutMs: 90_000 });
        return { text: r.text, sources: (r.grounding?.sources ?? []).map((s) => ({ uri: s.uri, title: s.title })) };
      }
    : null,
});

// ── 1. 比較項目 ─────────────────────

const COLUMNS_SYSTEM = `あなたは比較メディアの編集者です。記事のテーマから、読者が選ぶときに比べたい項目を決めます。
- 公式サイトや会社の公開情報で確かめられる、事実で埋まる項目にする（「おすすめ度」「満足度」「評判」のような評価の項目は入れない）
- テーマに合わせて選ぶ（例：会社の信頼性が気になるテーマなら 資本金・設立年・従業員数、費用が気になるなら 初期費用・月額費用・最低契約期間）
- 4〜8個。1項目は12字以内の名詞
出力は JSON: {"columns":["…"]}`;

export async function planColumns(
  input: { topic: string; theme: string; basis: string; items: string[] },
  deps: Pick<ComparisonDeps, "json">
): Promise<string[]> {
  const r = await deps.json<{ columns?: unknown[] }>(
    COLUMNS_SYSTEM,
    [`# 記事のテーマ（タイトル・狙う語）: ${input.topic || "（指定なし。メディアのテーマから決める）"}`, input.theme ? `# メディアのテーマ・読者: ${input.theme}` : "", input.basis ? `# 運営者が決めた比較の基準（あれば必ず項目に含める）: ${input.basis}` : "", `# 比べる商品・サービス: ${input.items.join("、")}`]
      .filter(Boolean)
      .join("\n")
  );
  const cols = [...new Set((r.columns ?? []).map((c) => normalizeJapanese(String(c ?? "").trim()).slice(0, 20)).filter(Boolean))].slice(0, 8);
  if (cols.length < 2) throw new Error("比較項目を決められませんでした。もう一度お試しください");
  return cols;
}

// ── 2. 公式サイトを読む ─────────────────────

/** ページの種類。種類ごとに1ページずつ読む（見つかった順に5件、だと会社概要がフッターにあるサイトで落ちるため） */
const KINDS: { kind: string; re: RegExp }[] = [
  { kind: "会社概要", re: /(company|corporate|about|profile|outline|overview|会社概要|会社情報|企業情報|会社案内|運営会社)/i },
  { kind: "料金", re: /(price|pricing|plan|fee|cost|料金|費用|価格|プラン)/i },
  { kind: "機能・サービス", re: /(feature|function|service|solution|product|機能|特徴|強み|サービス|ソリューション)/i },
  { kind: "実績", re: /(case|works|result|customer|voice|実績|事例|導入|お客様)/i },
  { kind: "よくある質問", re: /(faq|question|qa|よくある|質問)/i },
  { kind: "サポート", re: /(support|flow|step|サポート|流れ|ご利用)/i },
];

export function pickPagesByKind(html: string, base: string): { url: string; kind: string }[] {
  const host = new URL(base).hostname.replace(/^www\./, "");
  const found = new Map<string, string>();
  const baseNorm = base.replace(/[#?].*$/, "").replace(/\/$/, "");
  for (const m of html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    let u: URL;
    try {
      u = new URL(m[1].replace(/&amp;/g, "&"), base);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(u.protocol) || u.hostname.replace(/^www\./, "") !== host) continue;
    if (/\.(pdf|jpe?g|png|gif|webp|zip|svg)$/i.test(u.pathname)) continue;
    u.hash = "";
    const s = u.toString();
    if (s.replace(/\/$/, "") === baseNorm) continue;
    const label = m[2].replace(/<[^>]+>/g, " ");
    for (const k of KINDS) {
      if (found.has(k.kind)) continue;
      if (k.re.test(u.pathname) || k.re.test(label)) {
        if (![...found.values()].includes(s)) found.set(k.kind, s);
        break;
      }
    }
  }
  return KINDS.filter((k) => found.has(k.kind)).map((k) => ({ kind: k.kind, url: found.get(k.kind)! }));
}

export async function readSite(url: string, deps: Pick<ComparisonDeps, "fetchPage">): Promise<{ pages: SitePage[]; notes: string[] }> {
  const top = await deps.fetchPage(url);
  const picks = pickPagesByKind(top.html, top.finalUrl);
  const got = await Promise.allSettled(picks.map((p) => deps.fetchPage(p.url)));
  const pages: SitePage[] = [{ url: top.finalUrl, kind: "トップ", text: htmlToText(top.html).slice(0, 12_000) }];
  const notes: string[] = [];
  got.forEach((r, i) => {
    if (r.status === "fulfilled") pages.push({ url: r.value.finalUrl, kind: picks[i].kind, text: htmlToText(r.value.html).slice(0, 12_000) });
    else notes.push(`${picks[i].kind}のページ（${picks[i].url}）を開けませんでした`);
  });
  return { pages, notes };
}

// ── 3. 表の形で抜き出す ─────────────────────

const EXTRACT_SYSTEM = `あなたは比較メディアの調査担当です。与えられた公式サイトの本文から、指定の比較項目の値を抜き出します。
- 本文にはっきり書かれている値だけ。推測・言い換えで数字を作らない。書かれていない項目は value を空文字にする
- 料金は条件（税込/税別・月額/初期費用など）も書く。会社情報（資本金・設立・所在地・従業員数など）は会社概要のページを優先して探す
- 宣伝の数字（「No.1」「満足度98%」など）は「〜と記載」の形にする
- value は60字以内。source はその値が書かれていたページの URL（与えられた URL のどれか）
出力は JSON: {"cells":{"項目名":{"value":"…","source":"https://…"}}}`;

export async function extractCells(
  item: { name: string },
  columns: string[],
  pages: SitePage[],
  deps: Pick<ComparisonDeps, "json">
): Promise<CmpCells> {
  const body = pages.map((p) => `## ${p.kind}: ${p.url}\n${p.text}`).join("\n\n").slice(0, 50_000);
  const r = await deps.json<{ cells?: Record<string, { value?: unknown; source?: unknown }> }>(
    EXTRACT_SYSTEM,
    `# 対象: ${item.name}\n# 比較項目: ${columns.join(" / ")}\n\n${body}`
  );
  const urls = pages.map((p) => p.url);
  const out: CmpCells = {};
  for (const c of columns) {
    const v = r.cells?.[c];
    const value = normalizeJapanese(String(v?.value ?? "").trim()).slice(0, 120);
    if (!value || /^(不明|記載なし|なし|-|―|ー)$/.test(value)) continue;
    // 出典は読んだページのどれかに限る（AI が作った URL は使わない）
    const want = String(v?.source ?? "").replace(/\/+$/, "");
    out[c] = { value, source: urls.find((u) => u.replace(/\/+$/, "") === want) ?? urls[0], via: "site" };
  }
  return out;
}

// ── 4. 足りない項目だけ検索で補う ─────────────────────

const SEARCH_SYSTEM = `あなたは比較メディアの調査担当です。Google検索で、指定のサービス・会社について、指定の項目の値だけを調べます。
- 検索結果のページにはっきり書かれている値だけ。推測・評判・口コミは書かない。見つからない項目は書かない
- 1行に1項目、「項目名：値」の形で書く（値は60字以内）。前置き・まとめは書かない`;

export async function searchMissing(
  item: { name: string; url: string },
  missing: string[],
  deps: Pick<ComparisonDeps, "search">
): Promise<CmpCells> {
  if (!missing.length || !deps.search) return {};
  const r = await deps.search(SEARCH_SYSTEM, `「${item.name}」（公式サイト: ${item.url}）の次の項目を調べてください：${missing.join("、")}`);
  // 検索の根拠（出典）が取れなかった回答は使わない
  if (!r.sources.length) return {};
  const src = [...new Set(r.sources.map((s) => s.title).filter(Boolean))].slice(0, 3).join("・") || "Google検索";
  const out: CmpCells = {};
  for (const line of r.text.split("\n")) {
    const m = normalizeJapanese(line.trim()).replace(/^[・\-*\s]+/, "").match(/^(.{1,20}?)\s*[：:]\s*(.+)$/);
    if (!m) continue;
    const col = missing.find((c) => c === m[1].trim());
    const value = m[2].trim().slice(0, 120);
    if (!col || !value || /^(不明|見つかりません|記載なし|なし)/.test(value)) continue;
    out[col] = { value, source: src, via: "search" };
  }
  return out;
}

/** 記事を書く AI に渡す比較表（Markdown）。空欄は「公式サイトで確認」 */
export function comparisonTable(columns: string[], rows: { name: string; cells: CmpCells }[]): string {
  const esc = (s: string) => s.replace(/\|/g, "／").replace(/\n/g, " ");
  return [
    `| 商品・サービス | ${columns.map(esc).join(" | ")} |`,
    `| --- | ${columns.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${esc(r.name)} | ${columns.map((c) => esc(r.cells[c]?.value || "公式サイトで確認")).join(" | ")} |`),
  ].join("\n");
}
