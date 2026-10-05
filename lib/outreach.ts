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
  /** 取得に失敗したときの理由 */
  error?: string;
  /** 候補を採った取得元。Googleから1件も取れなかったときだけ Bing で代替する */
  source?: "Google" | "Bing";
  /** 検索語ごとの取得結果（原因調査用。「検出なし」の内訳を残す） */
  trace?: { q: string; source: string; n: number; error?: string }[];
};

/**
 * Google の「サジェスト」機能が内部で使っている、認証も課金も要らないエンドポイント
 * （公式に公開されたAPIではない）。そのため共有のクラウドIPからだと稀に一時的な
 * 制限・遮断を受ける可能性があり、それが起きても今まで黙って空配列を返していたため、
 * 「検出なし」と「取得自体に失敗した」が画面上は区別できなかった。
 * 失敗した場合はその理由を返し、呼び出し元（scanSuggests）が SuggestScan.error に記録する。
 */
type SuggestSource = "google-firefox" | "google-chrome" | "bing";

function suggestUrl(source: SuggestSource, q: string): string {
  const enc = encodeURIComponent(q);
  if (source === "bing") return `https://api.bing.com/osjson.aspx?query=${enc}&mkt=ja-JP`;
  const client = source === "google-chrome" ? "chrome" : "firefox";
  return `https://suggestqueries.google.com/complete/search?client=${client}&hl=ja&gl=jp&q=${enc}`;
}

