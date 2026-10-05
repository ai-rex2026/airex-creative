import type { SiteScan } from "./site-scan";
import type { SnsPlatform } from "./social-connect/platforms";
import { getSnsCredentials } from "./social-connect/tokens";
import { fetchXProfile, fetchXRecentPosts } from "./social-connect/x";
import { fetchTikTokProfile, fetchTikTokVideos } from "./social-connect/tiktok";
import { fetchInstagramProfile, fetchInstagramRecentMedia, fetchFacebookPageProfile, fetchFacebookPageRecentPosts, fetchFacebookPageInsights } from "./meta";
import { createAdminClient } from "./supabase/admin";

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
  /**
   * 直近の投稿のエンゲージメント実数。X・TikTok・InstagramはApifyのレスポンスに
   * 既に乗っている（課金もプロフィール/投稿単位で、この後付けに追加コストは発生しない）のに
   * 以前は使わず捨てていたデータ。取れなかった項目はnullのまま、取れた媒体・項目だけ入れる。
   * 取れなかった・対象外の媒体は null
   */
  recentPosts: SocialPost[] | null;
};

/** 投稿1件の実測値。本文は要約しない全文（画面側で必要に応じて折りたたむ） */
export type SocialPost = {
  text: string | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  /** 再生数。動画系（TikTok）のみ。X・Instagramはnull */
  views: number | null;
  /** ISO 8601。取れなければ null */
  postedAt: string | null;
};

export type SocialScan = {
  accounts: SocialAccount[];
  fetchedAt: string;
};

/**
 * 新規分析フォームで利用者が指定できる媒体。入力欄のプルダウンと揃える。
 * site-scan.ts の SOCIAL_HOSTS が検出に使う表記（"X（Twitter）" 等）に合わせてあり、
 * これにより手入力の分も readSocialAccount の媒体判定（/twitter|^x$/i 等）がそのまま効く。
 */
export const MANUAL_SOCIAL_PLATFORMS = ["YouTube", "X（Twitter）", "TikTok", "Instagram"] as const;
export type ManualSocialPlatform = (typeof MANUAL_SOCIAL_PLATFORMS)[number];

/** site-scan.ts の SOCIAL_HOSTS と同じパターン。フルURLが貼られた場合にハンドルを取り出す */
const MANUAL_SOCIAL_URL_RE: Record<ManualSocialPlatform, RegExp> = {
  YouTube: /youtube\.com\/(?:@|channel\/|c\/|user\/)([A-Za-z0-9._-]+)/i,
  "X（Twitter）": /(?:twitter|x)\.com\/([A-Za-z0-9_]+)/i,
  TikTok: /tiktok\.com\/@([A-Za-z0-9._]+)/i,
  Instagram: /instagram\.com\/([A-Za-z0-9._]+)/i,
};

/** ハンドルだけが入力された場合に組み立てる、媒体ごとの正規URL */
function buildManualSocialUrl(platform: ManualSocialPlatform, handle: string): string {
  switch (platform) {
    case "YouTube":
      return `https://www.youtube.com/@${handle}`;
    case "X（Twitter）":
      return `https://x.com/${handle}`;
    case "TikTok":
      return `https://www.tiktok.com/@${handle}`;
    case "Instagram":
      return `https://www.instagram.com/${handle}/`;
  }
}

/**
 * 新規分析フォームの「媒体を選んでハンドル／URLを入れる」入力を、実測パイプラインで
 * 使う { platform, url, handle } の形に正規化する。フルURLが貼られた場合はそこから
 * ハンドルを取り出し、ハンドル（@有無どちらでも可）だけが入力された場合は正規のURLを組み立てる。
 * 媒体が選択肢の外、または入力が空／URLからハンドルを取り出せない場合は null を返す。
 */
export function normalizeManualSocialInput(
  platform: string,
  raw: string
): { platform: string; url: string; handle: string } | null {
  const isKnown = (MANUAL_SOCIAL_PLATFORMS as readonly string[]).includes(platform);
  if (!isKnown) return null;
  const p = platform as ManualSocialPlatform;
  const v = raw.trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) {
    const handle = v.match(MANUAL_SOCIAL_URL_RE[p])?.[1] ?? "";
    if (!handle) return null;
    return { platform: p, url: v, handle };
  }
  const handle = v.replace(/^@/, "");
  if (!handle) return null;
  return { platform: p, url: buildManualSocialUrl(p, handle), handle };
}

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
/**
 * 2026-10-05: 文字数で切ると、絵文字などの「サロゲートペア」を真ん中で割ってしまい、
 * 孤立したサロゲートがDB（Postgres jsonb）への保存でエラーになる。TikTokの投稿文は絵文字が多く、
 * 「取得は成功しているのに保存だけが毎回失敗し、同じ取得（＝Apifyの課金）を繰り返す」原因になっていた。
 * コードポイント単位で切る。
 */
