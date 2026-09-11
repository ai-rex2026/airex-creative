import type { SiteScan } from "./site-scan";

/**
 * サイトから辿れた公式SNSを、実際に見に行って測る。
 *
 * 取れるものは媒体でまちまちで、ログインを求めてくる媒体もある。
 * **取れなかったことを取れなかったと書く**のがここの役目で、
 * 「フォロワーが少ない」のような推測は書かない。
 */

export type SocialAccount = {
  platform: string;
  url: string;
  handle: string;
  /** 実際に読めたか */
  readable: boolean;
  /** 読めた指標。取れなかった項目は入れない */
  followers: number | null;
  posts: number | null;
  /** プロフィール文など、読めた手がかり */
  title: string | null;
  bio: string | null;
  /** 総再生回数など、媒体固有の実測。取れたものだけ入れる */
  views: number | null;
  /** 何で測ったか。公式APIか、公開ページかを画面に出す */
  via: "公式API" | "公開ページ" | null;
  /** 読めなかった理由 */
  reason: string | null;
};

export type SocialScan = {
  accounts: SocialAccount[];
  fetchedAt: string;
};

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const meta = (html: string, prop: string) =>
  html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']*)["']`, "i"))?.[1] ??
  html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${prop}["']`, "i"))?.[1] ??
  null;

