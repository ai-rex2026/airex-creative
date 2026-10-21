import type { SiteScan } from "../site-scan";

/**
 * 内部対策（2026-10-21 新設）：自社サイト・LP で行う対策を1つのリストで持つ。
 * SEO と AIO で大部分が同じ作業なので、施策ごとに「SEO／AIO／両方」の印を付け、
 * SEO運用とAIOの「内部対策」タブは同じリストを印で絞って見せる（どちらで済みにしても両方で済みになる）。
 *
 * 洗い出しはサイトの読み取り（HTML・robots.txt・llms.txt）からの決定的な判定と、
 * 実測では確かめられない定番の確認項目だけで作り、AI は呼ばない（無料・何度でも回せる）。
 * 同じ施策は key で1件にまとめ、利用者が付けた状態（済み・対応中）は上書きしない。
 */

export type InternalScope = "seo" | "aio" | "both";
export type InternalStatus = "todo" | "doing" | "done" | "skip";
export type InternalPriority = "高" | "中" | "低";

export type InternalTask = {
  id: string;
  key: string;
  title: string;
  detail: string;
  scope: InternalScope;
  priority: InternalPriority;
  status: InternalStatus;
  /** どこから来たか（サイトの読み取り・定番の確認項目・URLレポート・手入力） */
  source: "scan" | "checklist" | "report" | "manual";
  /** サイトを読んで確かめた結果か（false は人が確かめる項目） */
  measured: boolean;
  note: string;
  createdAt: string;
  updatedAt: string;
};

export type InternalDraft = Pick<InternalTask, "key" | "title" | "detail" | "scope" | "priority" | "source" | "measured">;

export const SCOPE_LABEL: Record<InternalScope, string> = { seo: "SEO", aio: "AIO", both: "SEO・AIO" };
export const STATUS_LABEL: Record<InternalStatus, string> = { todo: "未対応", doing: "対応中", done: "済み", skip: "対象外" };

/** AI のクローラー（robots.txt の User-agent 名）。検索向けと学習向けが混ざるので、許可するかは事業者が決める */
export const AI_CRAWLERS = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "Google-Extended", "PerplexityBot", "ClaudeBot", "Claude-SearchBot", "anthropic-ai", "CCBot", "Bingbot"];

/** robots.txt で、サイト全体（Disallow: /）を止めている User-agent を返す */
export function blockedAgents(robots: string, agents: string[] = AI_CRAWLERS): string[] {
  const groups: { agents: string[]; rules: string[] }[] = [];
  let cur: { agents: string[]; rules: string[] } | null = null;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const k = m[1].toLowerCase();
    const v = m[2].trim();
    if (k === "user-agent") {
      if (!cur || cur.rules.length) {
        cur = { agents: [], rules: [] };
        groups.push(cur);
      }
      cur.agents.push(v.toLowerCase());
    } else if (cur && (k === "disallow" || k === "allow")) {
      cur.rules.push(`${k}:${v}`);
    }
  }
  const fullBlock = (g: { rules: string[] }) => g.rules.includes("disallow:/") && !g.rules.some((r) => r === "allow:/");
  const out: string[] = [];
  for (const a of agents) {
    const own = groups.find((g) => g.agents.includes(a.toLowerCase()));
    const star = groups.find((g) => g.agents.includes("*"));
    const g = own ?? star;
    if (g && fullBlock(g)) out.push(a);
  }
  return out;
}

export type SweepInput = {
  site: SiteScan | null;
  /** robots.txt の本文（読めなければ null） */
  robots: string | null;
  /** /llms.txt があるか（読めなければ null） */
  llms: boolean | null;
  /** HTML の中身の手がかり（scanSite が持たないもの） */
  html: { canonical: boolean; h1: number; ogp: boolean } | null;
};

