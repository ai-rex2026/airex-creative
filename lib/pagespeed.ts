/**
 * 表示速度の実測。PageSpeed Insights API から取る。
 *
 * 速度は「重そう」「軽そう」で書けてしまうが、それは推測でしかない。
 * PSI は実ユーザーの計測値（CrUX）と、その場で走らせた計測値の両方を返すので、
 * 数字と出どころを添えて出せる。
 *
 * CrUX はアクセスの少ないサイトでは返ってこない。その場合は「実ユーザーの
 * データがまだ足りない」と書き、その場の計測値だけを出す（無い数字は作らない）。
 */

/**
 * 計測の待ち時間。
 * 重いページは1分を超えることがある（ib-clinic.jp で40秒では足りなかった）。
 * この工程は最後に置いてあるので、長く待ってもレポート本体には影響しない。
 * 関数の実行上限（300秒）とワーカーの持ち時間（240秒）の内側に収める。
 */
const FETCH_MS = 90_000;
const OUTER_MS = 200_000;

export type SpeedRating = "良好" | "改善が必要" | "不良";

export type SpeedMetric = {
  id: string;
  label: string;
  /** 表示用の値。単位込み */
  value: string;
  rating: SpeedRating | null;
  /** 何を測っているか */
  note: string;
};

export type SpeedScan = {
  strategy: "mobile";
  /** その場の計測スコア。0〜100 */
  score: number | null;
  /** 実ユーザーの計測値。少ないサイトでは空になる */
  field: SpeedMetric[];
  /** その場の計測値 */
  lab: SpeedMetric[];
  /** 効きそうな改善。PSI が算出した短縮見込み付き */
  opportunities: { title: string; savingsMs: number; detail: string }[];
  testedUrl: string | null;
  reason: string | null;
  fetchedAt: string;
};

const FIELD_LABEL: Record<string, { label: string; note: string }> = {
  LARGEST_CONTENTFUL_PAINT_MS: { label: "LCP（主役の表示）", note: "一番大きい要素が表示されるまで。2.5秒以内が良好" },
  INTERACTION_TO_NEXT_PAINT: { label: "INP（操作の反応）", note: "タップしてから画面が反応するまで。200ミリ秒以内が良好" },
  CUMULATIVE_LAYOUT_SHIFT_SCORE: { label: "CLS（表示のズレ）", note: "読み込み中に要素がずれる量。0.1以内が良好" },
  FIRST_CONTENTFUL_PAINT_MS: { label: "FCP（最初の表示）", note: "何かが最初に表示されるまで。1.8秒以内が良好" },
};

const RATING: Record<string, SpeedRating> = {
  FAST: "良好",
  AVERAGE: "改善が必要",
  SLOW: "不良",
};

/** 改善提案として出す監査項目。PSI が短縮見込みを出すものに絞る */
const OPPORTUNITY_IDS = [
  "render-blocking-resources",
  "unused-css-rules",
  "unused-javascript",
  "modern-image-formats",
  "uses-optimized-images",
  "uses-responsive-images",
  "offscreen-images",
  "server-response-time",
  "unminified-css",
  "unminified-javascript",
  "efficient-animated-content",
  "duplicated-javascript",
  "legacy-javascript",
];

function empty(reason: string): SpeedScan {
  return {
    strategy: "mobile", score: null, field: [], lab: [], opportunities: [],
    testedUrl: null, reason, fetchedAt: new Date().toISOString(),
  };
}

const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}秒` : `${Math.round(n)}ミリ秒`);

type PsiMetric = { percentile?: number; category?: string };
type PsiAudit = {
  title?: string;
  displayValue?: string;
  description?: string;
  /** 0〜1。合格している項目も短縮見込みを返すので、これで弾く */
  score?: number | null;
  details?: { overallSavingsMs?: number };
};
type PsiResponse = {
  id?: string;
  loadingExperience?: { metrics?: Record<string, PsiMetric>; overall_category?: string };
  lighthouseResult?: {
    categories?: { performance?: { score?: number } };
    audits?: Record<string, PsiAudit>;
  };
  error?: { message?: string };
};

/**
 * 測定は必ず時間内に終わらせる。
 * PSI は重いサイトだと返らないことがあり、そのまま待つと工程を保存できないまま
 * 関数ごと切られて、同じところを何度もやり直すことになる。
 */
export async function scanSpeed(url: string | null): Promise<SpeedScan> {
  return Promise.race([
    run(url),
    new Promise<SpeedScan>((r) =>
      setTimeout(
        () => r(empty("PageSpeed Insights の応答が時間内に返りませんでした。重いページでは測定に時間がかかります。もう一度お試しください。")),
        OUTER_MS
      )
    ),
  ]);
}

type PsiCallResult =
  | { ok: true; j: PsiResponse }
  | { ok: false; retryable: boolean; message: string };

/**
 * PSI/Lighthouse は「Something went wrong」のような、対象サイト側とは無関係な
 * 一時的なエラーを返すことがある（Googleのクロール環境側の瞬断など）。
 * そのようなエラーだけを再試行対象にする。APIキーやクォータの問題は
 * 何度呼んでも直らないので、再試行しても無駄なだけでなく待ち時間を無駄に伸ばす
 */
async function callPsi(url: string, key: string | undefined): Promise<PsiCallResult> {
  const q = new URLSearchParams({ url, strategy: "mobile", category: "performance", locale: "ja" });
  if (key) q.set("key", key);

  let j: PsiResponse;
  try {
    // 計測そのものに時間がかかる。工程を保存できないまま関数ごと切られないよう上限を置く
    const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${q}`, {
      signal: AbortSignal.timeout(FETCH_MS),
    });
    j = (await res.json()) as PsiResponse;
    if (res.status === 429) {
      // キー無しの呼び出しは共有枠なので、すぐ上限に当たる
      return {
        ok: false,
        retryable: false,
        message: key
          ? "PageSpeed Insights の1日の上限に達しました。時間をおくと測定できます。"
          : "PageSpeed Insights のAPIキーが未設定のため、共有枠で呼び出して上限に当たりました。Google Cloud で PageSpeed Insights API を有効にし、キーを PAGESPEED_API_KEY に設定すると安定して測定できます。",
      };
    }
    const msg = j.error?.message ?? "";
    // 地図用のキーを流用すると、そのキーに PageSpeed Insights API が
    // 許可されていない場合にここへ来る。何をすれば直るかまで書く
    if (/are blocked|API_KEY_SERVICE_BLOCKED|has not been used|is disabled/i.test(msg)) {
      return {
        ok: false,
        retryable: false,
        message: "PageSpeed Insights API がこのAPIキーで許可されていません。Google Cloud で PageSpeed Insights API を有効にし、専用のキーを環境変数 PAGESPEED_API_KEY に設定してください。",
      };
    }
    if (!res.ok) return { ok: false, retryable: true, message: `PageSpeed Insights を呼べませんでした（${msg || res.status}）` };
  } catch (e) {
    // AbortSignal.timeout() が発火すると TimeoutError になる。英語の内部メッセージを
    // そのまま出さず、重いサイトでは起こりうる旨と再試行を促す文にする
    if (e instanceof Error && e.name === "TimeoutError") {
      return { ok: false, retryable: true, message: "表示速度の測定が時間内に終わりませんでした。読み込みが重いサイトでは起こることがあります。もう一度お試しください。" };
    }
    return {
      ok: false,
      retryable: true,
      message: e instanceof Error ? `PageSpeed Insights を呼べませんでした（${e.message}）` : "PageSpeed Insights を呼べませんでした",
    };
  }

  return { ok: true, j };
}

