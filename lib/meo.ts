import type { SiteScan } from "./site-scan";

/**
 * MEO（Googleマップ対策）。Places API の実データだけで組み立てる。
 *
 * 「そのビジネスプロフィールが本当にこのサイトの店か」は、
 * Places が返す websiteUri とサイトのホスト名を突き合わせて確かめる。
 * 一致しなければ別の店なので、推測で当てはめずに「特定できず」で返す。
 */

const ENDPOINT = "https://places.googleapis.com/v1";

export function hasPlacesApi() {
  return !!process.env.GOOGLE_MAPS_API_KEY;
}

export type MeoPlace = {
  name: string;
  address: string;
  rating: number | null;
  reviews: number;
  mapsUri: string | null;
  website: string | null;
};

/** 店舗1つ分の実測。複数拠点のクライアントがあるので配列で持つ */
export type MeoStore = {
  self: MeoPlace;
  competitors: MeoPlace[];
  ratingRank: number | null;
  reviewRank: number | null;
  totalShops: number;
  avgRating: number | null;
  avgReviews: number | null;
  score: number;
  breakdown: { label: string; got: number; max: number; note: string }[];
};

export type MeoScan = {
  /** 見つかった全店舗。1店舗なら1件 */
  stores: MeoStore[];
  /** 以下は先頭の店舗。既存の画面と生成が参照しているので残す */
  self: MeoPlace | null;
  competitors: MeoPlace[];
  /** 自社を含めた順位。1始まり */
  ratingRank: number | null;
  reviewRank: number | null;
  totalShops: number;
  avgRating: number | null;
  avgReviews: number | null;
  score: number;
  /** 点の内訳。何を測って何点にしたかを画面に出す */
  breakdown: { label: string; got: number; max: number; note: string }[];
  /** 特定できなかったときの理由 */
  reason: string | null;
  searchedAt: string;
};

type RawPlace = {
  displayName?: { text?: string };
  formattedAddress?: string;
  rating?: number;
  userRatingCount?: number;
  websiteUri?: string;
  googleMapsUri?: string;
  primaryType?: string;
  location?: { latitude: number; longitude: number };
  regularOpeningHours?: unknown;
  nationalPhoneNumber?: string;
};

const FIELDS = [
  "places.displayName",
  "places.formattedAddress",
  "places.rating",
  "places.userRatingCount",
  "places.websiteUri",
  "places.googleMapsUri",
  "places.primaryType",
  "places.location",
  "places.regularOpeningHours",
  "places.nationalPhoneNumber",
].join(",");

async function call(path: string, body: unknown): Promise<RawPlace[]> {
  const res = await fetch(`${ENDPOINT}/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Goog-Api-Key": process.env.GOOGLE_MAPS_API_KEY!,
      "X-Goog-FieldMask": FIELDS,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Places API: ${res.status}`);
  const j = (await res.json()) as { places?: RawPlace[] };
  return j.places ?? [];
}

function toPlace(p: RawPlace): MeoPlace {
  return {
    name: p.displayName?.text ?? "",
    address: p.formattedAddress ?? "",
    rating: typeof p.rating === "number" ? p.rating : null,
    reviews: p.userRatingCount ?? 0,
    mapsUri: p.googleMapsUri ?? null,
    website: p.websiteUri ?? null,
  };
}

const host = (u: string | null | undefined) => {
  if (!u) return "";
  try {
    return new URL(u).host.replace(/^www\./, "");
  } catch {
    return "";
  }
};

function empty(reason: string): MeoScan {
  return {
    stores: [],
    self: null, competitors: [], ratingRank: null, reviewRank: null, totalShops: 0,
    avgRating: null, avgReviews: null, score: 0, breakdown: [], reason,
    searchedAt: new Date().toISOString(),
  };
}

/**
 * 実測できる項目だけで100点満点を組む。
 * 写真枚数・投稿頻度は Places API では取れないので採点に入れない（取れないものを推測しない）。
 */
function grade(self: RawPlace, competitors: MeoPlace[]): MeoScan["breakdown"] {
  const rating = self.rating ?? 0;
  const reviews = self.userRatingCount ?? 0;
  const med = competitors.length
    ? [...competitors].map((c) => c.reviews).sort((a, b) => a - b)[Math.floor(competitors.length / 2)]
    : 0;

  const ratio = med > 0 ? Math.min(reviews / med, 1) : reviews > 0 ? 1 : 0;

  return [
    {
      label: "ビジネスプロフィールの登録",
      got: 20, max: 20,
      note: "Googleマップに掲載されていることを確認しました。",
    },
    {
      label: "評価",
      got: Math.round((Math.max(rating - 3, 0) / 2) * 30),
      max: 30,
      note: rating ? `星 ${rating.toFixed(1)}。星3.0を0点、星5.0を満点として換算しています。` : "評価がまだ付いていません。",
    },
    {
      label: "レビュー数（競合の中央値比）",
      got: Math.round(ratio * 30),
      max: 30,
      note: med > 0
        ? `${reviews}件。近隣同業の中央値 ${med}件に対して ${Math.round(ratio * 100)}% です。`
        : `${reviews}件。比較できる近隣同業が見つかりませんでした。`,
    },
    {
      label: "営業時間の登録",
      got: self.regularOpeningHours ? 10 : 0, max: 10,
      note: self.regularOpeningHours ? "登録されています。" : "未登録です。マップ上で「営業時間不明」と表示されます。",
    },
    {
      label: "電話番号の登録",
      got: self.nationalPhoneNumber ? 10 : 0, max: 10,
      note: self.nationalPhoneNumber ? "登録されています。" : "未登録です。マップから直接電話できません。",
    },
  ];
}


