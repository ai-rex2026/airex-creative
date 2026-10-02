import type { SiteScan } from "./site-scan";
import { isSnsPlatform, type SnsPlatform } from "./social-connect/platforms";
import { getSnsCredentials } from "./social-connect/tokens";
import { fetchXProfile, fetchXRecentPosts } from "./social-connect/x";
import { fetchTikTokProfile, fetchTikTokVideos } from "./social-connect/tiktok";
import { fetchInstagramProfile, fetchInstagramRecentMedia, fetchFacebookPageProfile, fetchFacebookPageRecentPosts, fetchFacebookPageInsights } from "./meta";

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
  /** 何で測ったか。公式APIか、本人のOAuth連携（公式連携）か、公開ページか、Apify経由か、利用者の手入力かを画面に出す */
  via: "公式API" | "公式連携" | "公開ページ" | "Grok(xAI)" | "Apify" | "手入力" | null;
  /** 読めなかった理由 */
  reason: string | null;
  /**
   * 直近の投稿内容。YouTubeは実際の動画タイトル、Xは投稿の話題を要約した見出し（原文の引用はしない）。
   * 取れなかった・対象外の媒体は null
   */
  recentContent: string[] | null;
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

/** 「1.2万」　12.3K」「1,234」をすべて数に直す */
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

/** 直近の投稿本文を見出し表示用に短くする。via=公式連携・Apify のどちらからでも使う */
const shorten = (s: string) => (s.length > 30 ? `${s.slice(0, 30)}…` : s);

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
  items?: {
    snippet?: { title?: string; description?: string };
    statistics?: Record<string, string>;
    contentDetails?: { relatedPlaylists?: { uploads?: string } };
  }[];
  error?: { message?: string };
};

type YtPlaylistItemsResponse = {
  items?: { snippet?: { title?: string } }[];
};

/**
 * 直近の投稿内容（アップロード動画のタイトル）を取る。
 * 「アップロード」再生リストの一覧取得は登録者数の取得と同じAPIキーで済み、
 * クォータもごくわずか（1ユニット）。取れなくても登録者数などの本筋は返す。
 */
async function readRecentUploads(key: string, uploadsPlaylistId: string): Promise<string[] | null> {
  try {
    const q = new URLSearchParams({ part: "snippet", key, playlistId: uploadsPlaylistId, maxResults: "5" });
    const res = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?${q}`, {
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as YtPlaylistItemsResponse;
    const titles = (j.items ?? []).map((x) => x.snippet?.title).filter((t): t is string => !!t);
    return titles.length ? titles.slice(0, 5) : null;
  } catch {
    return null;
  }
}

async function readYouTube(a: { platform: string; url: string; handle: string }, base: SocialAccount): Promise<SocialAccount> {
  const key = youtubeKey();
  const target = youtubeTarget(a.url);
  if (!key) return { ...base, reason: "YouTube Data API のキーが未設定のため取得していません" };
  if (!target) return { ...base, reason: "チャンネルの識別子をURLから取り出せませんでした" };

  const q = new URLSearchParams({ part: "snippet,statistics,contentDetails", key, [target.param]: target.value });
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

  const uploadsId = it.contentDetails?.relatedPlaylists?.uploads;
  const recentContent = uploadsId ? await readRecentUploads(key, uploadsId) : null;

  return {
    ...base,
    readable: subs !== null || n(st.videoCount) !== null,
    followers: subs,
    posts: n(st.videoCount),
    views: n(st.viewCount),
    via: "公式API",
    title: it.snippet?.title ?? null,
    bio: it.snippet?.description?.slice(0, 160) ?? null,
    recentContent,
    // 登録者数を非公開にしているチャンネルは API でも返ってこない
    reason: subs === null ? "このチャンネルは登録者数を非公開にしています" : null,
  };
}

/**
 * X・TikTok・Instagram はログイン無しでは公開ページの指標がほぼ読めないため、
 * Apify（https://apify.com）の既製Actorを使って取得する。
 *
 * 以前はXだけ xAI の Grok（x_search）経由で推定していたが、
 * 「Apifyに一本化」という依頼主の方針により、Grok経由の取得（readX）は廃止し、
 * X・TikTok・Instagramの3媒体ともApify Actor経由に統一した。
 * Actorは「公式アカウントのハンドルを渡すと、その公開プロフィールの実測値を返す」
 * 既製のスクレイピングActorで、いずれもAPIキー（トークン）はApifyの個人アカウントのもの。
 *
 * 呼び出すActor（公開情報は変わりうるため、環境変数で上書きできるようにしてある）:
 * - X: apidojo/twitter-scraper-lite
 * - TikTok: clockworks/tiktok-profile-scraper
 * - Instagram: apify/instagram-profile-scraper
 */
function apifyToken() {
  return process.env.APIFY_API_TOKEN;
}

type ApifyDatasetItem = Record<string, unknown>;

/**
 * Apify の Actor を同期実行し、データセットの中身をそのまま受け取る。
 * run-sync-get-dataset-items は、Actorの実行が終わるまでこのリクエスト自体が
 * 待つ仕様（別途ポーリングが要らない）。待っても数十秒程度で終わるActorだけに使う。
 */
async function runApifyActor(actorId: string, input: object, timeoutMs = 90_000): Promise<ApifyDatasetItem[]> {
  const token = apifyToken();
  if (!token) throw new Error("Apify APIトークンが未設定です");
  // Apify の REST API は Actor ID の "/" を "~" に置き換えた形でパスに使う仕様
  const safeId = actorId.replace("/", "~");
  const res = await fetch(`https://api.apify.com/v2/acts/${safeId}/run-sync-get-dataset-items?token=${token}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(`Apify Actorの呼び出しに失敗しました（HTTP ${res.status}）${bodyText ? `: ${bodyText.slice(0, 200)}` : ""}`);
  }
  return (await res.json()) as ApifyDatasetItem[];
}

