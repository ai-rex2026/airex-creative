import { askJson } from "./anthropic";
import type { Diagnosis } from "./types";
import type { SiteScan } from "./site-scan";
import type { CompetitorScan } from "./competitors";
import { platformNotes } from "./ad-platforms";

/**
 * 検索サジェスト対策と外部施策。
 *
 * サジェストは Google の公開エンドポイントから実測する。
 * 「どう対策するか」だけを AI に書かせても、いま何が出ているかが分からなければ動けない。
 */

/** 第三者サイトへ流れる語。ここに流れると自社で内容を制御できない */
const LEAKY = /口コミ|評判|レビュー|比較|ランキング|おすすめ|2ch|5ch|知恵袋/;
/** そのまま見せると不利になる語 */
const HARMFUL = /悪い|ひどい|最悪|やばい|失敗|後悔|炎上|訴訟|詐欺|ステマ|嘘|被害|クレーム|返金|解約|退職|ブラック|パワハラ/;

export type SuggestKind = "注意" | "誘導先に注意" | "同名の別物" | "中立";

export type SuggestRow = {
  keyword: string;
  suggestion: string;
  kind: SuggestKind;
};

export type SuggestScan = {
  rows: SuggestRow[];
  /** 取得できた検索語 */
  queried: string[];
  fetchedAt: string;
};

/** Google の公開サジェスト。認証も課金も要らない */
async function suggestFor(q: string): Promise<string[]> {
  const url =
    "https://suggestqueries.google.com/complete/search?client=firefox&hl=ja&gl=jp&q=" +
    encodeURIComponent(q);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const j = (await res.json()) as [string, string[]];
    return Array.isArray(j?.[1]) ? j[1] : [];
  } catch {
    return [];
  }
}

const JA = /[ぁ-んァ-ヶ一-龠]/;

function classify(s: string, base: string): SuggestKind {
  const tail = s.replace(new RegExp(base, "i"), "").trim();
  if (HARMFUL.test(tail)) return "注意";
  if (LEAKY.test(tail)) return "誘導先に注意";
  // ブランド名が英字だと同名の海外施設が混ざる。指名検索で埋もれている状態なので、
  // ノイズとして捨てずに「別物」として見せる
  if (!JA.test(s) && !JA.test(base)) return "同名の別物";
  return "中立";
}

/** ブランド名まわりのサジェストを実測する */
/**
 * サジェストに投げる語。
 * 商材の説明文のような長い文はサジェストが返らないので、短い語だけを使う。
 * 地名は候補を順に試し、実際に返ったものだけ採用する（町名まで細かいと何も返らない）。
 */
function candidates(site: SiteScan | null, areas: string[]): string[] {
  const brand = site?.bizName || site?.title?.split(/[|｜\-–—:：]/).pop()?.trim() || "";
  if (brand.length < 2) return [];
  const out = [brand, ...areas.map((a) => `${brand} ${a}`)];
  return [...new Set(out.map((x) => x.trim()).filter((x) => x.length >= 2 && x.length <= 25))];
}

export async function scanSuggests(
  d: Diagnosis,
  site: SiteScan | null,
  areas: string[] = []
): Promise<SuggestScan> {
  const rows: SuggestRow[] = [];
  const got: string[] = [];
  // 地名を足した2本目は1本目と結果が重なる。同じ語を2回出さない
  const seen = new Set<string>();

  for (const q of candidates(site, areas)) {
    if (got.length >= 2) break;
    const list = (await suggestFor(q)).filter(
      // 検索語そのものは対策対象ではない
      (x) => x.trim().toLowerCase() !== q.trim().toLowerCase()
    );
    const fresh = list.filter((x) => !seen.has(x.trim().toLowerCase()));
    if (fresh.length === 0) continue; // 新しい語が無い検索語は画面に出さない
    got.push(q);
    for (const x of fresh.slice(0, 10)) {
      seen.add(x.trim().toLowerCase());
      rows.push({ keyword: q, suggestion: x, kind: classify(x, q) });
    }
  }
  return { rows, queried: got, fetchedAt: new Date().toISOString() };
}

// ── 外部施策 ────────────────────────────────────

export type CitationTarget = {
  site: string;
  kind: string;
  why: string;
  how: string;
};

export type AffiliatePlan = {
  /** 向かないなら false。理由を必ず書く */
  fit: boolean;
  reason: string;
  asps: string[];
  /** 成果地点と単価の考え方 */
  terms: string;
  /** 業種特有の注意（医療広告GL 等） */
  caution: string | null;
};

export type OutreachPlan = {
  citations: CitationTarget[];
  affiliate: AffiliatePlan;
  /** サジェストへの打ち手。実測した内容を踏まえて書かせる */
  suggestActions: string[];
  prThemes: string[];
};

export async function generateOutreach(
  d: Diagnosis,
  suggests: SuggestScan,
  competitors: CompetitorScan | null
): Promise<OutreachPlan> {
  const risky = suggests.rows.filter((r) => r.kind !== "中立");

  return askJson<OutreachPlan>(
    `あなたは外部露出（PR・掲載・アフィリエイト）の実務者です。自社サイトの外側で何をするかを設計します。

守ること:
- citations は4〜6件。**その業種で実在する掲載先の種類**を挙げる
  （例：業種別ポータル、比較メディア、地域情報サイト、業界紙、プレスリリース配信）
  site は媒体名かカテゴリ名。実在が確かでないサービス名を書かない
  how は「誰がどう申し込むか」を1文で
- affiliate は、この商材にアフィリエイトが向くかを判断する
  **業種を理由に「規制で禁止」と断定しない。** 規制がある業種でも実際に運用されている
  ことがある。禁止かどうかは下の【媒体の事実】に書いてある場合だけそれに従う
  fit:false にしてよいのは、単価が低く報酬を出せない／在庫や枠に限りがあり集客を
  増やせない、といった**この商材固有の事情**があるときだけ
  向くなら日本で実在する ASP 名を2〜3件
  caution には運用上の留意点（掲載内容の管理責任など）を書く。無ければ null
- suggestActions は3〜5件。**下に渡す実測のサジェストを踏まえて**書く。
  一般論（「ポジティブな情報を増やす」等）は書かない。どの語に何をするかを書く
- prThemes は3〜4件。この商材の事実を使う。誇張しない
- 効果を断定する表現・最上級表現は書かない`,
    `商材: ${d.product}
ターゲット: ${d.audience}
業種: ${d.industry}
強み: ${d.strengths.join(" / ")}
買わない理由: ${d.objections.join(" / ")}

【媒体の事実】※ 自分の知識より、ここに書いてあることを優先する
${platformNotes()}

実測した検索サジェスト（${suggests.queried.join(" / ")}）:
${suggests.rows.length ? suggests.rows.map((r) => `- ${r.suggestion}（${r.kind}）`).join("\n") : "- 取得できませんでした"}
${risky.length ? `\n※ このうち ${risky.map((r) => `「${r.suggestion}」`).join("・")} は放置すると不利になります` : ""}
${competitors?.items?.length ? `\n競合: ${competitors.items.slice(0, 5).map((c) => c.name).join(" / ")}` : ""}

出力: {"citations":[{"site":"","kind":"","why":"","how":""}],
 "affiliate":{"fit":true,"reason":"","asps":[""],"terms":"","caution":null},
 "suggestActions":[""],"prThemes":[""]}`,
    { maxTokens: 4000 }
  );
}