/**
 * 検索に使う店名の候補。
 * 日本語サイトのタイトルは「説明｜店名」の並びが多く、先頭を取ると説明文を掴む。
 * 逆の並びのサイトもあるので両端を候補に入れ、ドメイン一致で正解を選ばせる。
 */
function nameCandidates(site: SiteScan | null): string[] {
  const out: string[] = [];
  const push = (v: string | null | undefined) => {
    const t = v?.trim();
    if (t && t.length >= 2 && !out.includes(t)) out.push(t);
  };
  push(site?.bizName);
  const parts = (site?.title ?? "").split(/[|｜\-–—:：]/).map((x) => x.trim()).filter(Boolean);
  push(parts[parts.length - 1]);
  push(parts[0]);
  push(site?.title);
  return out.slice(0, 3);
}

export async function scanMeo(site: SiteScan | null, url: string | null): Promise<MeoScan> {
  if (!hasPlacesApi()) return empty("Places API が未設定です");
  if (!url) return empty("URLがないため照合できません");

  const ourHost = host(url) || host(site?.finalUrl);
  const candidates = nameCandidates(site);
  if (candidates.length === 0) return empty("店舗名を特定できませんでした");

  // 候補を順に試し、サイトのドメインが一致したものを自社とする。
  // 同名の別店舗を掴まないための照合なので、一致しなければ採用しない。
  // 多拠点のクライアントがあるので、一致したものは**すべて**拾う。
  const mine = new Map<string, RawPlace>();
  let sawAny = false;
  for (const name of candidates) {
    if (mine.size > 0) break;
    const query = [name, site?.bizAddress ?? ""].filter(Boolean).join(" ");
    let found: RawPlace[];
    try {
      found = await call("places:searchText", {
        textQuery: query,
        languageCode: "ja",
        regionCode: "JP",
        maxResultCount: 20,
      });
    } catch (e) {
      return empty(e instanceof Error ? e.message : "Places API を呼べませんでした");
    }
    if (found.length) sawAny = true;
    for (const p of found) {
      if (host(p.websiteUri) !== ourHost) continue;
      // 同じ店舗が別クエリで重複しないよう、住所で束ねる
      mine.set(p.formattedAddress ?? p.displayName?.text ?? String(mine.size), p);
    }
  }
  if (mine.size === 0) {
    return empty(
      sawAny
        ? "Googleビジネスプロフィールは見つかりましたが、登録されているウェブサイトがこのサイトと一致しませんでした。プロフィール側のURLをご確認ください。"
        : "Googleビジネスプロフィールが見つかりませんでした。未登録の可能性があります。"
    );
  }

  // 近隣の取得は店舗ごとに API を1回使うので、上限を置く
  const selves = [...mine.values()].slice(0, 5);
  const stores: MeoStore[] = [];

  for (const one of selves) {
    let nearby: RawPlace[] = [];
    if (one.location && one.primaryType && stores.length < 3) {
      try {
        nearby = await call("places:searchNearby", {
          includedPrimaryTypes: [one.primaryType],
          languageCode: "ja",
          regionCode: "JP",
          maxResultCount: 20,
          locationRestriction: { circle: { center: one.location, radius: 3000 } },
        });
      } catch {
        // 近隣が取れなくても自社の数値は出せるので、そのまま進む
      }
    }

    const competitors = nearby
      .filter((p) => host(p.websiteUri) !== ourHost && p.displayName?.text !== one.displayName?.text)
      .map(toPlace)
      .sort((a, b) => b.reviews - a.reviews)
      .slice(0, 10);

    const me = toPlace(one);
    const all = [me, ...competitors];
    const rated = all.filter((p) => p.rating !== null);
    const isMe = (p: MeoPlace) => p.name === me.name && p.reviews === me.reviews;
    const ratingRank = one.rating
      ? [...rated].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0)).findIndex(isMe) + 1
      : null;
    const reviewRank = [...all].sort((a, b) => b.reviews - a.reviews).findIndex(isMe) + 1;

    stores.push({
      self: me,
      competitors,
      ratingRank: ratingRank && ratingRank > 0 ? ratingRank : null,
      reviewRank: reviewRank > 0 ? reviewRank : null,
      totalShops: all.length,
      avgRating: rated.length ? Number((rated.reduce((n, p) => n + (p.rating ?? 0), 0) / rated.length).toFixed(1)) : null,
      avgReviews: competitors.length ? Math.round(competitors.reduce((n, p) => n + p.reviews, 0) / competitors.length) : null,
      score: grade(one, competitors).reduce((n, b) => n + b.got, 0),
      breakdown: grade(one, competitors),
    });
  }

  const head = stores[0];
  return {
    stores,
    self: head.self,
    competitors: head.competitors,
    ratingRank: head.ratingRank,
    reviewRank: head.reviewRank,
    totalShops: head.totalShops,
    avgRating: head.avgRating,
    avgReviews: head.avgReviews,
    score: head.score,
    breakdown: head.breakdown,
    reason: null,
    searchedAt: new Date().toISOString(),
  };
}