async function readXApify(a: { platform: string; url: string; handle: string }, base: SocialAccount): Promise<SocialAccount> {
  if (!apifyToken()) return { ...base, reason: "Apify APIトークンが未設定のため取得していません" };
  if (!a.handle) return { ...base, reason: "アカウントのハンドルをURLから取り出せませんでした" };

  try {
    const actorId = process.env.APIFY_ACTOR_X || "apidojo/twitter-scraper-lite";
    const items = await runApifyActor(actorId, { twitterHandles: [a.handle], maxItems: 5, sort: "Latest" });
    if (!items.length) return { ...base, reason: "このアカウントをXで確認できませんでした（非公開・削除済みの可能性）" };

    const author = (items[0] as { author?: Record<string, unknown> }).author ?? {};
    const followers = typeof author.followers === "number" ? Math.round(author.followers) : null;
    const recentContent = items
      .map((it) => (it as { text?: unknown }).text)
      .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
      .slice(0, 5)
      .map(shorten);

    return {
      ...base,
      readable: followers !== null || recentContent.length > 0,
      followers,
      posts: null,
      via: "Apify",
      title: typeof author.name === "string" ? author.name : null,
      recentContent: recentContent.length ? recentContent : null,
      reason: followers === null ? "フォロワー数を確認できませんでした" : null,
    };
  } catch (e) {
    return { ...base, reason: `Apify経由の取得に失敗しました（X）: ${e instanceof Error ? e.message : String(e)}` };
  }
}

async function readTikTokApify(a: { platform: string; url: string; handle: string }, base: SocialAccount): Promise<SocialAccount> {
  if (!apifyToken()) return { ...base, reason: "Apify APIトークンが未設定のため取得していません" };
  if (!a.handle) return { ...base, reason: "アカウントのハンドルをURLから取り出せませんでした" };

  try {
    const actorId = process.env.APIFY_ACTOR_TIKTOK || "clockworks/tiktok-profile-scraper";
    const items = await runApifyActor(actorId, { profiles: [a.handle] });
    if (!items.length) return { ...base, reason: "このアカウントをTikTokで確認できませんでした（非公開・削除済みの可能性）" };

    // このActorはプロフィールの統計（フォロワー数等）を各動画アイテムの authorMeta に載せて返す仕様。
    // authorMeta を持つ最初のアイテムからプロフィール統計を、動画本文（text）を持つアイテムから
    // 直近の投稿内容と再生回数を拾う
    const withMeta = items.find((it) => it.authorMeta && typeof it.authorMeta === "object");
    const authorMeta = (withMeta?.authorMeta ?? {}) as Record<string, unknown>;
    const followers = typeof authorMeta.fans === "number" ? Math.round(authorMeta.fans) : null;
    const postsCount = typeof authorMeta.video === "number" ? Math.round(authorMeta.video) : null;

    const videos = items.filter((it) => typeof it.text === "string" || typeof it.playCount === "number");
    const recentContent = videos
      .slice(0, 5)
      .map((v) => (typeof v.text === "string" && v.text.trim() ? shorten(v.text) : "（無題の動画）"));
    const viewsSum = videos.reduce((sum, v) => sum + (typeof v.playCount === "number" ? v.playCount : 0), 0);

    return {
      ...base,
      readable: followers !== null || recentContent.length > 0,
      followers,
      posts: postsCount,
      views: viewsSum > 0 ? viewsSum : null,
      via: "Apify",
      title: typeof authorMeta.nickName === "string" ? authorMeta.nickName : null,
      recentContent: recentContent.length ? recentContent : null,
      reason: followers === null ? "フォロワー数を確認できませんでした" : null,
    };
  } catch (e) {
    return { ...base, reason: `Apify経由の取得に失敗しました（TikTok）: ${e instanceof Error ? e.message : String(e)}` };
  }
}

