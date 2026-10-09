/**
 * Googleビジネスプロフィール API の呼び出し。読み取りが中心で、書き込みは patchLocation（説明文・営業時間・Webサイト）だけ。
 *
 * 使う API（どれもプロジェクトで有効化が要る）：
 * - My Business Account Management API  … アカウント一覧
 * - My Business Business Information API … 店舗一覧・基本情報
 * - Google My Business API (v4)          … クチコミ（クチコミだけは今も v4）
 * - Business Profile Performance API     … 表示回数・通話・ルート検索などの日次指標
 */

import { buildPatch, parseProfile, PROFILE_LABEL, type GbpProfile, type ProfileInput, type ProfileKey, type RawProfile } from "./profile";

export type GbpLocation = {
  /** "accounts/123" */
  account: string;
  /** "locations/456" */
  name: string;
  title: string;
  address: string | null;
  website: string | null;
  phone: string | null;
  categories: string[];
  hasHours: boolean;
};

export type GbpReview = {
  reviewId: string;
  /** "accounts/…/locations/…/reviews/…" */
  name: string;
  authorName: string;
  rating: number;
  text: string;
  createdAt: string;
  updatedAt: string;
  reply: string | null;
  repliedAt: string | null;
};

export type GbpMetrics = {
  from: string;
  to: string;
  /** 表示回数（検索＋マップ、PC＋モバイルの合計） */
  impressions: number;
  impressionsBreakdown: { searchDesktop: number; searchMobile: number; mapsDesktop: number; mapsMobile: number };
  calls: number;
  websiteClicks: number;
  directions: number;
};

const RETRY_DELAYS_MS = [700, 1800];

/** API が無効・権限が無いときに、原因が分かる文面にする */
function explain(status: number, body: unknown, label: string): string {
  const e = (body as { error?: { message?: string; status?: string; details?: { reason?: string; metadata?: { service?: string } }[] } })?.error;
  const msg = e?.message ?? "";
  const reason = e?.details?.find((d) => d.reason)?.reason ?? "";
  if (status === 403 && (reason === "SERVICE_DISABLED" || /has not been used|is disabled/i.test(msg))) {
    const svc = e?.details?.find((d) => d.metadata?.service)?.metadata?.service ?? label;
    return `${label}：Google Cloud で ${svc} が有効になっていません`;
  }
  if (status === 429) return `${label}：Google の呼び出し上限に達しました。少し待ってからやり直してください`;
  if (status === 401) return `${label}：Googleの許可が切れています。「連携を解除」して、もう一度連携してください`;
  if (status === 403) return `${label}：このGoogleアカウントには権限がありません（店舗の所有者・管理者のアカウントで連携してください）`;
  return `${label}：${msg || `HTTP ${status}`}`;
}

async function gget<T>(url: string, token: string, label: string, write?: { method: "PATCH" | "PUT" | "DELETE"; body?: unknown }): Promise<T> {
  let last: Error = new Error(`${label}：呼び出せませんでした`);
  for (let i = 0; i <= RETRY_DELAYS_MS.length; i++) {
    let retryable = false;
    try {
      const res = await fetch(url, {
        method: write?.method ?? "GET",
        headers: { authorization: `Bearer ${token}`, ...(write?.body !== undefined ? { "content-type": "application/json" } : {}) },
        ...(write?.body !== undefined ? { body: JSON.stringify(write.body) } : {}),
        signal: AbortSignal.timeout(20000),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) return body as T;
      last = new Error(explain(res.status, body, label));
      retryable = res.status === 429 || res.status >= 500;
    } catch (e) {
      last = new Error(`${label}：${e instanceof Error ? e.message : "通信に失敗しました"}`);
      retryable = true;
    }
    if (!retryable || i === RETRY_DELAYS_MS.length) break;
    await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[i]));
  }
  throw last;
}

// ── 店舗 ─────────────────────────────────────
type RawAccount = { name?: string; accountName?: string; type?: string };
type RawLocation = {
  name?: string;
  title?: string;
  websiteUri?: string;
  phoneNumbers?: { primaryPhone?: string };
  categories?: { primaryCategory?: { displayName?: string }; additionalCategories?: { displayName?: string }[] };
  storefrontAddress?: { regionCode?: string; postalCode?: string; administrativeArea?: string; locality?: string; addressLines?: string[] };
  regularHours?: { periods?: unknown[] };
};

export function mapLocation(account: string, l: RawLocation): GbpLocation | null {
  if (!l.name) return null;
  const a = l.storefrontAddress;
  const address = a
    ? [a.postalCode ? `〒${a.postalCode}` : "", a.administrativeArea ?? "", a.locality ?? "", ...(a.addressLines ?? [])].filter(Boolean).join(" ")
    : null;
  const cats = [l.categories?.primaryCategory?.displayName, ...(l.categories?.additionalCategories ?? []).map((c) => c.displayName)].filter(
    (c): c is string => !!c
  );
  return {
    account,
    // API は "locations/456" で返す。口コミ API（v4）で使うときに account を前に付ける
    name: l.name,
    title: l.title ?? "",
    address: address || null,
    website: l.websiteUri ?? null,
    phone: l.phoneNumbers?.primaryPhone ?? null,
    categories: cats,
    hasHours: (l.regularHours?.periods?.length ?? 0) > 0,
  };
}