async function run(url: string | null): Promise<SpeedScan> {
  if (!url) return empty("URLがないため測定できません");

  const key = process.env.PAGESPEED_API_KEY || process.env.GOOGLE_MAPS_API_KEY;

  // 「Lighthouse returned error: Something went wrong.」やタイムアウトは、
  // Google 側のクロール環境が一時的に詰まっているだけのことが多い。
  // 1回の再試行では直らないサイトもあったため、間隔を空けながら計3回まで試す
  // （OUTER_MS の外側タイムアウトが最終的な歯止めになる）
  let result = await callPsi(url, key);
  let attempt = 1;
  const RETRY_DELAYS_MS = [4_000, 8_000];
  while (!result.ok && result.retryable && attempt <= RETRY_DELAYS_MS.length) {
    await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt - 1]));
    result = await callPsi(url, key);
    attempt += 1;
  }
  if (!result.ok) return empty(result.message);
  const j = result.j;

  const field: SpeedMetric[] = [];
  for (const [id, m] of Object.entries(j.loadingExperience?.metrics ?? {})) {
    const def = FIELD_LABEL[id];
    if (!def || typeof m.percentile !== "number") continue;
    field.push({
      id,
      label: def.label,
      value: id === "CUMULATIVE_LAYOUT_SHIFT_SCORE" ? (m.percentile / 100).toFixed(2) : ms(m.percentile),
      rating: m.category ? RATING[m.category] ?? null : null,
      note: def.note,
    });
  }

  const audits = j.lighthouseResult?.audits ?? {};
  const lab: SpeedMetric[] = (
    [
      ["largest-contentful-paint", "LCP（主役の表示）", "一番大きい要素が表示されるまで"],
      ["first-contentful-paint", "FCP（最初の表示）", "何かが最初に表示されるまで"],
      ["total-blocking-time", "TBT（操作できない時間）", "読み込み中に操作を受け付けない合計時間"],
      ["cumulative-layout-shift", "CLS（表示のズレ）", "読み込み中に要素がずれる量"],
      ["speed-index", "Speed Index", "画面が埋まっていく速さ"],
    ] as const
  )
    .filter(([id]) => audits[id]?.displayValue)
    .map(([id, label, note]) => ({ id, label, value: audits[id]!.displayValue!, rating: null, note }));

  const opportunities = OPPORTUNITY_IDS.map((id) => {
    const a = audits[id];
    const savings = a?.details?.overallSavingsMs ?? 0;
    // 合格している項目は「改善」ではない。短縮見込みだけ見ると
    // 「サーバーの応答時間は短い」まで改善案として並んでしまう
    const passing = typeof a?.score === "number" && a.score >= 0.9;
    return savings >= 100 && a?.title && !passing
      ? { title: a.title, savingsMs: Math.round(savings), detail: (a.description ?? "").replace(/\s*\[[^\]]*\]\([^)]*\)/g, "") }
      : null;
  })
    .filter((x): x is { title: string; savingsMs: number; detail: string } => !!x)
    .sort((a, b) => b.savingsMs - a.savingsMs)
    .slice(0, 6);

  const score = j.lighthouseResult?.categories?.performance?.score;

  return {
    strategy: "mobile",
    score: typeof score === "number" ? Math.round(score * 100) : null,
    field,
    lab,
    opportunities,
    testedUrl: j.id ?? url,
    reason: field.length === 0 ? "実ユーザーの計測データ（CrUX）はまだ集まっていません。以下はその場で計測した値です。" : null,
    fetchedAt: new Date().toISOString(),
  };
}