async function readInstagramApify(a: { platform: string; url: string; handle: string }, base: SocialAccount): Promise<SocialAccount> {
  if (!apifyToken()) return { ...base, reason: "Apify APIトークンが未設定のため取得していません" };
  if (!a.handle) return { ...base, reason: "アカウントのハンドルをURLから取り出せませんでした" };

  try {
    const actorId = process.env.APIFY_ACTOR_INSTAGRAM || "apify/instagram-profile-scraper";
    const items = await runApifyActor(actorId, { usernames: [a.handle] });
    const profile = items[0] as Record<string, unknown> | undefined;
    if (!profile) return { ...base, reason: "このアカウントをInstagramで確認できませんでした（非公開・削除済みの可能性）" };

    const followers = typeof profile.followersCount === "number" ? Math.round(profile.followersCount) : null;
    const posts = typeof profile.postsCount === "number" ? Math.round(profile.postsCount) : null;
    const latestPosts = Array.isArray(profile.latestPosts) ? (profile.latestPosts as Record<string, unknown>[]) : [];
    const recentContent = latestPosts
      .slice(0, 5)
      .map((p) => (typeof p.caption === "string" && p.caption.trim() ? shorten(p.caption) : "（キャプションなし）"));

    return {
      ...base,
      readable: followers !== null || posts !== null,
      followers,
      posts,
      via: "Apify",
      title: typeof profile.fullName === "string" ? profile.fullName : null,
      bio: typeof profile.biography === "string" ? profile.biography.slice(0, 160) : null,
      recentContent: recentContent.length ? recentContent : null,
      reason: followers === null ? "フォロワー数を確認できませんでした" : null,
    };
  } catch (e) {
    return { ...base, reason: `Apify経由の取得に失敗しました（Instagram）: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * サイトから検出した公式SNSが、分析の依頼主が /settings で連携済みの
 * 公式SNSアカウント（OAuth。lib/social-connect/*）と同じ媒体なら、それを最優先で使う。
 * スクレイピングやApify経由の取得と違い、本人の許可を得て公式APIを直接叩くので、
 * フォロワー数・投稿ごとのエンゲージメントとも実数がそのまま取れる。
 *
 * 連携が無い、または呼び出し取得に失敗した場合は null を返し、
 * 呼び出し元（readSocialAccount）が既存のフォールバック（Apify/公開ページ）に進む。
 */
async function readOfficialAccount(
  ownerId: string,
  platform: SnsPlatform,
  base: SocialAccount
): Promise<SocialAccount | null> {
  try {
    const creds = await getSnsCredentials(ownerId, platform);
    if (!creds) return null;

    if (platform === "x") {
      const profile = await fetchXProfile(creds.accessToken);
      let recentContent: string[] | null = null;
      try {
        const posts = await fetchXRecentPosts(creds.accessToken, profile.id, 5);
        recentContent = posts.length ? posts.map((p) => shorten(p.text)) : null;
      } catch {
        recentContent = null;
      }
      return {
        ...base,
        readable: true,
        followers: profile.followers,
        posts: profile.tweetCount,
        via: "公式連携",
        title: profile.name,
        recentContent,
        reason: null,
      };
    }

    if (platform === "meta") {
      // 保存してあるのはPageのアクセストークンと、連携時に見つけたPageID・Instagramビジネスアカウント
      const savedProfile = creds.profile as { igBusinessId?: string; pageId?: string };

      // サイトから検出されたリンクが「Facebookページ」自体のものなら、Instagramとは別物として
      // Facebookページ自体のデータ（ファン数・投稿・インサイト）を返す。
      // そうでなければ（Instagramのリンク等）従来どおりInstagram側のデータを返す
      if (/facebook/i.test(base.platform)) {
        const pageId = savedProfile.pageId;
        if (!pageId) return null;
        const pageProfile = await fetchFacebookPageProfile(creds.accessToken, pageId);
        if (!pageProfile) return null;
        let recentContent: string[] | null = null;
        try {
          const posts = await fetchFacebookPageRecentPosts(creds.accessToken, pageId, 5);
          recentContent = posts.length ? posts.map((p) => (p.message ? shorten(p.message) : "（本文なしの投稿）")) : null;
        } catch {
          recentContent = null;
        }
        const insights = await fetchFacebookPageInsights(creds.accessToken, pageId);
        return {
          ...base,
          readable: true,
          followers: pageProfile.fanCount ?? pageProfile.followersCount,
          posts: null,
          views: insights.reach,
          via: "公式連携",
          title: pageProfile.name,
          recentContent,
          reason: null,
        };
      }

      const igBusinessId = savedProfile.igBusinessId;
      if (!igBusinessId) return null;
      const profile = await fetchInstagramProfile(creds.accessToken, igBusinessId);
      if (!profile) return null;
      let recentContent: string[] | null = null;
      try {
        const media = await fetchInstagramRecentMedia(creds.accessToken, igBusinessId, 5);
        recentContent = media.length ? media.map((m) => (m.caption ? shorten(m.caption) : "（キャプションなし）")) : null;
      } catch {
        recentContent = null;
      }
      return {
        ...base,
        readable: true,
        followers: profile.followersCount,
        posts: profile.mediaCount,
        via: "公式連携",
        title: profile.username,
        recentContent,
        reason: null,
      };
    }

    // tiktok
    const profile = await fetchTikTokProfile(creds.accessToken);
    let recentContent: string[] | null = null;
    let views: number | null = null;
    try {
      const videos = await fetchTikTokVideos(creds.accessToken, 5);
      if (videos.length) {
        recentContent = videos.map((v) => (v.title ? shorten(v.title) : "（無題の動画）"));
        views = videos.reduce((sum, v) => sum + (v.viewCount ?? 0), 0);
      }
    } catch {
      recentContent = null;
    }
    return {
      ...base,
      readable: true,
      followers: profile.followerCount,
      posts: profile.videoCount,
      views,
      via: "公式連携",
      title: profile.displayName,
      recentContent,
      reason: null,
    };
  } catch {
    // 連携はあるが読めなかった（トークン失効など）。既存のフォールバックに譲る
    return null;
  }
}

/**
 * 媒体を1件、実際に見に行って測る。自社アカウントの巡回（scanSocial）だけでなく、
 * SNS競合の実測（social-competitors.ts）からも同じロジックを使い回すため公開している。
 * どちらも「AIの知識で数字を書かない、実測できたものだけを返す」原則は共通のため。
 *
 * ownerId を渡すと（＝自社アカウントの巡回のときだけ。競合の実測では渡さない）、
 * まずその人が /settings で連携済みの公式SNSアカウントを優先して使う。
 */
export async function readSocialAccount(
  a: { platform: string; url: string; handle: string },
  ownerId?: string
): Promise<SocialAccount> {
  const base: SocialAccount = {
    ...a, readable: false, followers: null, posts: null, views: null, via: null, title: null, bio: null, reason: null,
    recentContent: null,
  };

  if (ownerId) {
    const snsPlatform: SnsPlatform | null = /twitter|^x$/i.test(a.platform)
      ? "x"
      : /tiktok/i.test(a.platform)
        ? "tiktok"
        : /instagram/i.test(a.platform) || /facebook/i.test(a.platform)
          ? "meta"
          : null;
    if (snsPlatform && isSnsPlatform(snsPlatform)) {
      const official = await readOfficialAccount(ownerId, snsPlatform, base);
      if (official) return official;
    }
  }

  // YouTube だけは公式APIで正規に取れる
  if (/youtube/i.test(a.platform)) return readYouTube(a, base);

  // X・TikTok・Instagram は公式連携が無い場合、Apify Actor経由で見に行く
  // （「X」表記のみ・ドメインのみ等のゆれも拾えるよう twitter|^x$ で判定）
  if (/twitter|^x$/i.test(a.platform)) return readXApify(a, base);
  if (/tiktok/i.test(a.platform)) return readTikTokApify(a, base);
  if (/instagram/i.test(a.platform)) return readInstagramApify(a, base);

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

export async function scanSocial(site: SiteScan | null, ownerId?: string): Promise<SocialScan> {
  const list = (site?.social ?? []).slice(0, 8);
  // 媒体ごとに独立しているので並行で取る。1件が遅くても全体は止めない
  const accounts = await Promise.all(list.map((a) => readSocialAccount(a, ownerId)));
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