/** 「1.2万」「12.3K」「1,234」をすべて数に直す */
function toNum(raw: string): number | null {
  const s = raw.replace(/,/g, "").trim();
  const m = s.match(/^([\d.]+)\s*(万|億|[KkMm])?$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = m[2];
  if (unit === "万") return Math.round(n * 10_000);
  if (unit === "億") return Math.round(n * 100_000_000);
  if (unit === "K" || unit === "k") return Math.round(n * 1_000);
  if (unit === "M" || unit === "m") return Math.round(n * 1_000_000);
  return Math.round(n);
}

/** og:description からフォロワー数と投稿数を拾う。媒体ごとに書き方が違う */
function fromDescription(desc: string): { followers: number | null; posts: number | null } {
  const f =
    desc.match(/([\d.,]+\s*[万億KkMm]?)\s*(?:Followers|フォロワー)/i)?.[1] ??
    desc.match(/(?:フォロワー|Followers)\s*[:：]?\s*([\d.,]+\s*[万億KkMm]?)/i)?.[1] ??
    null;
  const p =
    desc.match(/([\d.,]+\s*[万億KkMm]?)\s*(?:Posts|件の投稿|投稿)/i)?.[1] ??
    null;
  return { followers: f ? toNum(f) : null, posts: p ? toNum(p) : null };
}


/**
 * YouTube は公式APIで公開情報が取れる。
 * 相手のアカウントと連携しなくても、APIキーだけで
 * 登録者数・動画数・総再生回数が読める（一般ユーザーが見られる範囲）。
 */
function youtubeKey() {
  return process.env.YOUTUBE_API_KEY || process.env.PAGESPEED_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
}

/** チャンネルURLから、APIに渡せる識別子を取り出す */
function youtubeTarget(url: string): { param: string; value: string } | null {
  let path: string;
  try {
    path = decodeURIComponent(new URL(url).pathname);
  } catch {
    return null;
  }
  const handle = path.match(/^\/@([^/]+)/)?.[1];
  if (handle) return { param: "forHandle", value: `@${handle}` };
  const id = path.match(/^\/channel\/([^/]+)/)?.[1];
  if (id) return { param: "id", value: id };
  const user = path.match(/^\/(?:user|c)\/([^/]+)/)?.[1];
  if (user) return { param: "forUsername", value: user };
  return null;
}

type YtResponse = {
  items?: { snippet?: { title?: string; description?: string }; statistics?: Record<string, string> }[];
  error?: { message?: string };
};

async function readYouTube(a: { platform: string; url: string; handle: string }, base: SocialAccount): Promise<SocialAccount> {
  const key = youtubeKey();
  const target = youtubeTarget(a.url);
  if (!key) return { ...base, reason: "YouTube Data API のキーが未設定のため取得していません" };
  if (!target) return { ...base, reason: "チャンネルの識別子をURLから取り出せませんでした" };

  const q = new URLSearchParams({ part: "snippet,statistics", key, [target.param]: target.value });
  let j: YtResponse;
  try {
    const res = await fetch(`https://www.googleapis.com/youtube/v3/channels?${q}`, {
      signal: AbortSignal.timeout(12_000),
    });
    j = (await res.json()) as YtResponse;
    if (!res.ok) return { ...base, reason: `YouTube Data API を呼べませんでした（${j.error?.message ?? res.status}）` };
  } catch {
    return { ...base, reason: "YouTube Data API に接続できませんでした" };
  }

  const it = j.items?.[0];
  if (!it) return { ...base, reason: "このチャンネルが YouTube Data API で見つかりませんでした" };

  const st = it.statistics ?? {};
  const n = (v: string | undefined) => (v !== undefined && /^\d+$/.test(v) ? Number(v) : null);
  const subs = n(st.subscriberCount);

  return {
    ...base,
    readable: subs !== null || n(st.videoCount) !== null,
    followers: subs,
    posts: n(st.videoCount),
    views: n(st.viewCount),
    via: "公式API",
    title: it.snippet?.title ?? null,
    bio: it.snippet?.description?.slice(0, 160) ?? null,
    // 登録者数を非公開にしているチャンネルは API でも返ってこない
    reason: subs === null ? "このチャンネルは登録者数を非公開にしています" : null,
  };
}

async function readOne(a: { platform: string; url: string; handle: string }): Promise<SocialAccount> {
  const base: SocialAccount = {
    ...a, readable: false, followers: null, posts: null, views: null, via: null, title: null, bio: null, reason: null,
  };

  // YouTube だけは公式APIで正規に取れる
  if (/youtube/i.test(a.platform)) return readYouTube(a, base);

  // LINE公式アカウントは友だち数を公開しないので、取りに行くだけ無駄になる
  if (/line/i.test(a.platform)) {
    return { ...base, reason: "LINE公式アカウントは友だち数を公開していないため、検出のみです" };
  }
  let html: string;
  try {
    const res = await fetch(a.url, {
      headers: { "user-agent": UA, "accept-language": "ja,en;q=0.8" },
      redirect: "follow",
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      return { ...base, reason: `アカウントのページを開けませんでした（HTTP ${res.status}）` };
    }
    html = await res.text();
  } catch {
    return { ...base, reason: "アカウントのページに接続できませんでした" };
  }

  const title = meta(html, "og:title");
  const desc = meta(html, "og:description");

  // ログイン画面に飛ばされた場合は、数値が無いだけでなく中身も別物になる
  if (/ログインしてください|Log in to|ログイン \|/i.test(title ?? "") || (!title && !desc)) {
    return { ...base, reason: "媒体側がログインを求めるため、公開情報を読み取れませんでした" };
  }

  const { followers, posts } = fromDescription(desc ?? "");

  return {
    ...base,
    // 数値が取れて初めて「分析できた」と言える。ページが開けただけでは検出と同じ
    readable: followers !== null || posts !== null,
    followers,
    posts,
    via: "公開ページ",
    title: title ?? null,
    bio: desc ? desc.slice(0, 160) : null,
    reason: followers === null ? "ページは読めましたが、フォロワー数は公開情報から取得できませんでした" : null,
  };
}

export async function scanSocial(site: SiteScan | null): Promise<SocialScan> {
  const list = (site?.social ?? []).slice(0, 8);
  // 媒体ごとに独立しているので並行で取る。1件が遅くても全体は止めない
  const accounts = await Promise.all(list.map(readOne));
  return { accounts, fetchedAt: new Date().toISOString() };
}

/** 施策の生成に渡す「すでに運用しているもの」の記述 */
export function socialFacts(scan: SocialScan | null): string {
  if (!scan || scan.accounts.length === 0) return "";
  return scan.accounts
    .map((a) => {
      const n = a.followers !== null ? `フォロワー${a.followers.toLocaleString()}人` : "フォロワー数は取得できず";
      return `- ${a.platform}（${a.handle}）：${n}${a.posts !== null ? `／投稿${a.posts.toLocaleString()}件` : ""}`;
    })
    .join("\n");
}