const shorten = (s: string) => {
  const chars = Array.from(s);
  return chars.length > 30 ? `${chars.slice(0, 30).join("")}…` : s;
};

/** Postgres jsonb が拒否する文字（NUL・孤立サロゲート）を取り除く */
export function cleanText(s: string): string {
  return s
    .replace(/\u0000/g, "")
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "")
    .replace(/(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "$1");
}

/** 保存する値の、全ての文字列を cleanText に通す */
export function deepClean<T>(v: T): T {
  if (typeof v === "string") return cleanText(v) as unknown as T;
  if (Array.isArray(v)) return v.map((x) => deepClean(x)) as unknown as T;
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, deepClean(x)])) as T;
  }
  return v;
}

/** 日付文字列・UNIX秒をISO 8601に正規化する。パースできなければnull（推測で埋めない） */
function toIsoDate(raw: unknown): string | null {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const ms = raw > 1e12 ? raw : raw * 1000; // 秒 or ミリ秒のどちらで来てもISOにする
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof raw === "string" && raw.trim()) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
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
 * 1分析あたりのApify Actor呼び出し総数の上限。
 *
 * 2026-10-04、自社SNS実測側だけに掛けていた上限（MAX_SOCIAL_ATTEMPTS。lib/analysis.ts）
 * では防ぎきれない形でApifyクレジットが再度大きく減った。原因はSNS競合調査
 * （findSocialCompetitors。lib/social-competitors.ts）が自社実測と同じ readSocialAccount
 * 経由でApifyを呼ぶが、そちらには上限が無かったこと（最大で媒体ごと2件×3媒体＝6回、
 * 自社実測の最大3回と合わせて1分析で最大9回、何もおかしくなくても普通に発生しうる）。
 *
 * そのため上限は「自社実測」「競合調査」どちらの経路かを問わず、Apify Actorを実際に
 * 呼ぶ直前の、この関数1箇所だけでまとめて数える。claim_apify_call（Postgres関数。
 * 原子的にインクリメント＆上限チェック）で1分析あたりの合計回数を強制する
 *
 * 2026-10-05: 「TikTokだけApify呼び出し回数が上限に達して取得できない」という報告の
 * 原因調査で、通常ケースの消費量自体が上限10にかなり近いことが分かった：自社実測が
 * 最大3回（X・TikTok・Instagram）＋競合調査が媒体ごと最大2件×最大3媒体＝最大6回で、
 * 合計最大9回。claim_apify_call は「予算を使い切った」ことだけを数え、実行が途中で
 * 打ち切られて保存されなかった試行（サーバーレスの実行時間切れ等）も1回として消費する
 * ため、1〜2回の中断・再試行が重なるだけで合計が10に届き、後から実行される媒体
 * （Promise.allSettledの完了順は保証されないため、TikTokとは限らないが結果的に
 * TikTokで発生した）が「上限に達した」で弾かれる。
 * 恒久対策は実行時間切れそのものを無くすことだが、それとは別に、通常ケースの
 * 最大消費（9）に対して上限（10）の余裕が無さすぎるため、中断1回分の再試行を
 * 吸収できるよう上限を上げる（合わせて競合調査側の消費も減らす。lib/social-competitors.ts）
 */
const APIFY_BUDGET_PER_ANALYSIS = 20;

async function claimApifyBudget(analysisId: string): Promise<boolean> {
  const sb = createAdminClient();
  const { data, error } = await sb.rpc("claim_apify_call", {
    p_analysis_id: analysisId,
    p_max: APIFY_BUDGET_PER_ANALYSIS,
  });
  // RPC呼び出し自体が失敗した場合（一時的なDB不調など）は、Apifyコストを守る側に倒して
  // 呼ばせない。「取れなかった」は許容できるが「予算を数え損ねて無制限に呼ぶ」は許容できない
  if (error) return false;
  return data === true;
}

