import Anthropic from "@anthropic-ai/sdk";
import { askJson, MODEL_FAST } from "../anthropic";
import { GeminiUnavailableError, geminiGenerate, hasGemini } from "../gemini";
import { normalizeJapanese } from "../meo-ops/japanese";
import { fetchHtml, htmlToText } from "./net";

/**
 * サテライトの比較記事の「比較表の下調べ」（2026-10-21）。記事ごとに、テーマに合う比較項目を決めて各社の値を集める。
 * 1. 比較項目を決める（記事のタイトル・狙う語・基準から。AI 1回・少量）
 * 2. 各社の公式サイトを読む：トップ＋会社概要・料金・機能・実績・FAQ・サポートを種類ごとに1ページずつ（読んだ本文は数日使い回す）
 * 3. 決めた項目に沿って、読んだ本文に書かれている値だけを表の形で抜き出す（Gemini 3.1 Flash-Lite。使えなければ Claude Haiku）
 * 4. 公式サイトで埋まらなかった項目だけを検索で補う：Gemini（Google 検索つき）→ 出典が取れなければ「必ず検索する」と指示して1回だけやり直し
 *    → それでも出典が無ければ Claude Haiku の Web 検索（出典が必ず付く）。根拠の出典が無い回答は捨てる
 * 5. 半分以上の会社で空欄の項目は、確認画面で既定で外す（人が戻せる）
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
  search: SearchFn | null;
  /** search で出典が取れなかったときの代わり（Claude の Web 検索）。使えない環境では null */
  searchFallback: SearchFn | null;
};
type SearchFn = (system: string, question: string) => Promise<{ text: string; sources: { uri: string; title: string }[] }>;

/** Claude Haiku の Web 検索。回答の引用（citations）を出典にする */
async function claudeSearch(system: string, question: string) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const res = (await client.messages.create(
    {
      model: MODEL_FAST,
      max_tokens: 2000,
      system,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3, user_location: { type: "approximate", country: "JP", timezone: "Asia/Tokyo" } }],
      messages: [{ role: "user", content: question }],
    } as unknown as Anthropic.Messages.MessageCreateParamsNonStreaming,
    { timeout: 90_000, maxRetries: 0 }
  )) as unknown as { content: { type: string; text?: string; citations?: { url?: string; title?: string }[] | null }[] };
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
  const seen = new Set<string>();
  const sources: { uri: string; title: string }[] = [];
  for (const b of res.content) {
    for (const c of b.citations ?? []) {
      if (!c.url || seen.has(c.url)) continue;
      seen.add(c.url);
      let host = "";
      try {
        host = new URL(c.url).hostname.replace(/^www\./, "");
      } catch {}
      sources.push({ uri: c.url, title: host || String(c.title ?? "") });
    }
  }
  return { text, sources };
}

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
  searchFallback: process.env.ANTHROPIC_API_KEY ? claudeSearch : null,
});

// ── 1. 比較項目 ─────────────────────

