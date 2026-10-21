import { askJson } from "../anthropic";
import { normalizeJapanese } from "../meo-ops/japanese";
import { CHANNEL_LABEL, type AioChannelKind, type AioSample, type AioStrategy, type AioStyle } from "./content-types";
import { apiUrl, decodeEntities, fetchHtml, htmlToText, publicFetch } from "./net";
import type { AioProject } from "./types";

/**
 * 既存記事を集めて、トンマナ（文体・見出し・構成・画像の使い方）を読む。
 * 数（文字数・見出しの数・です／ます率）はコードで数え、AI には言葉で表すところだけを任せる。
 *
 * 集め方:
 * - 自社サイト: WordPress なら REST（/wp-json/wp/v2/posts）で本文ごと取る。無ければ RSS → 一覧ページのリンク
 * - note: アカウントの RSS（https://note.com/{id}/rss。公開されているフィード）→ 各記事ページ
 */

export type Collected = { url: string; title: string; html: string; text: string };

export type CollectResult = {
  articles: Collected[];
  /** WordPress だと分かったとき、その REST の入口（例 https://example.com/wp-json/） */
  wpApiRoot: string | null;
  /** 読めなかったときの理由（画面に出す） */
  notes: string[];
};

const MAX_ARTICLES = 6;

export type CollectDeps = {
  fetchHtml: typeof fetchHtml;
  fetchJson: (url: string) => Promise<unknown>;
};

export const COLLECT_DEPS: CollectDeps = {
  fetchHtml,
  fetchJson: async (url) => {
    const res = await publicFetch(url, { headers: { accept: "application/json" }, timeoutMs: 15_000 });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("json")) throw new Error("JSON ではありません");
    return res.json();
  },
};

/** note のアカウントURL → ユーザー名（https://note.com/xxxx[/...]） */
export function noteUser(url: string): string | null {
  try {
    const u = new URL(/^https?:\/\//.test(url) ? url : `https://${url}`);
    if (!/(^|\.)note\.com$/.test(u.hostname)) return null;
    const seg = u.pathname.split("/").filter(Boolean)[0];
    return seg && /^[A-Za-z0-9_-]+$/.test(seg) ? seg : null;
  } catch {
    return null;
  }
}

function parseRss(xml: string): { title: string; link: string; description: string }[] {
  return [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)].map((m) => {
    const it = m[0];
    const pick = (tag: string) => {
      const r = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i").exec(it)?.[1] ?? "";
      return decodeEntities(r.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "")).trim();
    };
    return { title: pick("title"), link: pick("link"), description: pick("description") };
  });
}

/** 記事ページの本文らしい部分（<article> → <main> → body） */
export function articleRegion(html: string): string {
  const pick = (re: RegExp) => re.exec(html)?.[1];
  return pick(/<article[^>]*>([\s\S]*?)<\/article>/i) ?? pick(/<main[^>]*>([\s\S]*?)<\/main>/i) ?? pick(/<body[^>]*>([\s\S]*?)<\/body>/i) ?? html;
}