export async function listAccounts(token: string): Promise<{ name: string; label: string }[]> {
  const out: { name: string; label: string }[] = [];
  let pageToken = "";
  for (let i = 0; i < 3; i++) {
    const r = await gget<{ accounts?: RawAccount[]; nextPageToken?: string }>(
      `https://mybusinessaccountmanagement.googleapis.com/v1/accounts?pageSize=20${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`,
      token,
      "アカウント一覧"
    );
    for (const a of r.accounts ?? []) if (a.name) out.push({ name: a.name, label: a.accountName ?? a.name });
    if (!r.nextPageToken) break;
    pageToken = r.nextPageToken;
  }
  return out;
}

const READ_MASK = "name,title,storefrontAddress,websiteUri,phoneNumbers,categories,regularHours";

export async function listLocations(token: string, account: string): Promise<GbpLocation[]> {
  const out: GbpLocation[] = [];
  let pageToken = "";
  for (let i = 0; i < 5; i++) {
    const r = await gget<{ locations?: RawLocation[]; nextPageToken?: string }>(
      `https://mybusinessbusinessinformation.googleapis.com/v1/${account}/locations?readMask=${READ_MASK}&pageSize=100${
        pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""
      }`,
      token,
      "店舗一覧"
    );
    for (const l of r.locations ?? []) {
      const m = mapLocation(account, l);
      if (m) out.push(m);
    }
    if (!r.nextPageToken) break;
    pageToken = r.nextPageToken;
  }
  return out;
}

/** 紐付け済みの店舗1件の基本情報（読み取りのみ）。location は "locations/456" */
export async function getLocation(token: string, account: string, location: string): Promise<GbpLocation | null> {
  const r = await gget<RawLocation>(`https://mybusinessbusinessinformation.googleapis.com/v1/${location}?readMask=${READ_MASK}`, token, "店舗情報");
  return mapLocation(account, r);
}

/** 更新の対象にできる項目（説明文・営業時間・Webサイト）の、Google 上の現在の値 */
export async function getProfile(token: string, location: string): Promise<GbpProfile> {
  const r = await gget<RawProfile>(`https://mybusinessbusinessinformation.googleapis.com/v1/${location}?readMask=profile,websiteUri,regularHours`, token, "店舗情報");
  return parseProfile(r);
}

/**
 * 1項目だけ Google に書き込む（updateMask で対象を1項目に絞る）。
 * validateOnly=true なら検証だけで、実際の変更は行われない。呼び出し側が承認を確認したあとにだけ呼ぶこと。
 */
export async function patchLocation(token: string, location: string, key: ProfileKey, input: ProfileInput, validateOnly: boolean): Promise<void> {
  const { updateMask, body } = buildPatch(key, input);
  const q = `updateMask=${encodeURIComponent(updateMask)}${validateOnly ? "&validateOnly=true" : ""}`;
  await gget<unknown>(
    `https://mybusinessbusinessinformation.googleapis.com/v1/${location}?${q}`,
    token,
    `${PROFILE_LABEL[key]}の${validateOnly ? "検証" : "反映"}`,
    { method: "PATCH", body }
  );
}

/** アカウントごとの店舗をまとめて返す。アカウント単位の失敗は errors に残し、取れた分は返す */
export async function listAllLocations(token: string): Promise<{ locations: GbpLocation[]; errors: string[] }> {
  const accounts = await listAccounts(token);
  const settled = await Promise.allSettled(accounts.slice(0, 10).map((a) => listLocations(token, a.name)));
  const locations: GbpLocation[] = [];
  const errors: string[] = [];
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") locations.push(...s.value);
    else errors.push(`${accounts[i].label}：${s.reason instanceof Error ? s.reason.message : "取得に失敗しました"}`);
  });
  return { locations, errors };
}

// ── クチコミ（v4）─────────────────────────────
const STARS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

type RawReview = {
  name?: string;
  reviewId?: string;
  reviewer?: { displayName?: string; isAnonymous?: boolean };
  starRating?: string;
  comment?: string;
  createTime?: string;
  updateTime?: string;
  reviewReply?: { comment?: string; updateTime?: string };
};

export function mapReview(r: RawReview): GbpReview | null {
  const id = r.reviewId ?? r.name?.split("/").pop();
  if (!id || !r.createTime) return null;
  return {
    reviewId: id,
    name: r.name ?? "",
    authorName: r.reviewer?.isAnonymous ? "匿名のユーザー" : (r.reviewer?.displayName ?? ""),
    rating: STARS[r.starRating ?? ""] ?? 0,
    text: r.comment ?? "",
    createdAt: r.createTime,
    updatedAt: r.updateTime ?? r.createTime,
    reply: r.reviewReply?.comment ?? null,
    repliedAt: r.reviewReply?.updateTime ?? null,
  };
}

