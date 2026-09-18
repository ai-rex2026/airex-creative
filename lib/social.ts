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
  /** 何で測ったか。公式APIか、公開ページか、Grok(xAI)経由か、利用者の手入力かを画面に出す */
  via: "公式API" | "公開ページ" | "Grok(xAI)" | "手入力" | null;
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
 * X（旧Twitter）はログイン無しでは公開ページの指標がほぼ読めないので、
 * xAI の Grok（x_search ツール）を使う。スクレイピングではなく、
 * xAI が提供している公式APIへのリクエストで、対象アカウントを
 * allowed_x_handles で1件に絞って読みに行かせる。
 *
 * x_search はドキュメント上も「投稿（ポスト）を検索する」ツールで、
 * allowed_x_handles は「このハンドルの“投稿”に絞る」という意味しか持たない。
 * プロフィールページそのものを直接取得するAPIではないため、見つかった投稿や
 * プロフィールのスナップショットにフォロワー数が写っていなければ、
 * アカウント自体は見つかって（found:true）もフォロワー数だけ読めない
 * （followers:null）ことが仕様上ある。以前はポスト検索のクエリだけを
 * 指示しており、さらに前回はプロフィール取得を優先する指示に変え、
 * web_search による二次情報の探索と画像理解も足したが、それでも小規模・
 * ニッチなアカウントではフォロワー数が写ったスナップショットや二次情報に
 * 一度も当たらないケースが残った（xAI側の検索カバレッジの限界）。
 *
 * そのため、この関数での自動取得に加えて、入力タブから利用者が実際の
 * 数値を直接入力できる手段（setSocialFollowers）を別途用意している。
 * 自動取得が失敗しても、利用者が数字を知っていればレポートに反映できる。
 */
function xaiKey() {
  return process.env.XAI_API_KEY;
}

type XaiOutputItem = {
  type?: string;
  content?: { type?: string; text?: string }[];
};
type XaiResponse = {
  output?: XaiOutputItem[];
  error?: { message?: string };
};
type XaiFacts = {
  found?: boolean;
  followers?: number | null;
  posts?: number | null;
  displayName?: string | null;
  bio?: string | null;
  /** 直近の投稿の話題を要約した見出し（原文の引用ではない） */
  recentTopics?: string[] | null;
};

