import type { SiteScan } from "./site-scan";

/**
 * MEO（Googleマップ対策）。Places API の実データだけで組み立てる。
 *
 * 「そのビジネスプロフィールが本当にこのサイトの店か」は、
 * Places が返す websiteUri とサイトのホスト名を突き合わせて確かめる。
 * 一致しなければ別の店なので、推測で当てはめずに「特定できず」で返す。
 */

const ENDPOINT = "https://places.googleapis.com/v1";

/** 拾う店舗数の上限。チェーンの多拠点を一覧で見たいので大きく取る */
const MAX_STORES = 100;
/**
 * 近隣同業との比較まで行う店舗数の上限。
 * 比較は店舗1つにつき Places API を1回使うので、回数と時間がそのまま増える。
 */
const MAX_COMPARE = 20;
/** 走査全体の制限時間。ここを超えたら打ち切って、取れたぶんで返す */
const BUDGET_MS = 120_000;
/**
 * 多拠点と分かったときだけ、都道府県で分けて検索を足す。
 * テキスト検索は1クエリ最大60件で、全国チェーンはそこで頭打ちになる。
 * （湘南美容クリニックで37件。都道府県を足さないとこれ以上増えない）
 */
const CHAIN_THRESHOLD = 10;
/** 屋号＋支店名の店舗が1つだけ見つかったときに、取りこぼしを確かめる主要都市 */
const METRO_PREFECTURES = [
  "東京都","大阪府","愛知県","神奈川県","福岡県","埼玉県","千葉県","兵庫県","京都府","北海道","宮城県","広島県",
];
const PREFECTURES = [
  "北海道","青森県","岩手県","宮城県","秋田県","山形県","福島県",
  "茨城県","栃木県","群馬県","埼玉県","千葉県","東京都","神奈川県",
  "新潟県","富山県","石川県","福井県","山梨県","長野県",
  "岐阜県","静岡県","愛知県","三重県",
  "滋賀県","京都府","大阪府","兵庫県","奈良県","和歌山県",
  "鳥取県","島根県","岡山県","広島県","山口県",
  "徳島県","香川県","愛媛県","高知県",
  "福岡県","佐賀県","長崎県","熊本県","大分県","宮崎県","鹿児島県","沖縄県",
];

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
  /** 満点。近隣比較が取れない店舗は競合比の項目を外すので満点が下がる */
  scoreMax: number;
  /** 近隣同業と比較できたか。できていない店舗の順位は出さない */
  compared: boolean;
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
  scoreMax: number;
  /** 近隣比較まで取れた店舗数。全店舗ぶんは呼び出し回数と時間が足りない */
  comparedCount: number;
  /** 点の内訳。何を測って何点にしたかを画面に出す */
  breakdown: { label: string; got: number; max: number; note: string }[];
  /** 特定できなかったときの理由 */
  reason: string | null;
  /**
   * 検索の一部がGoogle側のエラーで取れず、店舗が実際より少なく出ている可能性があるときの注記。
   * 取れていれば null / 無し
   */
  partial?: string | null;
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

