import type { Verdict } from "@/lib/knowhow-judge";
import { formFields, pickApplied, type Draft, type ItemInsert } from "@/lib/knowhow-sources";

/**
 * 第三者の情報（公式サイト以外のウェブ・X）からノウハウ案を作る（2026-11-20）。
 * このファイルは DB・ネットワーク・AI に触れない純粋な処理だけ。外部との接続は WebDeps で差し替えられる（検証は stub で行う）。
 *
 * 流れ（1つの「調べる単位」＝領域の話題1つ、または領域の X 検索1つ）：
 *   検索 → 見つかったページの本文を実際に読む → AI は「読んだ本文に書いてあること」だけを、根拠のページ番号つきで案にする
 *   → コードで裏取りを確かめる（独立した2か所以上。広告は公式ドメインが1つ以上）→ 通ったものだけ判断待ちに入れる
 * 裏取りはコードで数える（AI の自己申告にしない）。出典の URL は、読んだページの URL だけを使う（AI に URL を書かせない）。
 */

export type WebArea = "meo" | "seo" | "aio" | "lpo" | "image" | "ads";
export const WEB_AREAS: WebArea[] = ["meo", "seo", "aio", "lpo", "image", "ads"];
export const WEB_AREA_LABEL: Record<WebArea, string> = { meo: "MEO", seo: "SEO", aio: "AIO", lpo: "LPO", image: "画像生成", ads: "広告" };

export type WebTopic = { label: string; query: string };
export type WebPlan = { topics: WebTopic[]; xKeywords: string[] };

/** 領域ごとの調べる話題（週1回。件数を増やすと検索・AI の費用が増える）。X は広告では使わない（公式の裏取りが要るため） */
export const WEB_PLANS: Record<WebArea, WebPlan> = {
  meo: {
    topics: [
      { label: "ローカル検索の順位・仕様の変更", query: "Googleビジネスプロフィール ローカル検索 順位 仕様変更 最新" },
      { label: "プロフィール運用（写真・投稿・属性）", query: "Googleビジネスプロフィール 運用 写真 投稿 属性 最新 ノウハウ" },
      { label: "ローカルSEOの順位要因の調査", query: "ローカルSEO 順位要因 調査 ビジネスプロフィール" },
    ],
    xKeywords: ["MEO ビジネスプロフィール", "Googleマップ 順位 対策"],
  },
  seo: {
    topics: [
      { label: "検索アルゴリズムの更新と対応", query: "Google 検索 アップデート 影響 対応 最新" },
      { label: "記事の作り方（E-E-A-T・構成）", query: "SEO 記事 作り方 E-E-A-T 構成 最新 実務" },
      { label: "技術SEO（構造化データ・内部リンク・クロール）", query: "技術SEO 構造化データ 内部リンク クロール 最新" },
    ],
    xKeywords: ["SEO コアアップデート", "SEO 記事 順位"],
  },
  aio: {
    topics: [
      { label: "AI による概要・AI モードに引用される条件", query: "AI Overviews AI モード 引用される 条件 対策 最新" },
      { label: "LLMO・GEO の実務", query: "LLMO GEO 生成AI検索 対策 ノウハウ 最新" },
      { label: "ChatGPT・Perplexity の引用傾向の調査", query: "ChatGPT Perplexity 引用 出典 傾向 調査" },
    ],
    xKeywords: ["LLMO 対策", "AI Overviews 引用"],
  },
  lpo: {
    topics: [
      { label: "LP 改善（CVR）", query: "ランディングページ 改善 CVR ノウハウ 最新" },
      { label: "ファーストビュー・フォーム改善", query: "LP ファーストビュー フォーム EFO 改善 事例" },
      { label: "表示速度（Core Web Vitals）", query: "Core Web Vitals 表示速度 LP 改善 最新" },
    ],
    xKeywords: ["LP 改善 CVR", "ランディングページ 改善"],
  },
  image: {
    topics: [
      { label: "広告バナーの成果が出る要素", query: "広告バナー クリエイティブ 成果 要素 検証 最新" },
      { label: "AI 画像生成の広告利用（品質・規制）", query: "AI 画像生成 広告 クリエイティブ 品質 規制 最新" },
      { label: "ショート動画広告のクリエイティブ", query: "ショート動画 広告 クリエイティブ 最新 傾向" },
    ],
    xKeywords: ["バナー 広告 クリエイティブ", "AI画像 広告 バナー"],
  },
  ads: {
    topics: [
      { label: "Google 広告の変更", query: "Google広告 仕様変更 最新 運用 影響" },
      { label: "Meta 広告の変更", query: "Meta広告 仕様変更 最新 運用 影響" },
      { label: "Yahoo!・LINE・TikTok 広告の変更", query: "Yahoo!広告 LINE広告 TikTok広告 仕様変更 最新" },
    ],
    xKeywords: [],
  },
};