function parseXaiFacts(text: string): XaiFacts | null {
  const stripped = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(stripped);
  } catch {
    const m = stripped.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

async function readX(a: { platform: string; url: string; handle: string }, base: SocialAccount): Promise<SocialAccount> {
  const key = xaiKey();
  if (!key) return { ...base, reason: "xAI(Grok)のAPIキーが未設定のため取得していません" };
  if (!a.handle) return { ...base, reason: "アカウントのハンドルをURLから取り出せませんでした" };

  const prompt = `Xのアカウント「@${a.handle}」の公開プロフィール情報を調べてください
（allowed_x_handles で対象は既にこのアカウント1件に絞ってあります）。

まず x_search ツールで、このアカウントのユーザープロフィールそのもの（個々のポストの検索ではなく
プロフィールページ）を取得することを優先してください。プロフィールがスクリーンショットのような
画像として返ってきた場合は、画像の中に表示されているフォロワー数・フォロー数・投稿数の数字を
必ず読み取ってください（数字が見えているのに null にしないこと）。

x_search だけではフォロワー数が読み取れない場合は、続けて web_search ツールで
「${a.handle} X フォロワー」「${a.handle} followers」のようなクエリを試し、検索結果のスニペットや
キャッシュされたプロフィールページ、SNS分析サイトなど公開されている二次情報に表示されている
フォロワー数を探してください。検索結果に画像（プロフィールのスクリーンショット等）が含まれる
場合は、その画像の数字も読み取って構いません。

それでも見つからない場合のみ、検索クエリに「${a.handle}」や「${a.handle} profile」を使って
ポストを検索し、そこから分かる範囲で補ってください。

取得できた情報から、次を答えてください。
- フォロワー数（実際に表示・記載されている実数。推測や概算は禁止）
- 投稿数（表示されている実数）
- 表示名
- プロフィール文（bio、100文字以内）
- 直近の投稿の話題（recentTopics）。実際に見つかった直近の投稿から、何についての投稿かを
  3〜5件、それぞれ20文字以内の見出しで要約してください（例：「新商品の告知」「来店キャンペーン」）。
  **投稿本文をそのまま書き写さない**こと。話題が分からない・投稿が見つからない場合は空配列でよい

found を false にするのは、あらゆる手段を試してもこのアカウントの存在自体を確認できない・
アカウントが凍結／鍵アカウントである場合だけにしてください。アカウントは見つかったが
フォロワー数など一部の数値だけ読み取れない場合は found を true にして、わかる項目だけ埋めてください
（他の項目は null で構いません）。
似た名前の別アカウントの数値と混同しないでください。

JSONのみで回答してください（前置き・コードフェンス無し）:
{"found":true,"followers":12345,"posts":678,"displayName":"...","bio":"...","recentTopics":["",""]}
見つからない場合: {"found":false}`;

  let json: XaiResponse;
  try {
    const res = await fetch("https://api.x.ai/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.XAI_MODEL || "grok-4.6",
        // xAIの仕様は input を配列（role/content）で受け取る形。文字列のままでも
        // 通ることはあるが、x_search が正しく起動しないケースがあったため、
        // 公式ドキュメント通りの形に合わせる
        input: [{ role: "user", content: prompt }],
        // x_search はプロフィール画像の中身まで読ませるため enable_image_understanding を付ける。
        // 単体では足りないケースがあったため、web_search も追加して二次情報からも探させる。
        // （web_search 側の enable_image_understanding は x_search 側にも及ぶ仕様だが、
        // 意図を明示するため両方に付けている）
        tools: [
          { type: "x_search", allowed_x_handles: [a.handle], enable_image_understanding: true },
          { type: "web_search", enable_image_understanding: true },
        ],
      }),
      // x_search は実測で40〜50秒かかることがある。web_search へのフォールバックが
      // 追加で走る分の余裕を見て、外側より短いタイムアウトで打ち切って理由を残す
      signal: AbortSignal.timeout(110_000),
    });
    json = (await res.json()) as XaiResponse;
    if (!res.ok) {
      return { ...base, reason: `xAI(Grok)を呼べませんでした（${json.error?.message ?? res.status}）` };
    }
  } catch (e) {
    return {
      ...base,
      reason:
        e instanceof Error && e.name === "TimeoutError"
          ? "xAI(Grok)の応答が時間内に返らなかったため取得できませんでした"
          : "xAI(Grok)に接続できませんでした",
    };
  }

  const message = [...(json.output ?? [])].reverse().find((o) => o.type === "message");
  const text = (message?.content ?? []).map((c) => c.text ?? "").join("");
  const facts = text ? parseXaiFacts(text) : null;

  if (!facts) return { ...base, reason: "xAI(Grok)の応答を読み取れませんでした" };
  if (!facts.found) return { ...base, reason: "このアカウントをXで確認できませんでした（非公開・削除済みの可能性）" };

  const followers = typeof facts.followers === "number" && Number.isFinite(facts.followers) ? Math.round(facts.followers) : null;
  const posts = typeof facts.posts === "number" && Number.isFinite(facts.posts) ? Math.round(facts.posts) : null;
  const recentContent = Array.isArray(facts.recentTopics)
    ? facts.recentTopics.filter((t): t is string => typeof t === "string" && t.trim().length > 0).slice(0, 5)
    : null;

  return {
    ...base,
    readable: followers !== null || posts !== null,
    followers,
    posts,
    via: "Grok(xAI)",
    title: facts.displayName ?? null,
    bio: facts.bio ? facts.bio.slice(0, 160) : null,
    recentContent: recentContent && recentContent.length > 0 ? recentContent : null,
    reason: followers === null ? "フォロワー数を確認できませんでした" : null,
  };
}

/**
 * 媒体を1件、実際に見に行って測る。自社アカウントの巡回（scanSocial）だけでなく、
 * SNS競合の実測（social-competitors.ts）からも同じロジックを使い回すため公開している。
 * どちらも「AIの知識で数字を書かない、実測できたものだけを返す」原則は共通のため。
 */
export async function readSocialAccount(a: { platform: string; url: string; handle: string }): Promise<SocialAccount> {
  const base: SocialAccount = {
    ...a, readable: false, followers: null, posts: null, views: null, via: null, title: null, bio: null, reason: null,
    recentContent: null,
  };

  // YouTube だけは公式APIで正規に取れる
  if (/youtube/i.test(a.platform)) return readYouTube(a, base);

  // X（旧Twitter）はログイン無しでは公開ページが読めないため、Grok(xAI) 経由で見に行く
  if (/twitter/i.test(a.platform)) return readX(a, base);

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
  const accounts = await Promise.all(list.map(readSocialAccount));
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