const titleOf = (html: string) => decodeEntities((/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").replace(/<[^>]+>/g, "")).trim();

async function readArticle(deps: CollectDeps, url: string, fallback?: { title: string; description: string }): Promise<Collected> {
  try {
    const { html, finalUrl } = await deps.fetchHtml(url, { browserUa: true });
    const region = articleRegion(html);
    const text = htmlToText(region);
    if (text.length < 300 && fallback?.description) throw new Error("short");
    return { url: finalUrl, title: titleOf(region) || titleOf(html) || fallback?.title || "", html: region, text };
  } catch (e) {
    if (fallback?.description) {
      return { url, title: fallback.title, html: fallback.description, text: htmlToText(fallback.description) };
    }
    throw e;
  }
}

/** 一覧ページから、同じサイトの記事らしいリンクを拾う */
export function articleLinks(html: string, listUrl: string): string[] {
  const base = new URL(listUrl);
  const prefix = base.pathname.replace(/\/+$/, "");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of html.matchAll(/<a\s[^>]*href=["']([^"'#]+)["']/gi)) {
    let u: URL;
    try {
      u = new URL(decodeEntities(m[1]), base);
    } catch {
      continue;
    }
    if (u.hostname !== base.hostname) continue;
    u.hash = "";
    u.search = "";
    const p = u.pathname.replace(/\/+$/, "");
    if (!p || p === prefix) continue;
    if (prefix && !p.startsWith(prefix + "/")) continue;
    if (/\/(page|category|tag|author|feed|wp-content|wp-admin|wp-json)(\/|$)/.test(p) || /\.(jpg|jpeg|png|gif|webp|pdf|zip|css|js|xml)$/i.test(p)) continue;
    // 一覧より1段以上深いもの（/column/xxx）。サイト全体が一覧なら2文字以上のパス
    const key = u.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/** WordPress の REST の入口を探す（<link rel="https://api.w.org/">、無ければ /wp-json/） */
export function wpApiRootFromHtml(html: string): string | null {
  const m = /<link[^>]+rel=["']https:\/\/api\.w\.org\/["'][^>]*href=["']([^"']+)["']/i.exec(html) ?? /<link[^>]+href=["']([^"']+)["'][^>]*rel=["']https:\/\/api\.w\.org\/["']/i.exec(html);
  return m ? decodeEntities(m[1]) : null;
}

export async function collectArticles(kind: AioChannelKind, sourceUrl: string, deps: CollectDeps = COLLECT_DEPS): Promise<CollectResult> {
  const notes: string[] = [];
  if (kind === "note") {
    const user = noteUser(sourceUrl);
    if (!user) throw new Error("note のアカウントURL（https://note.com/アカウント名）を入れてください");
    const { html: xml } = await deps.fetchHtml(`https://note.com/${user}/rss`);
    const items = parseRss(xml).filter((i) => i.link).slice(0, MAX_ARTICLES);
    if (!items.length) throw new Error("note の記事が見つかりませんでした（公開記事が無いか、アカウント名が違う可能性があります）");
    const settled = await Promise.allSettled(items.map((i) => readArticle(deps, i.link, i)));
    const articles = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
    if (articles.length < items.length) notes.push(`${items.length - articles.length}本は読めませんでした`);
    return { articles, wpApiRoot: null, notes };
  }

  // 自社サイト
  const { html: listHtml, finalUrl } = await deps.fetchHtml(sourceUrl, { browserUa: true });
  const apiRoot = wpApiRootFromHtml(listHtml);
  const origin = new URL(finalUrl).origin;

  // 1) WordPress の REST（本文が素のまま取れる）
  if (apiRoot) {
    try {
      const root = apiRoot;
      const posts = (await deps.fetchJson(apiUrl(root, `wp/v2/posts?per_page=${MAX_ARTICLES}&_fields=link,title,content`))) as { link?: string; title?: { rendered?: string }; content?: { rendered?: string } }[];
      const articles = (Array.isArray(posts) ? posts : [])
        .map((p) => ({ url: String(p.link ?? ""), title: decodeEntities(String(p.title?.rendered ?? "")).replace(/<[^>]+>/g, ""), html: String(p.content?.rendered ?? ""), text: htmlToText(String(p.content?.rendered ?? "")) }))
        .filter((a) => a.text.length > 200);
      if (articles.length) return { articles, wpApiRoot: root, notes };
      notes.push("WordPress の投稿を REST で読めなかったので、ページから読みました");
    } catch {
      notes.push("WordPress の投稿を REST で読めなかったので、ページから読みました");
    }
  }

  // 2) RSS
  let links: { link: string; title: string; description: string }[] = [];
  const rssHref = /<link[^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]*href=["']([^"']+)["']/i.exec(listHtml)?.[1];
  if (rssHref) {
    try {
      const { html: xml } = await deps.fetchHtml(new URL(decodeEntities(rssHref), finalUrl).toString());
      links = parseRss(xml).filter((i) => {
        try {
          return !!i.link && new URL(i.link, origin).hostname === new URL(finalUrl).hostname;
        } catch {
          return false;
        }
      });
    } catch {
      /* 一覧ページのリンクで続ける */
    }
  }
  // 3) 一覧ページのリンク
  if (!links.length) links = articleLinks(listHtml, finalUrl).map((link) => ({ link, title: "", description: "" }));
  if (!links.length) throw new Error("記事へのリンクが見つかりませんでした。コラム（記事一覧）のページのURLを入れてください");

  const settled = await Promise.allSettled(links.slice(0, MAX_ARTICLES).map((l) => readArticle(deps, l.link, l.description ? l : undefined)));
  const articles = settled.flatMap((s) => (s.status === "fulfilled" && s.value.text.length > 300 ? [s.value] : []));
  if (!articles.length) throw new Error("記事の本文を読めませんでした（ログインが要るページか、画像だけのページの可能性があります）");
  if (articles.length < Math.min(links.length, MAX_ARTICLES)) notes.push(`${Math.min(links.length, MAX_ARTICLES) - articles.length}本は読めませんでした`);
  return { articles, wpApiRoot: apiRoot, notes };
}

/** コードで数える（AI に数えさせない） */
export function measure(articles: Collected[]): { samples: AioSample[]; measured: AioStyle["measured"] } {
  const samples = articles.map((a) => ({
    url: a.url,
    title: a.title.slice(0, 200),
    chars: Array.from(a.text.replace(/\s/g, "")).length,
    h2: (a.html.match(/<h2[\s>]/gi) ?? []).length,
  }));
  const all = articles.map((a) => a.text).join("\n");
  const polite = (all.match(/(です|ます|でした|ました|ません|でしょう)[。！？!?]/g) ?? []).length;
  const plain = (all.match(/(だ|である|だった|ない|する|した|ている)[。！？!?]/g) ?? []).length;
  const n = samples.length || 1;
  return {
    samples,
    measured: {
      articles: samples.length,
      avgChars: Math.round(samples.reduce((a, s) => a + s.chars, 0) / n),
      avgH2: Math.round((samples.reduce((a, s) => a + s.h2, 0) / n) * 10) / 10,
      politeRatio: polite + plain ? Math.round((polite / (polite + plain)) * 100) : 0,
    },
  };
}

const STYLE_SYSTEM = `あなたは日本語の Web 編集者です。同じ媒体の既存記事を読み、新しい記事を同じトンマナで書けるように、書き方の特徴を言葉にします。
- 推測ではなく、渡した記事に実際に見られる特徴だけを書く（例の言い回しは記事から短く引く）
- 文字数・見出しの数・です／ます率はこちらで数えて渡す。数え直さない
- 日本語の文章で通常使う漢字だけで書く

出力: {"summary":"どんな書き方か（60字以内）","voice":"文体・一人称・語りかけ方","reader":"想定している読者","headings":"見出しの付け方（言い回し・疑問形か・番号の有無）","structure":"導入・本文・まとめ・問い合わせへのつなげ方の型","phrases":"よく使う言い回しと、使っていない言い回し","imagery":"画像の使い方（枚数・写真かイラストか・雰囲気。読み取れなければ空）","topics":["既存記事が扱っているテーマ（記事ごとに短く）"]}`;

export async function analyzeStyle(kind: AioChannelKind, project: Pick<AioProject, "name" | "category">, articles: Collected[]): Promise<AioStyle> {
  const { measured } = measure(articles);
  const per = Math.max(1200, Math.floor(14_000 / Math.max(1, articles.length)));
  const blocks = articles.map((a, i) => {
    const h2s = [...a.html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map((m) => decodeEntities(m[1].replace(/<[^>]+>/g, "")).trim()).slice(0, 10);
    const imgs = (a.html.match(/<img[\s>]/gi) ?? []).length;
    return [`## 記事${i + 1}: ${a.title}`, `URL: ${a.url}`, h2s.length ? `見出し: ${h2s.join(" / ")}` : "", `画像の数: ${imgs}`, `本文（冒頭）: ${a.text.slice(0, per)}`].filter(Boolean).join("\n");
  });
  const user = [
    `媒体: ${CHANNEL_LABEL[kind]}`,
    `事業者: ${project.name}（${project.category}）`,
    `実測: 記事${measured.articles}本・平均${measured.avgChars}字・見出し（h2）平均${measured.avgH2}個・です／ます率${measured.politeRatio}%`,
    "",
    ...blocks,
  ].join("\n");
  const r = await askJson<Partial<Omit<AioStyle, "measured">>>(STYLE_SYSTEM, user, { maxTokens: 2500, timeoutMs: 120_000 });
  const s = (v: unknown) => normalizeJapanese(String(v ?? "").trim()).slice(0, 600);
  return {
    summary: s(r.summary).slice(0, 120),
    voice: s(r.voice),
    reader: s(r.reader),
    headings: s(r.headings),
    structure: s(r.structure),
    phrases: s(r.phrases),
    imagery: s(r.imagery),
    topics: (Array.isArray(r.topics) ? r.topics : []).map((t) => normalizeJapanese(String(t ?? "").trim()).slice(0, 80)).filter(Boolean).slice(0, 20),
    measured,
  };
}

// ── 立ち上げ（コラム／アカウントがまだ無い） ─────────────────────

/** 手順はコードで固定する（AI に手順を作らせると、存在しない設定項目を書くことがある） */
export const SETUP_STEPS: Record<AioChannelKind, { title: string; detail: string }[]> = {
  site: [
    { title: "置き場所を決める", detail: "今のサイトが WordPress ならその中に「コラム」を作ります。WordPress でなければ、同じドメインの下（例 https://自社ドメイン/column/）に WordPress を置くのがおすすめです。レンタルサーバーの「WordPress かんたんインストール」で入れられます。" },
    { title: "https とパーマリンク", detail: "SSL（https）を有効にし、WordPress の「設定 → パーマリンク」を「投稿名」にします。記事のURLに日本語が入らないよう、記事ごとのスラッグ（英数字）はこちらで作ります。" },
    { title: "カテゴリ「コラム」を作る", detail: "「投稿 → カテゴリー」で「コラム」などのカテゴリを作ります。下の「カテゴリ案」も参考にしてください。今のサイトのメニューから、コラムの一覧へリンクを置きます。" },
    { title: "アプリケーションパスワードを発行して登録", detail: "WordPress の「ユーザー → プロフィール」の下にある「アプリケーションパスワード」で新しいパスワードを発行し、この画面の「WordPress と連携」に、ユーザー名と一緒に登録します。ログインのパスワードとは別のもので、いつでも取り消せます。" },
    { title: "Search Console と GA4", detail: "Search Console にサイトを登録してサイトマップ（/wp-sitemap.xml）を送り、GA4 のタグを入れます。設定画面で Google を連携すると、記事ごとの表示回数・クリック・閲覧数をここで見られます。" },
  ],
  satellite: [
    { title: "ドメインと運営者を決める", detail: "自社サイトとは別のドメインを取り、WordPress を置きます。サイトの「運営者情報」ページに、運営会社（自社またはグループ会社）を必ず明記します。運営者を伏せて自社の商品を勧めると、景品表示法のステマ規制に触れるおそれがあります。" },
    { title: "扱う商品・サービスを決める", detail: "自社の商品だけでなく、同じジャンルの他社の商品・サービスも扱う比較・解説メディアにします。下の「扱う商品・サービス」に、公式サイトなどの公開情報から書いてよい事実を入れます（ここに無い価格・機能は記事に書きません）。" },
    { title: "PR 表記と広告の方針を置く", detail: "自社の商品を扱う記事の冒頭には PR 表記を、自社サイトへのリンクには rel=\"sponsored\" を、この画面がコードで必ず付けます。サイト全体の「広告・PR について」のページも用意します。" },
    { title: "https・パーマリンク・カテゴリ", detail: "SSL（https）を有効にし、パーマリンクを「投稿名」に、ジャンルごとのカテゴリを作ります。" },
    { title: "アプリケーションパスワードを発行して登録", detail: "WordPress の「ユーザー → プロフィール」でアプリケーションパスワードを発行し、この画面の「WordPress と連携（サテライトサイト）」に登録します。自社サイトとは別の接続です。" },
    { title: "Search Console と GA4", detail: "サテライトサイトも Search Console に登録してサイトマップを送り、GA4 のタグを入れます。効果と改善のタブで記事ごとの数字を見られます。" },
  ],
  note: [
    { title: "アカウントを作る", detail: "会社・ブランドの名前で note のアカウントを作ります（個人のアカウントと分けます）。アカウント名（URL）は英数字の短い社名・ブランド名にします。" },
    { title: "プロフィールを整える", detail: "アイコン・ヘッダー画像・自己紹介・自社サイトへのリンクを設定します。自己紹介は下の「プロフィール文」を使えます。" },
    { title: "マガジンを作る", detail: "テーマごとのマガジンを作り、記事をまとめます（下の「マガジン案」）。読み手が続けて読めるようにするためです。" },
    { title: "最初の数本をまとめて出す", detail: "下の「最初に書く記事」から2〜3本を先に出し、プロフィールを開いた人が読めるものがある状態にします。" },
    { title: "毎回そろえること", detail: "見出し画像・ハッシュタグ（3〜5個）・記事の最後に自社サイトへのリンクを毎回入れます。この画面で記事を作ると、本文・ハッシュタグ・画像がそろった状態で出ます。" },
  ],
};

const STRATEGY_SYSTEM = `あなたは日本の事業者のコンテンツマーケティングの編集長です。これから始める媒体の方針を決めます。
- 事業者の説明・サイトにあることだけを根拠にする。実績・数字・受賞は書かない
- 効果や成果を約束しない（「〜を目指す」の形）
- 記事テーマは、見込み客が AI や検索で相談するときの問いに答えるものにする
- 日本語の文章で通常使う漢字だけで書く

出力: {"concept":"誰に何を届ける媒体か（120字以内）","profile":"プロフィール文／コラムの紹介文（200字以内）","categories":[{"name":"カテゴリ名／マガジン名","purpose":"何を集めるか"}],"cadence":"更新の頻度と曜日の目安","firstArticles":[{"title":"記事タイトル案","target":"答える問い・狙う検索語","why":"最初に書く理由"}],"setupNotes":["上の手順に、この事業者なら足すこと（あれば。最大3つ）"]}`;

export async function buildStrategy(kind: AioChannelKind, project: AioProject): Promise<AioStrategy> {
  const user = [
    `始める媒体: ${kind === "note" ? "note（アカウント開設から）" : kind === "satellite" ? "サテライトサイト（自社とは別ドメインで、他社の商品・サービスも公平に扱う比較・解説メディア。WordPress の設置から）" : "自社サイトのコラム（WordPress の設置から）"}`,
    `事業者名: ${project.name}`,
    project.aliases.length ? `サービス名: ${project.aliases.join(", ")}` : "",
    project.url ? `URL: ${project.url}` : "",
    `見込み客の探し方: ${project.area ? `${project.area}で` : ""}${project.category}`,
    project.notes ? `事業内容・強み: ${project.notes.slice(0, 1500)}` : "",
    project.siteSummary ? `サイトの見出し: ${project.siteSummary}` : "",
    "",
    "手順（固定）:",
    ...SETUP_STEPS[kind].map((s, i) => `${i + 1}. ${s.title}`),
  ]
    .filter(Boolean)
    .join("\n");
  const r = await askJson<{
    concept?: string;
    profile?: string;
    categories?: { name?: string; purpose?: string }[];
    cadence?: string;
    firstArticles?: { title?: string; target?: string; why?: string }[];
    setupNotes?: string[];
  }>(STRATEGY_SYSTEM, user, { maxTokens: 3000, timeoutMs: 120_000 });
  const s = (v: unknown, n = 400) => normalizeJapanese(String(v ?? "").trim()).slice(0, n);
  const extra = (Array.isArray(r.setupNotes) ? r.setupNotes : []).map((x) => s(x, 200)).filter(Boolean).slice(0, 3);
  return {
    setup: [...SETUP_STEPS[kind], ...extra.map((d) => ({ title: "この事業者で足すこと", detail: d }))],
    concept: s(r.concept, 240),
    profile: s(r.profile, 400),
    categories: (Array.isArray(r.categories) ? r.categories : []).map((c) => ({ name: s(c?.name, 40), purpose: s(c?.purpose, 120) })).filter((c) => c.name).slice(0, 6),
    cadence: s(r.cadence, 120),
    firstArticles: (Array.isArray(r.firstArticles) ? r.firstArticles : []).map((a) => ({ title: s(a?.title, 120), target: s(a?.target, 120), why: s(a?.why, 160) })).filter((a) => a.title).slice(0, 10),
    createdAt: new Date().toISOString(),
  };
}