/** 広告の案に必要な、公式ドメイン（ここに載っているページを根拠に1つ以上含むこと）。一般の掲示板・ニュース面は含めない */
export const OFFICIAL_DOMAINS: RegExp[] = [
  /(^|\.)support\.google\.com$/i,
  /(^|\.)ads\.google\.com$/i,
  /(^|\.)blog\.google$/i,
  /(^|\.)developers\.google\.com$/i,
  /(^|\.)business\.facebook\.com$/i,
  /(^|\.)transparency\.meta\.com$/i,
  /(^|\.)about\.fb\.com$/i,
  /(^|\.)ads\.tiktok\.com$/i,
  /(^|\.)business\.tiktok\.com$/i,
  /(^|\.)business\.x\.com$/i,
  /(^|\.)ads\.x\.com$/i,
  /(^|\.)ads\.microsoft\.com$/i,
  /(^|\.)about\.ads\.microsoft\.com$/i,
  /(^|\.)lycbiz\.com$/i,
  /(^|\.)ads-help\.yahoo\.co\.jp$/i,
  /(^|\.)ads\.yahoo\.co\.jp$/i,
  /(^|\.)linebiz\.com$/i,
];

export type WebPage = { n: number; url: string; title: string; text: string };
export type XPost = { n: number; url: string; author: string; text: string; likes: number | null; postedAt: string | null };

export type WebDraft = Draft & { source_ids?: unknown };

export type WebDeps = {
  /** ウェブ検索。出典（実際のページの URL）を返す */
  search: (query: string) => Promise<{ url: string; title: string }[]>;
  /** ページの本文を読む。読めなければ throw */
  readPage: (url: string) => Promise<string>;
  /** X を検索する（領域のキーワード）。反応のある投稿だけ */
  searchX: (keywords: string[]) => Promise<{ url: string; author: string; text: string; likes: number | null; postedAt?: string | null }[]>;
  /** 読んだ本文・投稿から案の下書きを作る（AI） */
  draft: (area: WebArea, label: string, pages: WebPage[], posts: XPost[]) => Promise<WebDraft[]>;
  guardOk: (text: string) => boolean;
  now: () => Date;
  /** 保存する前の案を、意味の重複・一般論で判定する（AI）。無ければ判定しない */
  judge?: (area: WebArea, items: { title: string; body: string }[]) => Promise<{ verdicts: Verdict[]; failed: boolean }>;
};