/** サイトの読み取りから、内部対策の候補を作る（決定的） */
export function sweep(input: SweepInput): InternalDraft[] {
  const out: InternalDraft[] = [];
  const add = (d: Omit<InternalDraft, "source" | "measured">, measured = true) => out.push({ ...d, source: measured ? "scan" : "checklist", measured });
  const s = input.site;
  if (s) {
    if (!s.https) add({ key: "https", title: "サイト全体を https にする", detail: "http のままのページがあります。常時 SSL 化し、http から https へ 301 で転送します。", scope: "both", priority: "高" });
    if (!s.title || s.title.length < 10) add({ key: "title", title: "ページのタイトル（title）を整える", detail: `トップのタイトルが${s.title ? `「${s.title}」と短い` : "ありません"}。事業者名と、何の会社・サービスかが分かる語を入れます（30字前後）。`, scope: "seo", priority: "高" });
    if (!s.description) add({ key: "meta-description", title: "説明文（meta description）を入れる", detail: "検索結果に出る説明文がありません。ページごとに 100〜120 字で、何が分かるページかを書きます。", scope: "seo", priority: "中" });
    if (!s.robotsTxt) add({ key: "robots", title: "robots.txt を置く", detail: "robots.txt がありません。クロールさせたくない場所と、サイトマップの場所（Sitemap: 行）を書きます。", scope: "both", priority: "中" });
    if (!s.sitemapXml) add({ key: "sitemap", title: "XML サイトマップを置き、Search Console に送る", detail: "/sitemap.xml が見つかりませんでした。WordPress なら /wp-sitemap.xml が自動でできます。Search Console に送信します。", scope: "both", priority: "高" });
    if (!s.structuredData) add({ key: "schema-org", title: "構造化データ（Organization／LocalBusiness）を入れる", detail: "JSON-LD の構造化データが見つかりませんでした。社名・所在地・連絡先・ロゴ・公式 SNS（sameAs）を Organization（店舗なら LocalBusiness）で記述します。検索エンジンと AI が事業者を正しく読み取る手がかりになります。", scope: "both", priority: "高" });
    if (s.internalLinks < 10) add({ key: "internal-links", title: "内部リンクを増やす", detail: `トップからの内部リンクが ${s.internalLinks} 本です。主要なサービスのページ・コラム・会社情報へ、内容の分かる文言でリンクします。`, scope: "seo", priority: "中" });
  }
  if (input.html) {
    if (!input.html.canonical) add({ key: "canonical", title: "canonical を指定する", detail: "トップに canonical の指定がありません。URL の揺れ（www の有無・末尾の / ・パラメータ）で同じページが重複しないよう、正規の URL を指定します。", scope: "seo", priority: "中" });
    if (input.html.h1 !== 1) add({ key: "h1", title: "見出し（h1）を1つにする", detail: `トップの h1 が ${input.html.h1} 個です。ページの主題を表す h1 を1つだけ置きます。`, scope: "seo", priority: "低" });
    if (!input.html.ogp) add({ key: "ogp", title: "OGP（共有されたときの表示）を設定する", detail: "og:title・og:image などがありません。SNS や AI のサービスで共有されたときのタイトルと画像を指定します。", scope: "both", priority: "低" });
  }
  if (input.robots !== null) {
    const blocked = blockedAgents(input.robots);
    if (blocked.length)
      add({
        key: "ai-crawlers",
        title: "AI のクローラーを止めていないか決める",
        detail: `robots.txt でサイト全体を止めている AI のクローラーがあります（${blocked.join("・")}）。止めていると、そのAIの検索・回答でサイトの内容が使われにくくなります。学習への利用を避けたい場合と、AI 検索に出たい場合で判断が分かれるので、どれを許可するか決めます。`,
        scope: "aio",
        priority: "高",
      });
  }
  if (input.llms === false)
    add({ key: "llms-txt", title: "llms.txt を置くか決める（任意）", detail: "AI 向けにサイトの要点をまとめる llms.txt がありません。効果はまだ確認されていない新しい取り組みなので、優先度は低くしています。", scope: "aio", priority: "低" });

  // 実測では確かめられない、定番の確認項目（人が確かめて「済み」にする）
  const check = (d: Omit<InternalDraft, "source" | "measured">) => add(d, false);
  check({ key: "about", title: "会社情報・運営者情報のページを整える", detail: "社名・所在地・代表者・連絡先・沿革・許認可を1ページにまとめ、全ページのフッターからリンクします。誰が書いているサイトかが分かることは、検索の評価と AI の引用の両方で手がかりになります。", scope: "both", priority: "高" });
  check({ key: "author", title: "記事に著者・監修者を載せる", detail: "コラムの記事ごとに、書いた人・監修した人の名前と経歴を載せます。", scope: "both", priority: "中" });
  check({ key: "faq", title: "よくある質問のページを置く", detail: "見込み客がよく聞くことに、1問1答で答えるページを置きます（FAQPage の構造化データもあわせて）。AI が問いへの答えとして引用しやすい形です。", scope: "both", priority: "中" });
  check({ key: "answer-first", title: "主要ページの冒頭に結論を書く", detail: "サービス・料金・選び方のページの冒頭に、「何ができて、誰向けで、いくらか」を2〜3文でまとめます。AI は冒頭の要点を引用しやすいです。", scope: "aio", priority: "中" });
  check({ key: "entity", title: "社名・サービス名の表記をそろえる", detail: "サイト・Googleビジネスプロフィール・SNS・外部の掲載で、社名・サービス名・所在地・電話番号の表記を同じにします。表記が揺れると、検索エンジンと AI が同じ事業者だと判断しにくくなります。", scope: "both", priority: "中" });
  check({ key: "facts", title: "数字の事実を出所つきで載せる", detail: "実績件数・創業年・対応エリア・料金などを、いつ時点の数字か・出所とあわせて載せます（根拠の無い数字は載せません）。", scope: "aio", priority: "低" });
  check({ key: "cwv", title: "表示速度（Core Web Vitals）を確かめる", detail: "PageSpeed Insights でモバイルの LCP・INP・CLS を確かめ、画像の圧縮・遅延読み込み・不要なスクリプトの整理をします。", scope: "seo", priority: "中" });
  return out;
}