/**
 * Apify の Actor を同期実行し、データセットの中身をそのまま受け取る。
 * run-sync-get-dataset-items は、Actorの実行が終わるまでこのリクエスト自体が
 * 待つ仕様（別途ポーリングが要らない）。待っても数十秒程度で終わるActorだけに使う。
 */
async function runApifyActor(
  analysisId: string,
  actorId: string,
  input: object,
  timeoutMs = 90_000
): Promise<ApifyDatasetItem[]> {
  const token = apifyToken();
  if (!token) throw new Error("Apify APIトークンが未設定です");
  const withinBudget = await claimApifyBudget(analysisId);
  if (!withinBudget) {
    throw new Error(`この分析でのApify呼び出し回数が上限（${APIFY_BUDGET_PER_ANALYSIS}回）に達したため取得していません`);
  }
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

async function readXApify(
  a: { platform: string; url: string; handle: string },
  base: SocialAccount,
  analysisId: string
): Promise<SocialAccount> {
  if (!apifyToken()) return { ...base, reason: "Apify APIトークンが未設定のため取得していません" };
  if (!a.handle) return { ...base, reason: "アカウントのハンドルをURLから取り出せませんでした" };

  try {
    const actorId = process.env.APIFY_ACTOR_X || "apidojo/twitter-scraper-lite";
    const items = await runApifyActor(analysisId, actorId, { twitterHandles: [a.handle], maxItems: 5, sort: "Latest" });
    if (!items.length) return { ...base, reason: "このアカウントをXで確認できませんでした（非公開・削除済みの可能性）" };

    const author = (items[0] as { author?: Record<string, unknown> }).author ?? {};
    const followers = typeof author.followers === "number" ? Math.round(author.followers) : null;
    const recentContent = items
      .map((it) => (it as { text?: unknown }).text)
      .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
      .slice(0, 5)
      .map(shorten);

    // いいね・リプライ・リツイート・投稿日時はApifyのレスポンスに既に乗っていて、
    // maxItems:5で課金される件数は変わらないため、ここで拾っても追加コストは発生しない
    const recentPosts: SocialPost[] = items.slice(0, 5).map((raw) => {
      const it = raw as { text?: unknown; likeCount?: unknown; replyCount?: unknown; retweetCount?: unknown; viewCount?: unknown; createdAt?: unknown };
      return {
        text: typeof it.text === "string" && it.text.trim() ? it.text : null,
        likes: typeof it.likeCount === "number" ? Math.round(it.likeCount) : null,
        comments: typeof it.replyCount === "number" ? Math.round(it.replyCount) : null,
        shares: typeof it.retweetCount === "number" ? Math.round(it.retweetCount) : null,
        views: typeof it.viewCount === "number" ? Math.round(it.viewCount) : null,
        postedAt: toIsoDate(it.createdAt),
      };
    });

    return {
      ...base,
      readable: followers !== null || recentContent.length > 0,
      followers,
      posts: null,
      via: "Apify",
      title: typeof author.name === "string" ? author.name : null,
      recentContent: recentContent.length ? recentContent : null,
      recentPosts: recentPosts.length ? recentPosts : null,
      reason: followers === null ? "フォロワー数を確認できませんでした" : null,
    };
  } catch (e) {
    return { ...base, reason: `Apify経由の取得に失敗しました（X）: ${e instanceof Error ? e.message : String(e)}` };
  }
}

async function readTikTokApify(
  a: { platform: string; url: string; handle: string },
  base: SocialAccount,
  analysisId: string
): Promise<SocialAccount> {
  if (!apifyToken()) return { ...base, reason: "Apify APIトークンが未設定のため取得していません" };
  if (!a.handle) return { ...base, reason: "アカウントのハンドルをURLから取り出せませんでした" };

  try {
    const actorId = process.env.APIFY_ACTOR_TIKTOK || "clockworks/tiktok-profile-scraper";
    // このActorは1動画＝1件の課金（$3.00/1,000件）で、resultsPerPageを指定しないと
    // デフォルトの100件/プロフィールが取得され、TikTokがApify費用の大半を占める原因になっていた。
    // 分析に使うのは直近5件だけなので、15件に絞ってコストを抑える（commentsPerPost:0で
    // コメント取得＝追加の課金対象も発生させない）
    const resultsPerPage = Number(process.env.APIFY_TIKTOK_RESULTS_PER_PAGE || 15);
    const items = await runApifyActor(analysisId, actorId, { profiles: [a.handle], resultsPerPage, commentsPerPost: 0 });
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

    // いいね・コメント・シェア・投稿日時も既に取得済みの動画データに乗っているので、
    // resultsPerPageで絞った件数の分だけそのまま使う（追加コストなし）
    const recentPosts: SocialPost[] = videos.slice(0, 5).map((raw) => {
      const v = raw as { text?: unknown; diggCount?: unknown; commentCount?: unknown; shareCount?: unknown; playCount?: unknown; createTimeISO?: unknown; createTime?: unknown };
      return {
        text: typeof v.text === "string" && v.text.trim() ? v.text : null,
        likes: typeof v.diggCount === "number" ? Math.round(v.diggCount) : null,
        comments: typeof v.commentCount === "number" ? Math.round(v.commentCount) : null,
        shares: typeof v.shareCount === "number" ? Math.round(v.shareCount) : null,
        views: typeof v.playCount === "number" ? Math.round(v.playCount) : null,
        postedAt: toIsoDate(v.createTimeISO ?? v.createTime),
      };
    });

    return {
      ...base,
      readable: followers !== null || recentContent.length > 0,
      followers,
      posts: postsCount,
      views: viewsSum > 0 ? viewsSum : null,
      via: "Apify",
      title: typeof authorMeta.nickName === "string" ? authorMeta.nickName : null,
      recentContent: recentContent.length ? recentContent : null,
      recentPosts: recentPosts.length ? recentPosts : null,
      reason: followers === null ? "フォロワー数を確認できませんでした" : null,
    };
  } catch (e) {
    return { ...base, reason: `Apify経由の取得に失敗しました（TikTok）: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * Facebookページ。
 *
 * 2026-10-05: 従来はX・TikTok・Instagram以外として下の汎用HTML取得（fetch + og:タグ
 * 読み取り）にフォールバックしていたが、Facebookは非ログインの素のfetchに対して
 * 「アカウントのページを開けませんでした（HTTP 400）」を返すことが多い（ボット判定が
 * 他媒体より厳しく、UA偽装のfetchをそもそも弾いている）。これはUAやリトライで直せる
 * 問題ではないため、X・TikTok・Instagramと同じくApify Actor経由に切り替える。
 */
async function readFacebookApify(
  a: { platform: string; url: string; handle: string },
  base: SocialAccount,
  analysisId: string
): Promise<SocialAccount> {
  if (!apifyToken()) return { ...base, reason: "Apify APIトークンが未設定のため取得していません" };

  try {
    const actorId = process.env.APIFY_ACTOR_FACEBOOK || "apify/facebook-pages-scraper";
    const items = await runApifyActor(analysisId, actorId, { startUrls: [{ url: a.url }] });
    const page = items[0] as Record<string, unknown> | undefined;
    if (!page) return { ...base, reason: "このページをFacebookで確認できませんでした（非公開・削除済みの可能性）" };

    // このActorのレスポンス形は変わりうるため、候補になりそうなフィールド名を
    // 複数チェックする（他媒体の実装と同じ、他で既に採用している防御的な書き方）
    const followers =
      typeof page.followers === "number"
        ? Math.round(page.followers)
        : typeof page.followersCount === "number"
          ? Math.round(page.followersCount)
          : typeof page.likes === "number"
            ? Math.round(page.likes)
            : null;
    const posts = Array.isArray(page.posts) ? (page.posts as Record<string, unknown>[]) : [];
    const recentContent = posts
      .slice(0, 5)
      .map((p) => (typeof p.text === "string" && p.text.trim() ? shorten(p.text) : "（本文なしの投稿）"));

    const recentPosts: SocialPost[] = posts.slice(0, 5).map((p) => ({
      text: typeof p.text === "string" && p.text.trim() ? p.text : null,
      likes: typeof p.likes === "number" ? Math.round(p.likes) : null,
      comments: typeof p.comments === "number" ? Math.round(p.comments) : null,
      shares: typeof p.shares === "number" ? Math.round(p.shares) : null,
      views: null, // Facebookページ投稿は動画以外に再生数が無く、媒体混在になるので出さない
      postedAt: toIsoDate(p.time ?? p.date ?? p.timestamp),
    }));

    return {
      ...base,
      readable: followers !== null || recentContent.length > 0,
      followers,
      posts: null,
      via: "Apify",
      title:
        typeof page.title === "string" ? page.title : typeof page.pageName === "string" ? page.pageName : null,
      recentContent: recentContent.length ? recentContent : null,
      recentPosts: recentPosts.length ? recentPosts : null,
      reason: followers === null ? "フォロワー数を確認できませんでした" : null,
    };
  } catch (e) {
    return { ...base, reason: `Apify経由の取得に失敗しました（Facebook）: ${e instanceof Error ? e.message : String(e)}` };
  }
}

async function readInstagramApify(
  a: { platform: string; url: string; handle: string },
  base: SocialAccount,
  analysisId: string
): Promise<SocialAccount> {
  if (!apifyToken()) return { ...base, reason: "Apify APIトークンが未設定のため取得していません" };
  if (!a.handle) return { ...base, reason: "アカウントのハンドルをURLから取り出せませんでした" };

  try {
    const actorId = process.env.APIFY_ACTOR_INSTAGRAM || "apify/instagram-profile-scraper";
    const items = await runApifyActor(analysisId, actorId, { usernames: [a.handle] });
    const profile = items[0] as Record<string, unknown> | undefined;
    if (!profile) return { ...base, reason: "このアカウントをInstagramで確認できませんでした（非公開・削除済みの可能性）" };

    const followers = typeof profile.followersCount === "number" ? Math.round(profile.followersCount) : null;
    const posts = typeof profile.postsCount === "number" ? Math.round(profile.postsCount) : null;
    const latestPosts = Array.isArray(profile.latestPosts) ? (profile.latestPosts as Record<string, unknown>[]) : [];
    const recentContent = latestPosts
      .slice(0, 5)
      .map((p) => (typeof p.caption === "string" && p.caption.trim() ? shorten(p.caption) : "（キャプションなし）"));

    // いいね・コメント数・投稿日時もlatestPostsに既に入っている。Instagramの課金は
    // プロフィール単位（$2.60/1,000プロフィール）なので、ここで何件読んでも追加コストは無い
    const recentPosts: SocialPost[] = latestPosts.slice(0, 5).map((p) => ({
      text: typeof p.caption === "string" && p.caption.trim() ? p.caption : null,
      likes: typeof p.likesCount === "number" ? Math.round(p.likesCount) : null,
      comments: typeof p.commentsCount === "number" ? Math.round(p.commentsCount) : null,
      shares: null, // Instagramはシェア数を公開していない
      views: null, // 動画(リール)以外は再生数が無く、媒体混在になるので出さない
      postedAt: toIsoDate(p.timestamp),
    }));

    return {
      ...base,
      readable: followers !== null || posts !== null,
      followers,
      posts,
      via: "Apify",
      title: typeof profile.fullName === "string" ? profile.fullName : null,
      bio: typeof profile.biography === "string" ? profile.biography.slice(0, 160) : null,
      recentContent: recentContent.length ? recentContent : null,
      recentPosts: recentPosts.length ? recentPosts : null,
      reason: followers === null ? "フォロワー数を確認できませんでした" : null,
    };
  } catch (e) {
    return { ...base, reason: `Apify経由の取得に失敗しました（Instagram）: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * サイトから検出した公式SNSが、分析の依頼主が /settings で連携済みの
 * 公式SNSアカウント（OAuth。lib/social-connect/*）と同じ媒体なら、それを使う。
 * スクレイピングやApify経由の取得と違い、本人の許可を得て公式APIを直接叩くので、
 * フォロワー数・投稿ごとのエンゲージメントとも実数がそのまま取れる。
 *
 * 連携が無い、または呼び出し取得に失敗した場合は null を返し、
 * 呼び出し元（readSocialAccount）が既存のフォールバック（Apify/公開ページ）に進む。
 *
 * 【2026-10時点では呼び出していない】
 * /settings の連携は依頼主アカウント単位で、分析しているURL（事業）と紐付いているとは
 * 限らない（広告アカウントのように分析ごとに選べない）。また公式連携で取れるデータは
 * 投稿本文やプロフィール文などApify実測より乏しい（例: Instagramは本文キャプションが
 * 取れない）。この2点から、依頼主の方針により、分析ではいったん公式連携を使わず、
 * LPから拾ったSNSリンクをすべてApify/公開APIで実測する方式に統一した。
 * この関数自体とOAuth連携の保存ロジックは削除せず残してある。将来、投稿の実施など
 * 「運用」機能を作る際に、分析対象ごとに連携アカウントを選べるUIと合わせて再検討する想定。
 * （呼び出し元が無い間も lint の unused エラーにならないよう、あえて export している）
 */
export async function readOfficialAccount(
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
 * ownerId は今は使っていない（2026-10時点）。以前はこれを渡すと /settings で連携済みの
 * 公式SNSアカウント（OAuth）を優先して使っていたが、分析対象のURLと連携アカウントが
 * 紐付くとは限らない・取れるデータがApify実測より乏しいという理由で、依頼主の方針により
 * 現在は使わず、LPから拾ったSNSリンクをすべてApify/公開APIで実測する（readOfficialAccount
 * のコメント参照）。呼び出し元（scanSocial）との引数の形を変えずに済むよう、引数自体は
 * 残してある。
 *
 * analysisId は、Apify Actorを実際に呼ぶ直前の予算チェック（claimApifyBudget。
 * 2026-10-04の事故対応）に使う。自社実測・SNS競合調査どちらの経路から呼ばれても、
 * この分析id単位で合計回数を数える
 */
export async function readSocialAccount(
  a: { platform: string; url: string; handle: string },
  ownerId: string | undefined,
  analysisId: string
): Promise<SocialAccount> {
  void ownerId;
  const base: SocialAccount = {
    ...a, readable: false, followers: null, posts: null, views: null, via: null, title: null, bio: null, reason: null,
    recentContent: null, recentPosts: null,
  };

  // YouTube だけは公式APIで正規に取れる
  if (/youtube/i.test(a.platform)) return readYouTube(a, base);

  // X・TikTok・Instagram は公式連携が無い場合、Apify Actor経由で見に行く
  // （「X」表記のみ・ドメインのみ等のゆれも拾えるよう twitter|^x$ で判定）
  if (/twitter|^x$/i.test(a.platform)) return readXApify(a, base, analysisId);
  if (/tiktok/i.test(a.platform)) return readTikTokApify(a, base, analysisId);
  if (/instagram/i.test(a.platform)) return readInstagramApify(a, base, analysisId);
  // Facebookは非ログインの素のfetchをボット判定で弾く（HTTP 400）ことが多いため、
  // 他媒体同様にApify Actor経由に統一する（readFacebookApifyのコメント参照）
  if (/facebook/i.test(a.platform)) return readFacebookApify(a, base, analysisId);

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

/**
 * 自社SNSを巡回して実測する。
 *
 * site から辿れた（LPにリンクがある）アカウントに、新規分析フォームで利用者が
 * 直接指定したアカウント（extra。lib/analysis.ts の social_manual。normalizeManualSocialInput
 * で正規化済み）を足して見に行く。LPにSNSリンクが無い場合や、自動検出が間違っている場合の
 * 補完／上書きのために、同じ媒体なら extra（手入力）を優先する。
 *
 * 2026-10-04の事故対応: 以前は `Promise.all` で全媒体を待ち、全部終わってから
 * まとめて1回だけ `analyses.social` へ保存していた。生成関数の一部が例外を投げなくても、
 * サーバーレスの実行時間切れでこの関数自体が呼び出し元に戻る前に打ち切られると、
 * 取れていた分（Apify実測＝実際に課金される処理も含む）まで丸ごと保存されず、
 * 次回の再試行で最初からやり直し＝成功していたApify呼び出しまで再度実行される
 * 無駄な再実行・再課金が発生した（AGENTS.md参照）。
 *
 * 対策として、ここでは `Promise.allSettled` で待ち、**1件取れるたびにその場で保存する**。
 * 既にDBに保存済み（前回までに取れていた）媒体はそもそも取得対象から外すため、
 * 途中で打ち切られても次回は取れていない媒体だけを引き継いで取得する。
 * Apify呼び出し回数そのものの上限は、ここではなく実際に呼ぶ直前の
 * claimApifyBudget（analysisId単位、合計10回まで）で守る。
 */
export async function scanSocial(
  site: SiteScan | null,
  ownerId: string | undefined,
  extra: { platform: string; url: string; handle: string }[] | undefined,
  analysisId: string
): Promise<SocialScan> {
  const merged = new Map<string, { platform: string; url: string; handle: string }>();
  for (const a of site?.social ?? []) merged.set(a.platform, a);
  for (const a of extra ?? []) merged.set(a.platform, a);
  const list = [...merged.values()].slice(0, 8);

  const listPlatforms = new Set(list.map((a) => a.platform));

  const sb = createAdminClient();
  const { data: row } = await sb.from("analyses").select("social").eq("id", analysisId).single();
  const saved = ((row?.social as SocialScan | null)?.accounts ?? []);
  const savedPlatforms = new Set(saved.map((acc) => acc.platform));
  // 今回の対象媒体（list、最大8件）のうち、既に保存済みの分はそのまま引き継ぎ、再取得しない
  const already = saved.filter((acc) => listPlatforms.has(acc.platform));
  const pending = list.filter((a) => !savedPlatforms.has(a.platform));

  // 同じ social 列への書き込みを複数件並行で行うと、互いの読み取り→書き込みが
  // 競合して相手の保存結果を消してしまう（read-modify-write の競合）。
  // この呼び出し内では常に直前の保存を待ってから次の保存を始めることで、
  // 1プロセス内での書き込みを直列化して守る（DB側に専用RPCを作るほどの規模ではないため）
  let saveChain: Promise<void> = Promise.resolve();
  const persist = (account: SocialAccount) => {
    saveChain = saveChain.then(async () => {
      const { data: cur } = await sb.from("analyses").select("social").eq("id", analysisId).single();
      const existing = (cur?.social as SocialScan | null)?.accounts ?? [];
      // 2026-10-05: 既に実測できている媒体を、後から来た「取れなかった」結果で上書きしない。
      // 別プロセスと取得が重なったとき、成功済みのデータが失敗結果で消えて再取得（再課金）される
      // 原因になっていた
      const prev = existing.find((x) => x.platform === account.platform);
      if (prev?.readable && !account.readable) return;
      const others = existing.filter((x) => x.platform !== account.platform);
      // 保存に失敗したのに黙って次へ進むと、取得済みの結果（＝課金済み）が残らず、次の試行で同じ
      // 取得をやり直す。失敗したら本文などの重い項目を落として再保存し、最低でも「取得した事実」を残す
      const attempts: SocialAccount[] = [
        deepClean(account),
        deepClean({ ...account, recentContent: null, recentPosts: null, bio: null }),
        deepClean({
          ...account,
          recentContent: null,
          recentPosts: null,
          bio: null,
          title: null,
          reason: account.reason ?? "取得はできましたが、結果を保存できなかったため数値のみ残しています",
        }),
      ];
      for (const acc of attempts) {
        const { error } = await sb
          .from("analyses")
          .update({ social: { accounts: [...others, acc], fetchedAt: new Date().toISOString() } })
          .eq("id", analysisId);
        if (!error) return;
        console.error(`[scanSocial] ${account.platform} の保存に失敗: ${error.message}`);
      }
    });
    return saveChain;
  };

  // 媒体ごとに独立しているので取得自体は並行。1件が遅くても全体は止めず、
  // 取れた媒体はその場で保存する（全件揃うのを待たない）
  const settled = await Promise.allSettled(
    pending.map(async (a) => {
      const acc = await readSocialAccount(a, ownerId, analysisId);
      await persist(acc);
      return acc;
    })
  );

  // readSocialAccount は各媒体内で自前の例外を捕まえて reason を返す設計のため、
  // rejected はここに来るのは想定外の例外のみ。取れなかった事実を残し、次回は再試行させる
  // （保存しない＝savedPlatformsに入らないので、次のtickで自動的に対象へ戻る）
  void settled;
  void already;

  // 返す値は、この呼び出しの手元の集計ではなく、DBに実際に保存されている最新の状態にする。
  // 手元の集計（取得開始時点の保存済み＋今回取れた分）で呼び出し元が上書き保存すると、
  // 取得中に別プロセスが保存した媒体を消してしまい、再取得（再課金）の原因になる
  await saveChain;
  const { data: fin } = await sb.from("analyses").select("social").eq("id", analysisId).single();
  const finalAccounts = ((fin?.social as SocialScan | null)?.accounts ?? []);
  return { accounts: finalAccounts, fetchedAt: new Date().toISOString() };
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