export const MAX_PAGES = 5;
export const PAGE_CAP = 5_000;
export const MAX_ITEMS_PER_UNIT = 8;
/** X の投稿を根拠にする古さの上限（日） */
export const X_MAX_AGE_DAYS = 365;
/** 見出しに使わない断定的な語（見出しは承認の判断に直接効くため、コードでも確かめる） */
export const ASSERTIVE_TITLE = /(最強|必須|絶対|必ず|確実|唯一|No\.?\s?1|ナンバーワン|最も|史上|圧倒的|一択)/;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** 出典の「独立性」を数える単位：ウェブはドメイン、X は投稿者 */
export function sourceKey(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (/^(x|twitter)\.com$/.test(host)) {
      const handle = u.pathname.split("/").filter(Boolean)[0] ?? "";
      return handle ? `x:${handle.toLowerCase()}` : "x:";
    }
    // note.com/ユーザー名/…、github.io のように、同じドメインでも書き手が別のものは書き手で分ける
    if (/^(note\.com|zenn\.dev|qiita\.com)$/.test(host)) return `${host}/${u.pathname.split("/").filter(Boolean)[0] ?? ""}`;
    return host;
  } catch {
    return "";
  }
}

export function isOfficialUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return OFFICIAL_DOMAINS.some((re) => re.test(host));
  } catch {
    return false;
  }
}

/** 案にするのに必要な、独立した出典の数。1＝出典が1つでも案にする（広くあげて、承認の段階で判断する）。2にすると「独立した2か所以上」に戻る */
export const MIN_SOURCES = 1;

/** 裏取り：出典の数（MIN_SOURCES）。広告も公式ページは必須にしない（2026-11-20：広く挙げて承認で判断。公式を含まない広告の案は、注意書きで公式での確認を促す） */
export function qualifies(area: WebArea, urls: string[], min: number = MIN_SOURCES): { ok: boolean; reason: string; official: boolean } {
  const keys = new Set(urls.map(sourceKey).filter(Boolean));
  const official = urls.some(isOfficialUrl);
  if (keys.size < Math.max(1, min)) return { ok: false, reason: keys.size ? `独立した出典が${min}つ未満` : "出典が読めたページ・投稿に結び付かない", official };
  return { ok: true, reason: "", official };
}

const hash8 = (s: string) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
};

export type UnitResult = { items: ItemInsert[]; read: number; dropped: { title: string; reason: string }[]; error?: string };

function toWebItems(area: WebArea, label: string, drafts: WebDraft[], pages: WebPage[], posts: XPost[], deps: Pick<WebDeps, "guardOk" | "now">): { items: ItemInsert[]; dropped: { title: string; reason: string }[] } {
  const day = deps.now().toISOString().slice(0, 10);
  const stamp = day.replace(/-/g, "");
  const byN = new Map<number, { url: string; title: string }>();
  for (const p of pages) byN.set(p.n, { url: p.url, title: p.title });
  for (const x of posts) byN.set(x.n, { url: x.url, title: `X：@${x.author}` });
  const items: ItemInsert[] = [];
  const dropped: { title: string; reason: string }[] = [];
  for (const d of drafts.slice(0, MAX_ITEMS_PER_UNIT + 2)) {
    if (items.length >= MAX_ITEMS_PER_UNIT) break;
    const title = str(d.title, 80);
    const proposal = str(d.proposal, 300);
    if (!title || !proposal) continue;
    if (ASSERTIVE_TITLE.test(title)) {
      dropped.push({ title, reason: "見出しが断定的" });
      continue;
    }
    const ids = Array.isArray(d.source_ids) ? d.source_ids.map((x) => Number(x)).filter((x) => byN.has(x)) : [];
    const used = [...new Set(ids)].map((n) => byN.get(n)!);
    const q = qualifies(area, used.map((u) => u.url));
    if (!q.ok) {
      dropped.push({ title, reason: q.reason });
      continue;
    }
    const applied = pickApplied(d, proposal, deps.guardOk);
    const onlyX = used.every((u) => sourceKey(u.url).startsWith("x:"));
    items.push({
      key: `web-${area}-${stamp}-${hash8(title + proposal)}`,
      area,
      kind: d.kind === "change" ? "change" : "add",
      title,
      summary: str(d.summary, 300),
      proposal,
      ...formFields(d, applied),
      target: "",
      sources: used.slice(0, 6),
      evidence: q.official ? "vendor" : "opinion",
      caveat:
        (str(d.caveat, 200) ? str(d.caveat, 200) + "／" : "") +
        `第三者の情報（${label}）から自動で作成した案。出典は${used.length}件（${[...new Set(used.map((u) => sourceKey(u.url)))].slice(0, 4).join("・")}）。` +
        (used.length < 2 ? "根拠は1か所のみ（他のページでの裏付けは未確認）。" : "") +
        (area === "ads" && !q.official ? "広告の仕様・審査基準は変わりやすいので、公式ページ（各媒体のヘルプ・ポリシー）で確かめてから承認すること。" : "") +
        (onlyX ? "X の投稿のみが根拠です。公式の情報で確かめてから承認すること。" : q.official ? "公式ページを含む出典。" : "公式の裏付けは未確認。原文を確認してから承認すること。"),
      is_guess: d.is_guess === true || onlyX,
      risk: "normal",
      fetched_on: day,
    });
  }
  return { items, dropped };
}