async function call(path: string, body: unknown, withToken = false): Promise<{ places: RawPlace[]; next?: string }> {
  // 429（呼び出しが多すぎる）・5xx・ネットワークの瞬断は一時的なことが多い。
  // 以前は1回失敗した時点でその検索ごと捨てていて、多拠点のクライアントで店舗が1つしか
  // 取れない回があった（同じサイトで8店舗取れた分析と、1店舗だけの分析が混在した）。
  // 少し待って最大3回まで試す。それ以外のエラー（キー無効・権限等）は待っても直らないのでそのまま返す
  const DELAYS_MS = [700, 1800];
  let lastError: Error = new Error("Places API を呼べませんでした");
  for (let i = 0; i <= DELAYS_MS.length; i++) {
    let retryable = false;
    try {
      const res = await fetch(`${ENDPOINT}/${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Goog-Api-Key": process.env.GOOGLE_MAPS_API_KEY!,
          "X-Goog-FieldMask": withToken ? `${FIELDS},nextPageToken` : FIELDS,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        const j = (await res.json()) as { places?: RawPlace[]; nextPageToken?: string };
        return { places: j.places ?? [], next: j.nextPageToken };
      }
      lastError = new Error(`Places API: ${res.status}`);
      retryable = res.status === 429 || res.status >= 500;
    } catch (e) {
      // ネットワークの瞬断・タイムアウトは再試行の対象
      lastError = e instanceof Error ? e : new Error(String(e));
      retryable = true;
    }
    if (!retryable || i === DELAYS_MS.length) throw lastError;
    await new Promise((r) => setTimeout(r, DELAYS_MS[i]));
  }
  throw lastError;
}

/**
 * テキスト検索を最後のページまで辿る。
 * 1ページ20件までなので、多拠点のチェーンは1回の呼び出しでは拾い切れない。
 */
async function searchAllPages(textQuery: string, pages: number, onPartial?: () => void): Promise<RawPlace[]> {
  const out: RawPlace[] = [];
  let token: string | undefined;
  for (let i = 0; i < pages; i++) {
    let r: { places: RawPlace[]; next?: string };
    try {
      r = await call(
        "places:searchText",
        { textQuery, languageCode: "ja", regionCode: "JP", pageSize: 20, ...(token ? { pageToken: token } : {}) },
        true
      );
    } catch (e) {
      // 1ページ目が取れなければ呼び出し元に失敗として返す。2ページ目以降の失敗は、
      // ここまでに取れたページを捨てずに返す（全部捨てると店舗が欠ける）
      if (i === 0) throw e;
      onPartial?.();
      break;
    }
    out.push(...r.places);
    if (!r.next) break;
    token = r.next;
  }
  return out;
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

/** 店舗ごとにサブドメイン（tokyo.example.com など）を持つサイトがあるので、親子のドメインも同じサイトとみなす */
const sameSite = (a: string, b: string) => !!a && !!b && (a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`));
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
    avgRating: null, avgReviews: null, score: 0, scoreMax: 0, comparedCount: 0, breakdown: [], reason,
    searchedAt: new Date().toISOString(),
  };
}

/**
 * 実測できる項目だけで100点満点を組む。
 * 写真枚数・投稿頻度は Places API では取れないので採点に入れない（取れないものを推測しない）。
 */
function grade(self: RawPlace, competitors: MeoPlace[], compared: boolean): MeoScan["breakdown"] {
  const rating = self.rating ?? 0;
  const reviews = self.userRatingCount ?? 0;
  const med = competitors.length
    ? [...competitors].map((c) => c.reviews).sort((a, b) => a - b)[Math.floor(competitors.length / 2)]
    : 0;

  const rows: MeoScan["breakdown"] = [
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
  ];

  // 競合比は、比較相手が取れたときだけ採点する。
  // 相手がいないのに満点を出すと、比較した店舗より高い点が付いて並べられなくなる。
  if (compared && med > 0) {
    const ratio = Math.min(reviews / med, 1);
    rows.push({
      label: "レビュー数（競合の中央値比）",
      got: Math.round(ratio * 30),
      max: 30,
      note: `${reviews}件。近隣同業の中央値 ${med}件に対して ${Math.round(ratio * 100)}% です。`,
    });
  }

  rows.push(
    {
      label: "営業時間の登録",
      got: self.regularOpeningHours ? 10 : 0, max: 10,
      note: self.regularOpeningHours ? "登録されています。" : "未登録です。マップ上で「営業時間不明」と表示されます。",
    },
    {
      label: "電話番号の登録",
      got: self.nationalPhoneNumber ? 10 : 0, max: 10,
      note: self.nationalPhoneNumber ? "登録されています。" : "未登録です。マップから直接電話できません。",
    }
  );
  return rows;
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
  return out.slice(0, 5);
}

/**
 * 拾えた店舗名から屋号を取り出す。
 * サイトのタイトルは説明句を含むので、そのまま都道府県検索に足すと
 * 別の店ばかり返ってくる（「美容整形・美容外科 東京都」など）。
 * 実際のビジネスプロフィール名の共通部分を使うほうが確実。
 */
function brandOf(names: string[]): string | null {
  const list = names.filter(Boolean);
  if (list.length === 0) return null;
  if (list.length === 1) return list[0].slice(0, 12);
  let n = 0;
  while (n < list[0].length && list.every((x) => x[n] === list[0][n])) n++;
  const prefix = list[0].slice(0, n).replace(/[\s　・|｜-]+$/, "");
  return prefix.length >= 3 ? prefix : null;
}

