import type { MeoCompetitor, MeoStoreSnapshot, StoreCandidate } from "./types";

/**
 * MEO運用で使う Google Places API（v1）。
 * AI-REX 本体の app/services/external/places_client.py と meo_score_engine.py の移植。
 *
 * キーはサーバーにしか置けないので、ブラウザからは呼ばない（Server Action 経由）。
 */

const ENDPOINT = "https://places.googleapis.com/v1";

export function hasPlacesKey() {
  return !!process.env.GOOGLE_MAPS_API_KEY;
}

const PRICE_LEVEL: Record<string, number | null> = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
  PRICE_LEVEL_UNSPECIFIED: null,
};

type RawPlace = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  rating?: number;
  userRatingCount?: number;
  photos?: unknown[];
  priceLevel?: string;
  regularOpeningHours?: unknown;
  primaryType?: string;
  primaryTypeDisplayName?: { text?: string };
  location?: { latitude: number; longitude: number };
};

/**
 * 429 は1回だけ待って再試行、5xx は指数バックオフで3回まで。
 * それ以外の失敗は null（呼び出し側で「取れなかった」として扱う）。
 */
async function request<T>(method: "GET" | "POST", url: string, fieldMask: string, body?: unknown): Promise<T | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  let retried429 = false;
  let retries5xx = 0;
  let backoff = 1000;
  for (;;) {
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: { "content-type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": fieldMask },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
      });
    } catch {
      return null;
    }
    if (res.ok) return (await res.json()) as T;
    if (res.status === 429 && !retried429) {
      retried429 = true;
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }
    if (res.status >= 500 && retries5xx < 3) {
      retries5xx++;
      await new Promise((r) => setTimeout(r, backoff));
      backoff *= 2;
      continue;
    }
    return null;
  }
}

/**
 * 自社店舗の候補を複数取得する。Text Search はリクエスト単位の課金で件数では料金が変わらないため、
 * 1件で決め打ちするより候補を並べてユーザーに選ばせる方が損がない。
 */
export async function searchStoreCandidates(query: string, limit = 5): Promise<StoreCandidate[]> {
  const data = await request<{ places?: RawPlace[] }>(
    "POST",
    `${ENDPOINT}/places:searchText`,
    "places.id,places.displayName,places.formattedAddress,places.websiteUri",
    { textQuery: query, languageCode: "ja", regionCode: "JP", maxResultCount: Math.min(limit, 10) }
  );
  const out: StoreCandidate[] = [];
  for (const p of data?.places ?? []) {
    const name = p.displayName?.text ?? "";
    const address = p.formattedAddress ?? null;
    // 名前も住所も無い候補は見分けられないので出さない
    if (!p.id || !(name || address)) continue;
    out.push({ place_id: p.id, name, address });
  }
  return out;
}

/** 候補のうちサイトのドメインが一致するもの（自動特定に使う） */
export async function searchCandidatesWithSite(query: string): Promise<(StoreCandidate & { website: string | null })[]> {
  const data = await request<{ places?: RawPlace[] }>(
    "POST",
    `${ENDPOINT}/places:searchText`,
    "places.id,places.displayName,places.formattedAddress,places.websiteUri",
    { textQuery: query, languageCode: "ja", regionCode: "JP", maxResultCount: 10 }
  );
  return (data?.places ?? [])
    .filter((p) => p.id && (p.displayName?.text || p.formattedAddress))
    .map((p) => ({
      place_id: p.id!,
      name: p.displayName?.text ?? "",
      address: p.formattedAddress ?? null,
      website: p.websiteUri ?? null,
    }));
}

const DETAIL_FIELDS = [
  "id",
  "displayName",
  "formattedAddress",
  "nationalPhoneNumber",
  "websiteUri",
  "googleMapsUri",
  "rating",
  "userRatingCount",
  "photos",
  "priceLevel",
  "regularOpeningHours",
  "primaryType",
  "primaryTypeDisplayName",
  "location",
].join(",");

export type PlaceDetail = Omit<MeoStoreSnapshot, "competitors" | "meoScore" | "ratingRank" | "reviewRank" | "fetchedAt">;