/** 新しい順に最大200件 */
export async function listReviews(token: string, account: string, location: string): Promise<GbpReview[]> {
  const out: GbpReview[] = [];
  let pageToken = "";
  for (let i = 0; i < 4; i++) {
    const r = await gget<{ reviews?: RawReview[]; nextPageToken?: string }>(
      `https://mybusiness.googleapis.com/v4/${account}/${location}/reviews?pageSize=50&orderBy=${encodeURIComponent("updateTime desc")}${
        pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""
      }`,
      token,
      "クチコミ"
    );
    for (const raw of r.reviews ?? []) {
      const m = mapReview(raw);
      if (m) out.push(m);
    }
    if (!r.nextPageToken) break;
    pageToken = r.nextPageToken;
  }
  return out;
}

/** クチコミへの返信を投稿する（すでに返信があれば上書き）。review は accounts/{a}/locations/{l}/reviews/{r} */
export async function putReply(token: string, reviewName: string, comment: string): Promise<void> {
  if (!/^accounts\/[^/]+\/locations\/[^/]+\/reviews\/[^/]+$/.test(reviewName)) throw new Error("クチコミの指定が不正です");
  const text = comment.trim();
  if (!text) throw new Error("返信文が空です");
  if ([...text].length > 4096) throw new Error("返信文は4096文字までです");
  await gget<unknown>(`https://mybusiness.googleapis.com/v4/${reviewName}/reply`, token, "返信の投稿", { method: "PUT", body: { comment: text } });
}

/** 投稿済みの返信を削除する（取り消し）。返信が無いときは Google 側で何も起きない */
export async function deleteReply(token: string, reviewName: string): Promise<void> {
  if (!/^accounts\/[^/]+\/locations\/[^/]+\/reviews\/[^/]+$/.test(reviewName)) throw new Error("クチコミの指定が不正です");
  await gget<unknown>(`https://mybusiness.googleapis.com/v4/${reviewName}/reply`, token, "返信の削除", { method: "DELETE" });
}

// ── 日次の指標（Performance API）──────────────
const METRICS = [
  "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
  "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
  "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
  "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
  "CALL_CLICKS",
  "WEBSITE_CLICKS",
  "BUSINESS_DIRECTION_REQUESTS",
] as const;

type Series = {
  multiDailyMetricTimeSeries?: {
    dailyMetricTimeSeries?: { dailyMetric?: string; timeSeries?: { datedValues?: { value?: string | number }[] } }[];
  }[];
};

export function sumMetrics(r: Series, from: string, to: string): GbpMetrics {
  const totals: Record<string, number> = {};
  for (const group of r.multiDailyMetricTimeSeries ?? []) {
    for (const s of group.dailyMetricTimeSeries ?? []) {
      if (!s.dailyMetric) continue;
      // 値が無い日は 0 回ではなく「データ無し」で返ることがあるので、あるものだけ足す
      const sum = (s.timeSeries?.datedValues ?? []).reduce((a, v) => a + (Number(v.value) || 0), 0);
      totals[s.dailyMetric] = (totals[s.dailyMetric] ?? 0) + sum;
    }
  }
  const g = (k: string) => totals[k] ?? 0;
  const b = {
    searchDesktop: g("BUSINESS_IMPRESSIONS_DESKTOP_SEARCH"),
    searchMobile: g("BUSINESS_IMPRESSIONS_MOBILE_SEARCH"),
    mapsDesktop: g("BUSINESS_IMPRESSIONS_DESKTOP_MAPS"),
    mapsMobile: g("BUSINESS_IMPRESSIONS_MOBILE_MAPS"),
  };
  return {
    from,
    to,
    impressions: b.searchDesktop + b.searchMobile + b.mapsDesktop + b.mapsMobile,
    impressionsBreakdown: b,
    calls: g("CALL_CLICKS"),
    websiteClicks: g("WEBSITE_CLICKS"),
    directions: g("BUSINESS_DIRECTION_REQUESTS"),
  };
}

const ymd = (d: Date) => ({ y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() });
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** 直近28日。直近2日は集計が確定していないことがあるので、終わりを2日前にする */
export async function fetchMetrics(token: string, location: string, now = new Date()): Promise<GbpMetrics> {
  const end = new Date(now.getTime() - 2 * 864e5);
  const start = new Date(end.getTime() - 27 * 864e5);
  const s = ymd(start);
  const e = ymd(end);
  const q = [
    ...METRICS.map((m) => `dailyMetrics=${m}`),
    `dailyRange.start_date.year=${s.y}`,
    `dailyRange.start_date.month=${s.m}`,
    `dailyRange.start_date.day=${s.d}`,
    `dailyRange.end_date.year=${e.y}`,
    `dailyRange.end_date.month=${e.m}`,
    `dailyRange.end_date.day=${e.d}`,
  ].join("&");
  const r = await gget<Series>(
    `https://businessprofileperformance.googleapis.com/v1/${location}:fetchMultiDailyMetricsTimeSeries?${q}`,
    token,
    "表示回数などの指標"
  );
  return sumMetrics(r, iso(start), iso(end));
}