export async function scanMeo(site: SiteScan | null, url: string | null): Promise<MeoScan> {
  if (!hasPlacesApi()) return empty("Places API が未設定です");
  if (!url) return empty("URLがないため照合できません");

  const deadline = Date.now() + BUDGET_MS;
  const ourHost = host(url) || host(site?.finalUrl);
  const candidates = nameCandidates(site);
  if (candidates.length === 0) return empty("店舗名を特定できませんでした");

  // サイトのドメインが一致したものだけを自社とする。同名の別店舗を掴まないための照合。
  // 多拠点のクライアントがあるので、候補の呼び方をすべて試して一致したものは全部拾う。
  const mine = new Map<string, RawPlace>();
  const keyOf = (p: RawPlace) => p.formattedAddress ?? p.displayName?.text ?? String(mine.size);
  let sawAny = false;
  let apiError: string | null = null;
  let matchedName: string | null = null;
  let partialPages = false;
  const failedQueries: string[] = [];
  const runQuery = async (name: string, query: string): Promise<boolean> => {
    let found: RawPlace[];
    try {
      found = await searchAllPages(query, 3, () => {
        partialPages = true;
      });
    } catch (e) {
      apiError = e instanceof Error ? e.message : "Places API を呼べませんでした";
      return false;
    }
    if (found.length) sawAny = true;
    for (const p of found) {
      if (!sameSite(host(p.websiteUri), ourHost)) continue;
      // 同じ店舗が別クエリで重複しないよう、住所で束ねる
      mine.set(keyOf(p), p);
      matchedName ??= name;
    }
    return true;
  };
  for (const name of candidates) {
    if (mine.size >= MAX_STORES || Date.now() > deadline) break;
    const query = [name, site?.bizAddress ?? ""].filter(Boolean).join(" ");
    if (!(await runQuery(name, query))) failedQueries.push(name);
    // 住所を足した検索は、その住所の店舗に絞られて他の拠点が出てこない。
    // 店名だけの検索も重ねて、同じサイトを登録している他の拠点も拾う
    if (site?.bizAddress && Date.now() < deadline && !(await runQuery(name, name))) failedQueries.push(name);
  }
  // 失敗した検索は少し間をおいて1回だけやり直す（Google側の一時的なエラーで店舗が欠けるのを防ぐ）
  let stillFailed: string[] = [];
  if (failedQueries.length > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2_000));
    for (const name of failedQueries) {
      if (Date.now() > deadline) {
        stillFailed.push(name);
        continue;
      }
      if (!(await runQuery(name, name))) stillFailed.push(name);
    }
  } else {
    stillFailed = failedQueries;
  }

  // 「屋号＋支店名」の形（例：メディカルブロー表参道院）の店舗が見つかったときは、多拠点の可能性が高い。
  // 最初の検索で1店舗しか拾えなかった回があった（同じサイトで8店舗取れる回と混在した）ので、
  // 屋号だけの検索を言い方を変えて取り直し、主要都市の分も引いて取りこぼしを拾う。
  const branchBrand = (() => {
    const names = [...mine.values()].map((p) => p.displayName?.text ?? "");
    for (const c of candidates) {
      if (c.length >= 3 && names.some((n) => n.startsWith(c) && n.length >= c.length + 2)) return c;
    }
    return null;
  })();
  if (branchBrand && mine.size < CHAIN_THRESHOLD && Date.now() < deadline) {
    for (const q of [branchBrand, `${branchBrand} クリニック`, `${branchBrand} 院`, `${branchBrand} 店`]) {
      if (Date.now() > deadline) break;
      if (!(await runQuery(branchBrand, q))) stillFailed.push(q);
    }
    for (const pref of METRO_PREFECTURES) {
      if (mine.size >= CHAIN_THRESHOLD || Date.now() > deadline) break;
      try {
        for (const p of await searchAllPages(`${branchBrand} ${pref}`, 1, () => {
          partialPages = true;
        })) {
          if (sameSite(host(p.websiteUri), ourHost)) mine.set(keyOf(p), p);
        }
      } catch {
        stillFailed.push(`${branchBrand} ${pref}`);
      }
    }
  }

  // 多拠点と分かったら、都道府県ごとに引き直して取りこぼしを拾う。
  // 1店舗のクライアントでここまで呼ぶと呼び出しの無駄なので、件数で切り分ける。
  const brand = branchBrand ?? brandOf([...mine.values()].map((p) => p.displayName?.text ?? "")) ?? matchedName;
  if (brand && mine.size >= CHAIN_THRESHOLD && mine.size < MAX_STORES) {
    for (const pref of PREFECTURES) {
      if (mine.size >= MAX_STORES || Date.now() > deadline) break;
      try {
        for (const p of await searchAllPages(`${brand} ${pref}`, 1, () => {
          partialPages = true;
        })) {
          if (sameSite(host(p.websiteUri), ourHost)) mine.set(keyOf(p), p);
        }
      } catch {
        break; // 途中で落ちても、ここまでに拾えた店舗で返す
      }
    }
  }
  if (mine.size === 0) {
    if (apiError) return empty(apiError);
    return empty(
      sawAny
        ? "Googleビジネスプロフィールは見つかりましたが、登録されているウェブサイトがこのサイトと一致しませんでした。プロフィール側のURLをご確認ください。"
        : "Googleビジネスプロフィールが見つかりませんでした。未登録の可能性があります。"
    );
  }

  // レビュー数の多い順に見る。比較まで回せる数に限りがあるので、
  // 主要店舗から先に埋まるようにしておく
  const selves = [...mine.values()]
    .sort((a, b) => (b.userRatingCount ?? 0) - (a.userRatingCount ?? 0))
    .slice(0, MAX_STORES);
  const stores: MeoStore[] = [];
  let comparedCount = 0;

  for (const one of selves) {
    const canCompare =
      !!one.location && !!one.primaryType && comparedCount < MAX_COMPARE && Date.now() < deadline;
    let nearby: RawPlace[] = [];
    if (canCompare) {
      try {
        nearby = (
          await call("places:searchNearby", {
            includedPrimaryTypes: [one.primaryType],
            languageCode: "ja",
            regionCode: "JP",
            maxResultCount: 20,
            locationRestriction: { circle: { center: one.location, radius: 3000 } },
          })
        ).places;
      } catch {
        // 近隣が取れなくても自社の数値は出せるので、そのまま進む
      }
    }

    const competitors = nearby
      .filter((p) => !sameSite(host(p.websiteUri), ourHost) && p.displayName?.text !== one.displayName?.text)
      .map(toPlace)
      .sort((a, b) => b.reviews - a.reviews)
      .slice(0, 10);
    const compared = competitors.length > 0;
    if (compared) comparedCount++;

    const me = toPlace(one);
    const all = [me, ...competitors];
    const rated = all.filter((p) => p.rating !== null);
    const isMe = (p: MeoPlace) => p.name === me.name && p.reviews === me.reviews;
    const ratingRank =
      compared && one.rating
        ? [...rated].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0)).findIndex(isMe) + 1
        : null;
    const reviewRank = compared ? [...all].sort((a, b) => b.reviews - a.reviews).findIndex(isMe) + 1 : null;
    const breakdown = grade(one, competitors, compared);

    stores.push({
      self: me,
      competitors,
      compared,
      ratingRank: ratingRank && ratingRank > 0 ? ratingRank : null,
      reviewRank: reviewRank && reviewRank > 0 ? reviewRank : null,
      totalShops: compared ? all.length : 0,
      avgRating: compared && rated.length ? Number((rated.reduce((n, p) => n + (p.rating ?? 0), 0) / rated.length).toFixed(1)) : null,
      avgReviews: competitors.length ? Math.round(competitors.reduce((n, p) => n + p.reviews, 0) / competitors.length) : null,
      score: breakdown.reduce((n, b) => n + b.got, 0),
      scoreMax: breakdown.reduce((n, b) => n + b.max, 0),
      breakdown,
    });
  }

  const head = stores[0];
  return {
    stores,
    comparedCount,
    self: head.self,
    competitors: head.competitors,
    ratingRank: head.ratingRank,
    reviewRank: head.reviewRank,
    totalShops: head.totalShops,
    avgRating: head.avgRating,
    avgReviews: head.avgReviews,
    score: head.score,
    scoreMax: head.scoreMax,
    breakdown: head.breakdown,
    reason: null,
    partial:
      stillFailed.length > 0 || partialPages
        ? "Google側のエラーで検索の一部が取得できませんでした。店舗が実際より少なく表示されている可能性があります（再分析で取り直せます）。"
        : branchBrand && mine.size === 1
          ? `「${branchBrand}」の店名で他の店舗を検索しましたが、このサイトのものとして見つかったのは1店舗だけでした。他の店舗のGoogleビジネスプロフィールに、このサイトのURLが登録されていない可能性があります。`
          : null,
    searchedAt: new Date().toISOString(),
  };
}