export async function getPlaceDetails(placeId: string): Promise<PlaceDetail | null> {
  const p = await request<RawPlace>("GET", `${ENDPOINT}/places/${encodeURIComponent(placeId)}?languageCode=ja&regionCode=JP`, DETAIL_FIELDS);
  if (!p || !p.id) return null;
  return {
    placeId: p.id,
    name: p.displayName?.text ?? "",
    address: p.formattedAddress ?? null,
    category: p.primaryTypeDisplayName?.text ?? null,
    primaryType: p.primaryType ?? null,
    phoneNumber: p.nationalPhoneNumber ?? null,
    websiteUrl: p.websiteUri ?? null,
    mapsUri: p.googleMapsUri ?? null,
    rating: typeof p.rating === "number" ? p.rating : null,
    reviewCount: typeof p.userRatingCount === "number" ? p.userRatingCount : null,
    // Places が返す写真は最大10件。本体と同じく「返ってきた件数」を枚数として扱う
    photoCount: Array.isArray(p.photos) ? p.photos.length : null,
    priceLevel: p.priceLevel ? (PRICE_LEVEL[p.priceLevel] ?? null) : null,
    hasOpeningHours: !!p.regularOpeningHours,
    location: p.location ?? null,
  };
}

/** 半径2km以内の同業（人気順）。自店は除く */
export async function nearbyCompetitors(detail: PlaceDetail, max = 10): Promise<MeoCompetitor[]> {
  if (!detail.location || !detail.primaryType) return [];
  const data = await request<{ places?: RawPlace[] }>(
    "POST",
    `${ENDPOINT}/places:searchNearby`,
    "places.id,places.displayName,places.rating,places.userRatingCount,places.photos",
    {
      locationRestriction: { circle: { center: detail.location, radius: 2000 } },
      includedTypes: [detail.primaryType],
      maxResultCount: Math.min(max + 1, 20),
      rankPreference: "POPULARITY",
      languageCode: "ja",
      regionCode: "JP",
    }
  );
  return (data?.places ?? [])
    .filter((p) => p.id && p.id !== detail.placeId)
    .slice(0, max)
    .map((p) => ({
      placeId: p.id!,
      name: p.displayName?.text ?? "",
      rating: typeof p.rating === "number" ? p.rating : null,
      reviewCount: typeof p.userRatingCount === "number" ? p.userRatingCount : null,
      photoCount: Array.isArray(p.photos) ? p.photos.length : null,
    }));
}

/**
 * MEOスコアの決定論的算出（本体 core/analysis/rules/meo_score_engine.py の移植）。
 * 外部IOを持たないので、日次スナップショットでは保存済みの競合で再計算する。
 */
export function scoreMeo(own: PlaceDetail, competitors: MeoCompetitor[]) {
  const ratings = competitors.map((c) => c.rating).filter((v): v is number => v != null);
  const reviews = competitors.map((c) => c.reviewCount).filter((v): v is number => v != null);
  const avgRating = ratings.length ? ratings.reduce((s, v) => s + v, 0) / ratings.length : null;
  const avgReviews = reviews.length ? reviews.reduce((s, v) => s + v, 0) / reviews.length : null;

  const rankOf = (mine: number | null, others: number[]) => {
    if (mine == null) return null;
    const all = [mine, ...others].sort((a, b) => b - a);
    return all.indexOf(mine) + 1;
  };

  let score = 30; // Googleビジネスプロフィールがある
  if (competitors.length) {
    if (own.rating != null && avgRating) score += Math.round(25 * Math.min(own.rating / avgRating, 1));
    if (own.reviewCount != null && avgReviews) score += Math.round(25 * Math.min(own.reviewCount / avgReviews, 1));
  }
  if (own.photoCount != null) {
    if (own.photoCount >= 30) score += 10;
    else if (own.photoCount >= 10) score += 5;
  }
  if (own.priceLevel != null) score += 10;

  return {
    meoScore: score,
    ratingRank: rankOf(own.rating, ratings),
    reviewRank: rankOf(own.reviewCount, reviews),
  };
}

/** 店舗を確定したときの実測一式（自店の詳細＋近隣競合＋スコア） */
export async function buildStoreSnapshot(placeId: string): Promise<MeoStoreSnapshot | null> {
  const detail = await getPlaceDetails(placeId);
  if (!detail) return null;
  const competitors = await nearbyCompetitors(detail);
  return { ...detail, competitors, ...scoreMeo(detail, competitors), fetchedAt: new Date().toISOString() };
}

export function hostOf(u: string | null | undefined): string {
  if (!u) return "";
  try {
    return new URL(u).host.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}
