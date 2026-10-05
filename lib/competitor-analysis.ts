import { askJson } from "./anthropic";
import type { Diagnosis } from "./types";

/**
 * 競合サイトと自社サイトの比較分析。
 *
 * 競合の一覧（lib/competitors.ts）は「検索で上位に出ていたサイト」を並べただけで、
 * 自社と何が違うのかは分からなかった。ここでは、一覧に出た競合のページと自社のページを
 * 実際に読んで、同じ項目で見比べる。
 *
 * - 読むのはHTMLに書かれている範囲（JavaScriptで後から表示される内容は読めない）。
 *   読めなかったページは「確認できなかった」として数えず、推測で埋めない
 * - 比べる項目は、料金の明記・予約や申込みの導線・口コミや実績の掲載など、数えられるものだけ
 * - 競合側は「検索で上位に出ていたそのページ」、自社側はトップページを読む。ページの種類が
 *   違う（競合は記事や比較ページ、自社はトップ）ことは画面に注記する
 * - 示唆（insights）は、集計した事実だけを材料にAIが書く。数字を作らない
 */

export type PageSignals = {
  /** 料金・価格の記載 */
  price: boolean;
  /** 予約・申込みの導線 */
  booking: boolean;
  /** LINEへの導線 */
  line: boolean;
  /** 電話の導線 */
  tel: boolean;
  /** 口コミ・症例・実績の掲載 */
  proof: boolean;
  /** よくある質問 */
  faq: boolean;
  /** 医師・監修者・専門家の記載 */
  expert: boolean;
  /** リスク・副作用・注意事項の説明 */
  risk: boolean;
  /** 構造化データ（JSON-LD） */
  structuredData: boolean;
};

export type PageProfile = {
  name: string;
  url: string;
  /** 読めたか。読めなければ signals は無く、集計から外す */
  readable: boolean;
  reason: string | null;
  title: string;
  titleLength: number;
  descriptionLength: number;
  h2Count: number;
  textLength: number;
  signals: PageSignals | null;
};

export type SignalRow = {
  key: keyof PageSignals;
  label: string;
  /** 自社が載せているか。自社ページが読めなければ null */
  own: boolean | null;
  /** 読めた競合のうち、載せていた数 */
  competitors: number;
  /** 読めた競合の数 */
  total: number;
};

export type CompetitorAnalysis = {
  own: PageProfile | null;
  profiles: PageProfile[];
  rows: SignalRow[];
  /** 数値の比較（読めた競合の中央値） */
  numbers: { label: string; own: number | null; median: number | null }[];
  /** 比較から読み取れること。集計した事実だけを根拠にする */
  insights: string[];
  /** 示唆の生成に失敗したときの理由 */
  insightError?: string;
};

const LABELS: Record<keyof PageSignals, string> = {
  price: "料金・価格の記載",
  booking: "予約・申込みの導線",
  line: "LINEへの導線",
  tel: "電話の導線",
  proof: "口コミ・症例・実績の掲載",
  faq: "よくある質問",
  expert: "医師・監修者・専門家の記載",
  risk: "リスク・注意事項の説明",
  structuredData: "構造化データ",
};

const UA = "Mozilla/5.0 (compatible; AI-REX/1.0; +https://airex-ad.ai)";
const MAX_HTML = 1_500_000;

