/**
 * Meta（Facebook Login / Instagram Graph API）連携。
 *
 * Facebookは Google と違い refresh_token を発行しない。ブラウザから戻る
 * provider_token は数時間で切れる短期トークンなので、サーバー側で
 * fb_exchange_token に交換して60日間の長期トークンにしてから保存する
 * （長期トークンは期限が来る前に同じ交換を繰り返せば延長できる＝実質のrefresh）。
 *
 * 権限は pages_show_list / pages_read_engagement / instagram_basic /
 * instagram_manage_insights に加えて business_management を使う（理由は下記）。
 *
 * 【2026/10 に特定した重要な注意点】
 * Business Portfolio（Business Manager）配下のページ・Instagramアカウントは、
 * OAuth同意画面で正しくページ選択を行っても /me/accounts が常に空配列を返すことがある
 * （Facebook Login for Business の config_id 方式で「アクセスするページを選択」まで
 * 完了させても再現した。Graph API Explorerで直接 /me/accounts を叩いても同じ）。
 * 一方でページIDを直接指定した取得（/{page_id}）は常に成功する。
 *
 * 正しい発見経路は /me/businesses → /{business_id}/owned_pages で、ここには
 * business_management 権限が要る。discoverMetaPages はまず /me/accounts を試し、
 * 空だった場合にこの経路へフォールバックする（個人ページ・Business配下ページの
 * どちらでも動くようにするため）。
 */

const GRAPH = "https://graph.facebook.com/v21.0";

export const META_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "instagram_basic",
  "instagram_manage_insights",
  "business_management",
].join(",");

export function hasMetaApp() {
  return !!(process.env.META_APP_ID && process.env.META_APP_SECRET);
}

/** 数時間で切れる短期トークンを、60日間の長期トークンに交換する */
export async function exchangeLongLivedToken(shortLivedToken: string): Promise<{ accessToken: string; expiresAt: string }> {
  const res = await fetch(
    `${GRAPH}/oauth/access_token?` +
      new URLSearchParams({
        grant_type: "fb_exchange_token",
        client_id: process.env.META_APP_ID!,
        client_secret: process.env.META_APP_SECRET!,
        fb_exchange_token: shortLivedToken,
      }),
    { signal: AbortSignal.timeout(15000) }
  );
  const j = await res.json();
  if (!res.ok || !j.access_token) throw new Error(j.error?.message ?? "長期トークンへの交換に失敗しました");
  const expiresInSec = j.expires_in ?? 60 * 86400; // 返らないことがあるので60日を既定にする
  return { accessToken: j.access_token as string, expiresAt: new Date(Date.now() + expiresInSec * 1000).toISOString() };
}

export type MetaPageCandidate = {
  pageId: string;
  pageName: string;
  pageAccessToken: string;
  igBusinessId: string | null;
  igUsername: string | null;
};

type RawPage = {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: { id: string; username?: string };
};

const PAGE_FIELDS = "id,name,access_token,instagram_business_account{id,username}";

function toCandidate(p: RawPage): MetaPageCandidate {
  return {
    pageId: p.id,
    pageName: p.name,
    pageAccessToken: p.access_token,
    igBusinessId: p.instagram_business_account?.id ?? null,
    igUsername: p.instagram_business_account?.username ?? null,
  };
}

/** 個人アカウントとして管理しているページ（Business Portfolio配下ではないページ）を列挙する */
async function listPagesViaMeAccounts(userAccessToken: string): Promise<MetaPageCandidate[]> {
  const res = await fetch(
    `${GRAPH}/me/accounts?fields=${encodeURIComponent(PAGE_FIELDS)}&access_token=${encodeURIComponent(userAccessToken)}`,
    { signal: AbortSignal.timeout(15000) }
  );
  const j = await res.json();
  if (!res.ok) throw new Error(j.error?.message ?? "Facebook Pageの取得に失敗しました");
  const data: RawPage[] = j.data ?? [];
  return data.map(toCandidate);
}

/**
 * Business Portfolio配下のページを列挙する（/me/accounts では取得できないページ用の経路）。
 * business_management 権限が要る。
 */
async function listPagesViaBusinesses(userAccessToken: string): Promise<MetaPageCandidate[]> {
  const bizRes = await fetch(
    `${GRAPH}/me/businesses?access_token=${encodeURIComponent(userAccessToken)}`,
    { signal: AbortSignal.timeout(15000) }
  );
  const bizJson = await bizRes.json();
  if (!bizRes.ok) return []; // business_management が無い等。空扱いにして呼び出し元のエラーに委ねる
  const businesses: { id: string }[] = bizJson.data ?? [];

  const pagesByBusiness = await Promise.all(
    businesses.map(async (b) => {
      const res = await fetch(
        `${GRAPH}/${b.id}/owned_pages?fields=${encodeURIComponent(PAGE_FIELDS)}&access_token=${encodeURIComponent(userAccessToken)}`,
        { signal: AbortSignal.timeout(15000) }
      );
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return [];
      const data: RawPage[] = j.data ?? [];
      return data.map(toCandidate);
    })
  );

  return pagesByBusiness.flat();
}