async function suggestOnce(q: string, source: SuggestSource): Promise<{ items: string[]; error?: string }> {
  try {
    const res = await fetch(suggestUrl(source, q), {
      headers: { "user-agent": "Mozilla/5.0", "accept-language": "ja,en;q=0.8" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { items: [], error: `サジェストの取得に失敗しました（HTTP ${res.status}）` };
    const j = (await res.json()) as [string, string[]];
    return { items: Array.isArray(j?.[1]) ? j[1].filter((x) => typeof x === "string") : [] };
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError") {
      return { items: [], error: "サジェストの取得が時間内に終わりませんでした（8秒以内に応答がありませんでした）" };
    }
    return { items: [], error: e instanceof Error ? `サジェストの取得に失敗しました（${e.message}）` : "サジェストの取得に失敗しました" };
  }
}

/**
 * 2026-10-05: Googleは共有のクラウドIPからだと、エラーにせず「空の候補」を返すことがある
 * （実際に、利用者が手元で検索すると出るブランド名で、サーバーからは毎回0件・エラー無しだった）。
 * そのため「失敗したときだけ」ではなく「0件だったとき」も別のクライアント指定で再試行し、
 * 各試行の結果を trace に残す（何が起きたかを後から確認できるように）。
 */
async function suggestFor(
  q: string,
  sources: SuggestSource[]
): Promise<{ items: string[]; error?: string; trace: { q: string; source: string; n: number; error?: string }[] }> {
  const trace: { q: string; source: string; n: number; error?: string }[] = [];
  let lastError: string | undefined;
  for (const src of sources) {
    const r = await suggestOnce(q, src);
    trace.push({ q, source: src, n: r.items.length, ...(r.error ? { error: r.error } : {}) });
    if (r.items.length > 0) return { items: r.items, trace };
    if (r.error) lastError = r.error;
  }
  return { items: [], error: lastError, trace };
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

/** タイトルの区切りの片側に来がちな、ブランド名ではない語。候補から除く */
const GENERIC_TITLE_WORD = /^(公式(サイト|ホームページ)?|ホームページ|トップ(ページ)?|TOP|HOME)$/i;

/**
 * ブランド名の候補を、構造化データ（bizName）が無い場合はタイトルから推測する。
 *
 * 2026-10-05: 従来は `title.split(区切り).pop()`（最後の区切りの語）だけを使っていたが、
 * 日本語のサイトタイトルは「会社名｜キャッチコピー」（会社名が先）と
 * 「キャッチコピー｜会社名」（会社名が後）のどちらの並びも普通にあり、タイトルの形だけでは
 * どちらが正しいブランド名か判別できない。常に末尾だけを採る実装では、会社名が先に来る
 * タイトルのサイトで的外れな語（キャッチコピー側）をサジェストに投げてしまい、
 * 「検出されませんでした」になっていた可能性が高い。先頭・末尾の両方を候補にして、
 * 実際にサジェストが返った方を採用する（scanSuggests側は返りがあった語だけ画面に出す）。
 */
/** 法人格。サジェストに投げるときは外す（「株式会社〇〇」より「〇〇」で検索される） */
const LEGAL_FORM = /(株式会社|有限会社|合同会社|合資会社|一般社団法人|一般財団法人|公益社団法人|公益財団法人|医療法人社団|医療法人財団|医療法人|社会福祉法人|学校法人|特定非営利活動法人|NPO法人)/g;

/**
 * ブランド名の候補を、確からしい順に集める。
 *
 * 2026-10-05（再修正）: 実際の失敗例は、構造化データの事業者名（bizName）が
 * 「一般社団法人 表参道メディカルクリニックグループ」のような**法人名**で、一方ブランド名
 * （メディカルブロー）はタイトルや商材名にあるケースだった。従来は bizName があると
 * それだけを検索していたため、利用者が実際に検索する名前（ブランド名）が一度も試されず
 * 「検出されませんでした」になっていた。
 *
 * そこで次をすべて候補にし、実際にサジェストが返った語だけを画面に出す：
 *  1. 商材名の先頭（「メディカルブロー（医療アートメイク）」→「メディカルブロー」）
 *  2. タイトルの区切りの両端（短い語のみ。長いキャッチコピーは除く）
 *  3. ドメインの名前部分（medicalbrows.jp → medicalbrows）。英字表記で検索する人向け
 *  4. 事業者名（法人格を除いたもの）
 */
export function brandCandidates(d: Diagnosis | null, site: SiteScan | null): string[] {
  const out: string[] = [];
  const add = (s: string | null | undefined) => {
    const v = (s ?? "").replace(/\s+/g, " ").trim();
    if (v.length >= 2 && v.length <= 20 && !GENERIC_TITLE_WORD.test(v)) out.push(v);
  };

  // 1. 商材名の先頭。括弧・スラッシュ・読点の手前までをブランド名とみなす
  const product = (d?.product ?? "").split(/[（(／/、,・]/)[0];
  add(product);

  // 2. タイトルの両端（長いキャッチコピーは検索語にならないので 14 文字までに絞る）
  const parts = (site?.title ?? "")
    .split(/[|｜\-–—:：]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length > 0) {
    for (const p of [parts[0], parts[parts.length - 1]]) if (p.length <= 14) add(p);
  }

  // 3. ドメインの名前部分（英字3文字以上のときだけ）
  try {
    const host = new URL(site?.finalUrl ?? "").hostname.replace(/^www\./, "");
    const label = host.split(".")[0];
    if (/^[a-z][a-z0-9-]{3,}$/i.test(label)) add(label);
  } catch {
    // finalUrl が無い・不正なら使わない
  }

  // 4. 事業者名（法人格を外す）。長い法人名はそのままだと検索語として長すぎるので末尾を優先
  if (site?.bizName) add(site.bizName.replace(LEGAL_FORM, "").trim());

  return [...new Set(out)];
}

/**
 * サジェストに投げる語。
 * 商材の説明文のような長い文はサジェストが返らないので、短い語だけを使う。
 * 地名は候補を順に試し、実際に返ったものだけ採用する（町名まで細かいと何も返らない）。
 * 地名つきの語は先頭のブランド名にだけ付ける（候補が多いと問い合わせ回数が増えすぎるため）。
 */
function candidates(d: Diagnosis | null, site: SiteScan | null, areas: string[]): string[] {
  const brands = brandCandidates(d, site);
  if (brands.length === 0) return [];
  const out = [...brands, ...areas.map((a) => `${brands[0]} ${a}`)];
  return [...new Set(out.map((x) => x.trim()).filter((x) => x.length >= 2 && x.length <= 25))].slice(0, 8);
}

export async function scanSuggests(
  d: Diagnosis,
  site: SiteScan | null,
  areas: string[] = []
): Promise<SuggestScan> {
  const cands = candidates(d, site, areas);
  const trace: NonNullable<SuggestScan["trace"]> = [];

  const run = async (sources: SuggestSource[], limit: number) => {
    const rows: SuggestRow[] = [];
    const got: string[] = [];
    // 地名を足した2本目は1本目と結果が重なる。同じ語を2回出さない
    const seen = new Set<string>();
    // 取得自体に失敗した検索語の理由を集める。「検出なし（正常に取得できたが0件）」とは区別し、
    // 全ての検索語で取得に失敗した場合だけ SuggestScan.error に出す
    const errors: string[] = [];
    for (const q of cands.slice(0, limit)) {
      if (got.length >= 2) break;
      const { items, error, trace: t } = await suggestFor(q, sources);
      trace.push(...t);
      if (error && items.length === 0) errors.push(error);
      const list = items.filter(
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
    return { rows, got, errors };
  };

  // まずGoogle（firefox指定→0件・失敗ならchrome指定）。それでも1件も取れなければ Bing で代替する
  let { rows, got, errors } = await run(["google-firefox", "google-chrome"], cands.length);
  let source: "Google" | "Bing" = "Google";
  if (got.length === 0 && cands.length > 0) {
    const bing = await run(["bing"], 4);
    if (bing.got.length > 0) {
      rows = bing.rows;
      got = bing.got;
      source = "Bing";
    }
  }

  // 試した検索語が1つ以上あり、1件も拾えず、かつ全件が「取得失敗」だった場合だけ
  // エラーとして出す（検索ボリュームが少なくて0件、のような正常系は error を付けない）
  const allFailed = cands.length > 0 && got.length === 0 && errors.length >= cands.length;
  return {
    rows,
    queried: got,
    fetchedAt: new Date().toISOString(),
    error: allFailed ? errors[errors.length - 1] : undefined,
    source,
    trace,
  };
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
  /**
   * ネガティブ対策。悪い評判・誤解が広がったときに備えて先にやること（本体 ch6_pr.negative_countermeasures）。
   * 古い分析には無い
   */
  negatives?: string[];
  /** 生成に失敗したときの理由 */
  error?: string;
};

const NEGATIVE_RULES = `- negatives は4〜5件。**悪い評判や誤解が広がったときに備えて、先にやっておくこと**を書く
  対象の例：低評価の口コミへの返信方針、よくある誤解（料金・痛み・副作用・解約など）を先回りして説明するページ、
  指名検索で不利な語が出たときの受け皿、SNSでの批判への初動（誰が・何時間以内に・どこで返すか）、
  社内の問い合わせ窓口の一本化
  サジェストに「注意」の語があれば、その語への対処を必ず含める。
  口コミの削除依頼・サクラ投稿・逆SEOのような、規約や法律に触れる手段は書かない`;

export async function generateOutreach(
  d: Diagnosis,
  suggests: SuggestScan,
  competitors: CompetitorScan | null
): Promise<OutreachPlan> {
  const risky = suggests.rows.filter((r) => r.kind !== "中立");

  const plan = await askJson<OutreachPlan>(
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
${NEGATIVE_RULES}
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
 "suggestActions":[""],"prThemes":[""],"negatives":[""]}`,
    { maxTokens: 4000 }
  );
  // 文字列の配列のはずが {"action":"..."} のようなオブジェクトで返ることがある。画面が落ちるので文字列に直して保存する
  const str = (x: unknown): string => {
    if (typeof x === "string") return x;
    if (x && typeof x === "object") {
      const v = Object.values(x as Record<string, unknown>).find((y) => typeof y === "string");
      return typeof v === "string" ? v : "";
    }
    return x == null ? "" : String(x);
  };
  const strs = (xs: unknown): string[] => (Array.isArray(xs) ? xs.map(str).filter((s) => s.trim()) : []);
  return {
    ...plan,
    suggestActions: strs(plan.suggestActions),
    prThemes: strs(plan.prThemes),
    negatives: plan.negatives === undefined ? undefined : strs(plan.negatives),
  };
}

/** 古い分析に、ネガティブ対策だけを後から足す */
export async function generateNegatives(d: Diagnosis, suggests: SuggestScan | null): Promise<string[]> {
  const risky = (suggests?.rows ?? []).filter((r) => r.kind !== "中立");
  const res = await askJson<{ negatives: string[] }>(
    `あなたは広報・評判管理の実務者です。
${NEGATIVE_RULES}
- 効果を断定する表現・最上級表現は書かない`,
    `商材: ${d.product}
ターゲット: ${d.audience}
業種: ${d.industry}
買わない理由: ${d.objections.join(" / ")}
${suggests?.rows.length ? `実測した検索サジェスト:\n${suggests.rows.map((r) => `- ${r.suggestion}（${r.kind}）`).join("\n")}` : "検索サジェストは取得できていません"}
${risky.length ? `\n※ このうち ${risky.map((r) => `「${r.suggestion}」`).join("・")} は放置すると不利になります` : ""}

出力: {"negatives":[""]}`,
    { maxTokens: 2000 }
  );
  return (res.negatives ?? []).filter(Boolean).slice(0, 6);
}