/** 調べる単位1つ（話題の検索、または X 検索）を最後まで流して、案の候補を返す。保存はしない（呼び出し側が1単位ごとに保存する） */
export async function runUnit(area: WebArea, unit: { kind: "web"; topic: WebTopic } | { kind: "x"; keywords: string[] }, deps: WebDeps): Promise<UnitResult> {
  let pages: WebPage[] = [];
  let posts: XPost[] = [];
  let label = "";
  if (unit.kind === "web") {
    label = unit.topic.label;
    const found = await deps.search(unit.topic.query);
    const seen = new Set<string>();
    const picked: { url: string; title: string }[] = [];
    for (const f of found) {
      const key = sourceKey(f.url);
      if (!f.url || !key || seen.has(key)) continue; // 同じドメインは1ページだけ読む（独立した出典を集めるため）
      seen.add(key);
      picked.push(f);
      if (picked.length >= MAX_PAGES + 3) break;
    }
    const read = await Promise.allSettled(picked.map((p) => deps.readPage(p.url)));
    for (let i = 0; i < picked.length && pages.length < MAX_PAGES; i++) {
      const r = read[i];
      if (r.status !== "fulfilled" || r.value.trim().length < 300) continue; // 読めなかった・本文が少ないページは根拠にしない
      pages.push({ n: pages.length + 1, url: picked[i].url, title: picked[i].title, text: r.value.trim().slice(0, PAGE_CAP) });
    }
  } else {
    label = "X での話題";
    const found = await deps.searchX(unit.keywords);
    const seen = new Set<string>();
    for (const f of found) {
      const a = f.author.toLowerCase();
      if (!f.text.trim() || seen.has(a)) continue; // 1人1件（同じ人の複数投稿を独立した出典と数えない）
      // 古い投稿は根拠にしない（日付が分かるもので、1年より前のもの）
      if (f.postedAt && Date.parse(f.postedAt) < deps.now().getTime() - X_MAX_AGE_DAYS * 864e5) continue;
      seen.add(a);
      posts.push({ n: posts.length + 1, url: f.url, author: f.author, text: f.text.slice(0, 600), likes: f.likes, postedAt: f.postedAt ?? null });
      if (posts.length >= 12) break;
    }
  }
  if (!pages.length && !posts.length) return { items: [], read: 0, dropped: [], error: "根拠にできるページ・投稿が見つかりませんでした" };
  const drafts = await deps.draft(area, label, pages, posts);
  const r = toWebItems(area, label, Array.isArray(drafts) ? drafts : [], pages, posts, deps);
  return { ...r, read: pages.length + posts.length };
}

/** 週の印（ISO 週。同じ週に済んだ単位は飛ばす） */
export function weekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const wk = Math.ceil(((t.getTime() - y0.getTime()) / 864e5 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(wk).padStart(2, "0")}`;
}