function strip(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function meta(html: string, name: string): string {
  const m =
    html.match(new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)["']`, "i")) ??
    html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${name}["']`, "i"));
  return m?.[1]?.trim() ?? "";
}

/** HTMLから比較項目を読み取る。テキストに現れる語・リンクの有無だけで判定する（推測しない） */
export function readSignals(html: string): PageSignals {
  const text = strip(html);
  return {
    price: /(\d[\d,]*\s*円|[¥￥]\s*\d|税込|料金|価格|費用)/.test(text),
    booking: /(予約|申し込み|申込み|お申込|カウンセリング|reserve|booking)/i.test(text),
    line: /(lin\.ee|line\.me|LINE)/i.test(html),
    tel: /(href=["']tel:|0120[-\d]{6,}|0570[-\d]{6,}|\b0\d{1,4}-\d{1,4}-\d{3,4}\b)/i.test(html),
    proof: /(口コミ|症例|ビフォー|アフター|before|after|実績|満足度|レビュー|お客様の声)/i.test(text),
    faq: /(よくある質問|FAQ|Q&A|Q\.\s)/i.test(text),
    expert: /(医師|監修|院長|専門家|認定|資格|看護師)/.test(text),
    risk: /(リスク|副作用|注意事項|ダウンタイム|デメリット|合併症)/.test(text),
    structuredData: /application\/ld\+json/i.test(html),
  };
}

export async function profilePage(name: string, url: string): Promise<PageProfile> {
  const failed = (reason: string): PageProfile => ({
    name, url, readable: false, reason, title: "", titleLength: 0, descriptionLength: 0, h2Count: 0, textLength: 0, signals: null,
  });
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, "accept-language": "ja,en;q=0.8" },
      redirect: "follow",
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return failed(`HTTP ${res.status}`);
    const type = res.headers.get("content-type") ?? "";
    if (type && !/html|xml/i.test(type)) return failed("HTMLではありません");
    const html = (await res.text()).slice(0, MAX_HTML);
    const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim();
    const description = meta(html, "description") || meta(html, "og:description");
    const text = strip(html);
    // 本文がほとんど無いときは、JavaScriptで後から表示するページで、HTMLからは中身を読めない
    if (text.length < 300) return failed("本文がHTMLに含まれていない（JavaScriptで表示されるページ）");
    return {
      name,
      url,
      readable: true,
      reason: null,
      title,
      titleLength: Array.from(title).length,
      descriptionLength: Array.from(description).length,
      h2Count: (html.match(/<h2[\s>]/gi) ?? []).length,
      textLength: Array.from(text).length,
      signals: readSignals(html),
    };
  } catch (e) {
    return failed(e instanceof Error && e.name === "TimeoutError" ? "取得がタイムアウト" : "接続できない");
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("示唆の生成が時間内に終わりませんでした")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** 取れた事実だけから決まる比較表と数値比較。AIを使わない */
export function compare(own: PageProfile | null, comps: PageProfile[]): Pick<CompetitorAnalysis, "rows" | "numbers"> {
  const readable = comps.filter((c) => c.readable && c.signals);
  const keys = Object.keys(LABELS) as (keyof PageSignals)[];
  const rows: SignalRow[] = keys.map((key) => ({
    key,
    label: LABELS[key],
    own: own?.readable && own.signals ? own.signals[key] : null,
    competitors: readable.filter((c) => c.signals![key]).length,
    total: readable.length,
  }));
  const num = (f: (p: PageProfile) => number) => ({
    own: own?.readable ? f(own) : null,
    median: median(readable.map(f)),
  });
  return {
    rows,
    numbers: [
      { label: "ページの文字数", ...num((p) => p.textLength) },
      { label: "見出し（h2）の数", ...num((p) => p.h2Count) },
      { label: "タイトルの文字数", ...num((p) => p.titleLength) },
      { label: "説明文（description）の文字数", ...num((p) => p.descriptionLength) },
    ],
  };
}

/**
 * 差があった項目を、事実だけで文章にする（AIが使えなくても出せる最低限の示唆）。
 * 「競合の半数以上が載せているのに自社に無い」「自社だけが載せている」を拾う
 */
export function factInsights(rows: SignalRow[]): string[] {
  const out: string[] = [];
  for (const r of rows) {
    if (r.total === 0 || r.own === null) continue;
    if (!r.own && r.competitors * 2 >= r.total) {
      out.push(`${r.label}：競合${r.total}件中${r.competitors}件が載せていますが、自社のページでは確認できませんでした。`);
    } else if (r.own && r.competitors * 2 < r.total) {
      out.push(`${r.label}：自社は載せています。競合は${r.total}件中${r.competitors}件にとどまります。`);
    }
  }
  return out;
}

export async function analyzeCompetitors(
  d: Diagnosis,
  ownUrl: string | null,
  items: { name: string; url: string; keyword: string; note: string }[]
): Promise<CompetitorAnalysis | null> {
  if (items.length === 0) return null;
  // 同じURLを何度も読まない
  const seen = new Set<string>();
  const targets = items.filter((x) => (seen.has(x.url) ? false : (seen.add(x.url), true))).slice(0, 6);

  const [own, profiles] = await Promise.all([
    ownUrl ? profilePage("自社", ownUrl) : Promise.resolve(null),
    Promise.all(targets.map((t) => profilePage(t.name, t.url))),
  ]);
  const { rows, numbers } = compare(own, profiles);
  const base: CompetitorAnalysis = { own, profiles, rows, numbers, insights: factInsights(rows) };

  const readable = profiles.filter((p) => p.readable);
  if (readable.length === 0 || !own?.readable) return base;

  // 示唆は、集計した事実と、検索結果で見えた競合の訴求だけを材料にAIが書く
  try {
    const lines = rows.map((r) => `- ${r.label}：自社=${r.own === null ? "不明" : r.own ? "あり" : "なし"}／競合=${r.competitors}/${r.total}件`);
    const nums = numbers.map((n) => `- ${n.label}：自社=${n.own ?? "不明"}／競合の中央値=${n.median ?? "不明"}`);
    // 再試行まで含めると数分かかりうるので、この補助的な生成に使う時間は全体で75秒までにする
    const res = await withTimeout(
      askJson<{ insights: string[] }>(
      `あなたは広告・集客の分析者です。自社サイトと、検索で上位に出ていた競合ページを同じ項目で比べた結果から、
自社が次に打つ手のヒントになる「示唆」を書きます。

守ること:
- 示唆は3〜4件。**下の【比較結果】と【競合の訴求】に書かれている事実だけ**を根拠にする。書かれていない数字・事実を作らない
- 各示唆は「何が分かったか（数字を引用）→ だから何をするとよいか」の順で、1件を80〜140字で書く
- 競合は「検索で上位に出ていたページ」で、自社は「トップページ」。ページの種類が違う項目（文字数・見出し数など）は、
  差があっても優劣を断定しない
- 「競合の半数以上が載せていて自社に無い項目」と「自社だけが載せている強み」を優先して取り上げる
- 効果や成果を断定しない（「必ず」「増える」「改善する」は使わない）。「〜を検討する価値がある」「〜が考えられる」のように書く
- 医療・美容など規制のある業種では、料金や症例の掲載に広告規制（医療広告ガイドライン等）の確認が要る旨に触れてよい`,
      `商材: ${d.product}
ターゲット: ${d.audience}
自社の強み: ${d.strengths.join(" / ")}

【比較結果】（読めた競合 ${readable.length} 件）
${lines.join("\n")}
${nums.join("\n")}

【競合の訴求】（検索結果で見えたもの）
${targets.map((t) => `- ${t.name}（${t.keyword}）：${t.note}`).join("\n")}

出力: {"insights":["",""]}`,
      { maxTokens: 1500, timeoutMs: 60_000 }
      ),
      75_000
    );
    const insights = (res.insights ?? []).filter((x) => typeof x === "string" && x.trim()).slice(0, 4);
    return { ...base, insights: insights.length > 0 ? insights : base.insights };
  } catch (e) {
    return { ...base, insightError: e instanceof Error ? e.message.slice(0, 120) : "示唆の生成に失敗しました" };
  }
}