const COLUMNS_SYSTEM = `あなたは比較メディアの編集者です。記事のテーマから、読者が選ぶときに比べたい項目を決めます。
- 公式サイト・会社概要・登記・プレスリリースなど公開情報で確かめられる、事実で埋まる項目だけにする（例：資本金・設立年・従業員数・本社所在地・提供サービス・料金・対応媒体・取得資格・導入実績の公開数）
- 「得意な〇〇」「強み」「おすすめ度」「満足度」「評判」「取引先の規模」のような、評価・自己申告・非公開になりがちな項目は入れない
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
const KINDS: { kind: string; re: RegExp; best?: RegExp }[] = [
  {
    kind: "会社概要",
    re: /(company|corporate|about|profile|outline|overview|会社概要|会社情報|企業情報|企業概要|会社案内|運営会社)/i,
    // 会社の基本情報そのもののページ（入口のページより優先する）
    best: /(outline|profile|overview|corporate\/data|company\/info|会社概要|企業概要|会社情報|基本情報)/i,
  },
  { kind: "料金", re: /(price|pricing|plan|fee|cost|料金|費用|価格|プラン)/i },
  { kind: "機能・サービス", re: /(feature|function|service|solution|product|business|機能|特徴|強み|サービス|ソリューション|事業)/i },
  { kind: "実績", re: /(case|works|result|customer|client|voice|実績|事例|導入|お客様|取引先)/i },
  { kind: "よくある質問", re: /(faq|question|qa|よくある|質問)/i },
  { kind: "サポート", re: /(support|flow|step|サポート|流れ|ご利用)/i },
];

/** 比較に使わないページ（採用・ニュース・規約・代表メッセージなど。会社概要らしい URL でも中身が違う） */
const SKIP = /(recruit|career|interview|news|press|blog|column|topics|terms|privacy|policy|sitemap|contact|inquiry|message|ceo|greeting|philosophy|history|sustainab|ir\/(library|news|stock)|採用|求人|ニュース|お知らせ|規約|プライバシー|お問い合わせ|メッセージ|ごあいさつ|挨拶|沿革|理念)/i;

/** 会社概要のページに、会社の基本情報が書かれているらしいか */
const COMPANY_FACTS = /(資本金|設立|創業|従業員|社員数|代表者|所在地|本社)/;

type Link = { url: string; label: string };

function linksOf(html: string, base: string): Link[] {
  const host = new URL(base).hostname.replace(/^www\./, "");
  const baseNorm = base.replace(/[#?].*$/, "").replace(/\/$/, "");
  const out: Link[] = [];
  const seen = new Set<string>();
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
    if (s.replace(/\/$/, "") === baseNorm || seen.has(s)) continue;
    seen.add(s);
    out.push({ url: s, label: m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() });
  }
  return out;
}

/** 会社概要として一番それらしいリンク（基本情報のページ ＞ 入口のページ） */
function bestCompanyLink(links: Link[]): string | null {
  const k = KINDS[0];
  const ok = links.filter((l) => !SKIP.test(decodeURIComponent(l.url)) && !SKIP.test(l.label) && (k.re.test(l.url) || k.re.test(l.label)));
  return (ok.find((l) => k.best!.test(l.url) || k.best!.test(l.label)) ?? ok[0])?.url ?? null;
}

export function pickPagesByKind(html: string, base: string): { url: string; kind: string }[] {
  const links = linksOf(html, base);
  const found = new Map<string, string>();
  const company = bestCompanyLink(links);
  if (company) found.set("会社概要", company);
  for (const l of links) {
    const path = decodeURIComponent(new URL(l.url).pathname);
    if (SKIP.test(path) || SKIP.test(l.label)) continue;
    for (const k of KINDS.slice(1)) {
      if (found.has(k.kind)) continue;
      if (k.re.test(path) || k.re.test(l.label)) {
        if (![...found.values()].includes(l.url)) found.set(k.kind, l.url);
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
  let companyHtml: { html: string; finalUrl: string } | null = null;
  got.forEach((r, i) => {
    if (r.status === "fulfilled") {
      pages.push({ url: r.value.finalUrl, kind: picks[i].kind, text: htmlToText(r.value.html).slice(0, 12_000) });
      if (picks[i].kind === "会社概要") companyHtml = r.value;
    } else notes.push(`${picks[i].kind}のページ（${picks[i].url}）を開けませんでした`);
  });
  // 会社概要が入口のページ（会社情報の一覧）で基本情報が無いときは、その中の会社概要のページをもう1つ読む
  const ch = companyHtml as { html: string; finalUrl: string } | null;
  if (ch && !COMPANY_FACTS.test(htmlToText(ch.html))) {
    const deeper = bestCompanyLink(linksOf(ch.html, ch.finalUrl).filter((l) => !pages.some((p) => p.url === l.url)));
    if (deeper) {
      try {
        const d = await deps.fetchPage(deeper);
        pages.push({ url: d.finalUrl, kind: "会社概要", text: htmlToText(d.html).slice(0, 12_000) });
      } catch {
        notes.push(`会社概要のページ（${deeper}）を開けませんでした`);
      }
    }
  }
  if (!pages.some((p) => p.kind === "会社概要" && COMPANY_FACTS.test(p.text))) notes.push("公式サイトで会社の基本情報（資本金・従業員数など）のページを見つけられませんでした");
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

/** 検索の回答の1行から「項目名：値」を読む（太字・箇条書き・番号・【】の揺れを吸収する） */
export function parseSearchLine(line: string, columns: string[]): { col: string; value: string } | null {
  const t = normalizeJapanese(line.trim())
    .replace(/\*\*|__/g, "")
    .replace(/^(?:[・\-*•●■◆]|\d+[.)．、])\s*/, "")
    .replace(/^【([^】]+)】\s*/, "$1：");
  const m = t.match(/^(.{1,30}?)\s*[：:]\s*(.+)$/);
  if (!m) return null;
  const key = m[1].replace(/[\s「」『』]/g, "");
  const col = columns.find((c) => key === c) ?? columns.find((c) => key.includes(c) || c.includes(key));
  const value = m[2].replace(/\[\d+(?:,\s*\d+)*\]/g, "").trim().slice(0, 120);
  if (!col || !value || /^(不明|見つかりません|見つかりませんでした|記載なし|なし|非公開|情報なし|-)/.test(value)) return null;
  return { col, value };
}

export async function searchMissing(
  item: { name: string; url: string },
  missing: string[],
  deps: Pick<ComparisonDeps, "search" | "searchFallback">
): Promise<{ cells: CmpCells; note: string | null }> {
  if (!missing.length) return { cells: {}, note: null };
  if (!deps.search && !deps.searchFallback) return { cells: {}, note: "検索で補う設定が無いため、検索していません" };
  const q = `「${item.name}」（公式サイト: ${item.url || "不明"}）の次の項目を調べてください：${missing.join("、")}`;
  const notes: string[] = [];
  let r: { text: string; sources: { uri: string; title: string }[] } | null = null;
  // Gemini → 出典が無ければ「必ず検索する」と指示して1回だけやり直し → それでも無ければ Claude の Web 検索
  const tries: { fn: SearchFn | null; system: string; label: string }[] = [
    { fn: deps.search, system: SEARCH_SYSTEM, label: "Gemini" },
    { fn: deps.search, system: `${SEARCH_SYSTEM}\n- 学習済みの知識で答えず、必ず Google 検索を実行し、検索結果のページに書かれている値だけを答える`, label: "Gemini（再試行）" },
    { fn: deps.searchFallback, system: SEARCH_SYSTEM, label: "Claude" },
  ];
  for (const t of tries) {
    if (!t.fn) continue;
    try {
      const got = await t.fn(t.system, q);
      if (got.sources.length) {
        r = got;
        break;
      }
      notes.push(`${t.label}：出典なし`);
    } catch (e) {
      notes.push(`${t.label}：${e instanceof Error ? e.message.slice(0, 80) : "失敗"}`);
    }
  }
  // 検索の根拠（出典）が取れなかった回答は使わない
  if (!r) return { cells: {}, note: `検索の根拠（出典）が取れなかったため、検索の結果を使いませんでした（${notes.join(" / ")}）` };
  const src = [...new Set(r.sources.map((s) => s.title).filter(Boolean))].slice(0, 3).join("・") || "Google検索";
  const out: CmpCells = {};
  for (const line of r.text.split("\n")) {
    const p = parseSearchLine(line, missing);
    if (p && !out[p.col]) out[p.col] = { value: p.value, source: src, via: "search" };
  }
  const left = missing.filter((c) => !out[c]);
  return { cells: out, note: left.length ? `検索でも見つからなかった項目：${left.join("・")}` : null };
}

/** 半分以上の会社で空欄の項目（確認画面で既定で外す） */
export function sparseColumns(columns: string[], rows: { cells: Record<string, { value?: string } | undefined> }[]): string[] {
  if (!rows.length) return [];
  return columns.filter((c) => rows.filter((r) => String(r.cells[c]?.value ?? "").trim()).length * 2 < rows.length);
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