/**
 * ユーザーの長期トークンから、管理しているPageと紐づくInstagramビジネスアカウントを列挙する。
 * まず /me/accounts を試し、空であれば Business Portfolio 経由（/me/businesses →
 * owned_pages）にフォールバックする。
 * Page個別のアクセストークンは、ユーザートークンが長期であれば同様に長期になる
 * （ユーザーがPage管理者であり続ける限り、明示的に無効化されない）。
 */
export async function discoverMetaPages(userAccessToken: string): Promise<MetaPageCandidate[]> {
  const direct = await listPagesViaMeAccounts(userAccessToken);
  if (direct.length > 0) return direct;

  const viaBusiness = await listPagesViaBusinesses(userAccessToken);
  if (viaBusiness.length > 0) return viaBusiness;

  return [];
}

/** Instagramビジネスアカウントの基本情報（フォロワー数・投稿数）。実測のみ、無ければnull */
export type InstagramProfile = {
  followersCount: number | null;
  followsCount: number | null;
  mediaCount: number | null;
  username: string | null;
};

export async function fetchInstagramProfile(pageAccessToken: string, igBusinessId: string): Promise<InstagramProfile | null> {
  const res = await fetch(
    `${GRAPH}/${igBusinessId}?fields=${encodeURIComponent("username,followers_count,follows_count,media_count")}&access_token=${encodeURIComponent(pageAccessToken)}`,
    { signal: AbortSignal.timeout(15000) }
  );
  const j = await res.json();
  if (!res.ok) return null;
  return {
    followersCount: j.followers_count ?? null,
    followsCount: j.follows_count ?? null,
    mediaCount: j.media_count ?? null,
    username: j.username ?? null,
  };
}

export type InstagramInsights = {
  from: string;
  to: string;
  reach: number | null;
  profileViews: number | null;
};

/** 直近28日の到達数・プロフィール閲覧数。instagram_manage_insights が要る */
export async function fetchInstagramInsights(pageAccessToken: string, igBusinessId: string): Promise<InstagramInsights | null> {
  const to = new Date();
  const from = new Date(Date.now() - 28 * 864e5);
  const res = await fetch(
    `${GRAPH}/${igBusinessId}/insights?` +
      new URLSearchParams({
        metric: "reach,profile_views",
        period: "day",
        since: String(Math.floor(from.getTime() / 1000)),
        until: String(Math.floor(to.getTime() / 1000)),
        access_token: pageAccessToken,
      }),
    { signal: AbortSignal.timeout(20000) }
  );
  const j = await res.json();
  if (!res.ok) return null;

  const sum = (name: string) => {
    const metric = (j.data ?? []).find((m: { name: string }) => m.name === name);
    const values: { value: number }[] = metric?.values ?? [];
    return values.length ? values.reduce((a, v) => a + (v.value ?? 0), 0) : null;
  };

  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    reach: sum("reach"),
    profileViews: sum("profile_views"),
  };
}

export type InstagramMedia = {
  id: string;
  caption: string | null;
  timestamp: string | null;
  likeCount: number | null;
  commentsCount: number | null;
};

/** 直近の投稿（キャプション・いいね・コメント数）。instagram_basic の範囲で読める */
export async function fetchInstagramRecentMedia(pageAccessToken: string, igBusinessId: string, limit = 5): Promise<InstagramMedia[]> {
  const res = await fetch(
    `${GRAPH}/${igBusinessId}/media?` +
      new URLSearchParams({
        fields: "id,caption,timestamp,like_count,comments_count",
        limit: String(Math.min(Math.max(limit, 1), 20)),
        access_token: pageAccessToken,
      }),
    { signal: AbortSignal.timeout(15000) }
  );
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error?.message ?? `HTTP ${res.status}`);
  const rows: { id: string; caption?: string; timestamp?: string; like_count?: number; comments_count?: number }[] = j.data ?? [];
  return rows.map((r) => ({
    id: r.id,
    caption: r.caption ?? null,
    timestamp: r.timestamp ?? null,
    likeCount: typeof r.like_count === "number" ? r.like_count : null,
    commentsCount: typeof r.comments_count === "number" ? r.comments_count : null,
  }));
}