/** HTML から、scanSite が持たない手がかりを数える */
export function htmlHints(html: string): { canonical: boolean; h1: number; ogp: boolean } {
  return {
    canonical: /<link[^>]+rel=["']canonical["']/i.test(html),
    h1: (html.match(/<h1[\s>]/gi) ?? []).length,
    ogp: /<meta[^>]+property=["']og:(title|image)["']/i.test(html),
  };
}

/** URLレポート（analyses）から取り込む内部対策。外部施策（掲載・PR・SNS など）は除く */
const EXTERNAL = /掲載|プレスリリース|PR TIMES|寄稿|取材|比較サイト|ポータル|SNS|Instagram|X（|TikTok|YouTube|広告|口コミ|レビュー|被リンク/;

export function fromReport(r: { technical?: string[] | null; aioMeasures?: { title: string; why: string }[] | null }): InternalDraft[] {
  const out: InternalDraft[] = [];
  const seen = new Set<string>();
  const push = (title: string, detail: string, scope: InternalScope) => {
    const t = title.replace(/\s+/g, " ").trim().slice(0, 120);
    if (!t || EXTERNAL.test(t) || seen.has(t)) return;
    seen.add(t);
    out.push({ key: `report:${t}`, title: t, detail: detail.slice(0, 400), scope, priority: "中", source: "report", measured: false });
  };
  for (const t of r.technical ?? []) if (typeof t === "string") push(t, "URLレポートの「対策キーワード」章の技術面の指摘です。", "seo");
  for (const m of r.aioMeasures ?? []) push(m.title, m.why || "URLレポートの「AI検索での見え方」章の施策です。", "aio");
  return out.slice(0, 20);
}

export function rowToTask(r: Record<string, unknown>): InternalTask {
  const scope = r.scope === "seo" || r.scope === "aio" ? r.scope : "both";
  const status = ["todo", "doing", "done", "skip"].includes(String(r.status)) ? (r.status as InternalStatus) : "todo";
  const priority = ["高", "中", "低"].includes(String(r.priority)) ? (r.priority as InternalPriority) : "中";
  const source = ["scan", "checklist", "report", "manual"].includes(String(r.source)) ? (r.source as InternalTask["source"]) : "manual";
  return {
    id: String(r.id),
    key: String(r.key ?? ""),
    title: String(r.title ?? ""),
    detail: String(r.detail ?? ""),
    scope,
    priority,
    status,
    source,
    measured: r.measured === true,
    note: String(r.note ?? ""),
    createdAt: String(r.created_at ?? ""),
    updatedAt: String(r.updated_at ?? ""),
  };
}

/** タブごとの表示：SEO 運用は SEO と両方、AIO は AIO と両方 */
export function forTab(tasks: InternalTask[], tab: "seo" | "aio"): InternalTask[] {
  const order = { 高: 0, 中: 1, 低: 2 } as const;
  const st = { doing: 0, todo: 1, done: 2, skip: 3 } as const;
  return tasks
    .filter((t) => t.scope === "both" || t.scope === tab)
    .sort((a, b) => st[a.status] - st[b.status] || order[a.priority] - order[b.priority] || a.createdAt.localeCompare(b.createdAt));
}
