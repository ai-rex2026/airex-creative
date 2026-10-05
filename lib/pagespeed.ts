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
 *
 * 2026-10-04: 以前はこの工程に来た時点で「ほぼ丸ごとの実行時間を使える」前提で
 * OUTER_MS を固定240秒にしていたが、実際にはこの工程の前に同じバースト内で
 * 他の工程を消化していることがあり、その場合「240秒フルで待つ」こと自体が
 * 関数の実行上限（300秒。app/api/cron/worker/route.ts の maxDuration）を
 * 超えてしまい、保存される前に関数ごと強制終了される＝計測がいつまでも
 * 終わらないように見える不具合があった（呼び出し元 lib/analysis.ts の
 * tickStep から、そのバーストに実際残っている時間を渡してもらい、
 * それを超えないようにする）。
 */
const FETCH_MS = 100_000;
const OUTER_MS = 240_000;

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
  /**
   * 効きそうな改善。PSI の表示用テキスト（savingsDisplay）をそのまま使う。
   * 2026-10: Lighthouse 13 の「インサイト」移行で監査IDが入れ替わりつつあり、
   * かつ短縮見込みは「ミリ秒」だけでなく「KiB」等のデータ量でも返ってくるため、
   * 固定IDの許可リストや特定フィールド名（overallSavingsMs 等）に依存せず、
   * 各監査の displayValue 文字列から直接読み取る方式にしている（下の parseSaving 参照）
   */
  opportunities: { title: string; savingsDisplay: string; detail: string }[];
  testedUrl: string | null;
  reason: string | null;
  fetchedAt: string;
  /**
   * 計測できなかった理由が一時的なもの（時間切れ・Google側の瞬断）なら true。
   * true のうちは、後の工程でもう一度測り直す（lib/analysis.ts の speedNeedsRetry）
   */
  retryable?: boolean;
  /** 計測を試みた回数。再試行の上限判定に使う */
  attempts?: number;
};

/** 時間切れなどで測れなかったときに、後の工程で測り直してよいか（最大3回まで） */
export function speedNeedsRetry(s: SpeedScan | null): boolean {
  return !!s && s.score === null && s.retryable === true && (s.attempts ?? 1) < 3;
}

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

/**
 * 改善提案から除く監査ID。
 * - lab[] の指標として別途出している監査（二重表示を避ける）
 * - 「サードパーティ」「DOMサイズ」等、具体的な短縮見込みの数字を持たない診断系
 *   （displayValue が無い/ランク付けできないものは parseSaving() 側でも自然に弾かれるが、
 *   ここで明示しておくことで「監査の説明文だけの項目」を改善案として出さないようにする）
 */
const SKIP_AUDIT_IDS = new Set([
  "largest-contentful-paint",
  "first-contentful-paint",
  "total-blocking-time",
  "cumulative-layout-shift",
  "speed-index",
  "interactive",
  "first-meaningful-paint",
  "max-potential-fid",
  "final-screenshot",
  "screenshot-thumbnails",
  "diagnostics",
  "metrics",
]);

type ParsedSaving = { kind: "time" | "size"; magnitude: number; display: string };

/**
 * PSI の displayValue（日本語ロケール）から、ランク付け用の数値を取り出す。
 * 固定のJSONフィールド名（overallSavingsMs 等）には依存しない —
 * Lighthouse のインサイト移行でフィールド名が変わってもここは影響を受けない。
 * 時間（ミリ秒・秒）とデータ量（KiB・MiB・MB）の二種類だけを扱い、
 * どちらにも当たらない（具体的な数字が無い）項目は null を返して一覧から外す。
 */
function parseSaving(displayValue: string | undefined): ParsedSaving | null {
  if (!displayValue) return null;
  const s = displayValue.replace(/,/g, "");
  // 日本語の単位（ミリ秒・秒）は \b（ASCIIの単語境界）が前後とも非単語文字の間では
  // 発火しないため \b を使わない。英字単位（ms/s/KiB/MB 等）だけ \b で誤マッチを防ぐ
  let m = s.match(/([\d.]+)\s*ミリ秒/);
  if (m) return { kind: "time", magnitude: parseFloat(m[1]), display: displayValue };
  m = s.match(/([\d.]+)\s*ms\b/i);
  if (m) return { kind: "time", magnitude: parseFloat(m[1]), display: displayValue };
  m = s.match(/([\d.]+)\s*秒/);
  if (m) return { kind: "time", magnitude: parseFloat(m[1]) * 1000, display: displayValue };
  m = s.match(/([\d.]+)\s*s\b/i);
  if (m) return { kind: "time", magnitude: parseFloat(m[1]) * 1000, display: displayValue };
  m = s.match(/([\d.]+)\s*(?:MiB|MB)\b/i);
  if (m) return { kind: "size", magnitude: parseFloat(m[1]) * 1024, display: displayValue };
  m = s.match(/([\d.]+)\s*(?:KiB|KB)\b/i);
  if (m) return { kind: "size", magnitude: parseFloat(m[1]), display: displayValue };
  return null;
}

function empty(reason: string, retryable = false): SpeedScan {
  return {
    strategy: "mobile", score: null, field: [], lab: [], opportunities: [],
    testedUrl: null, reason, fetchedAt: new Date().toISOString(), retryable,
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
 *
 * maxWaitMs: 呼び出し元（lib/analysis.ts の tickStep）が、今回のバーストに
 * 実際残っている時間から算出して渡す上限。省略時は従来どおり OUTER_MS（240秒）。
 * 渡された値が OUTER_MS より大きくても OUTER_MS でクリップする（そもそもPSI自体に
 * 240秒以上かける意味が薄いため）
 */
export async function scanSpeed(
  url: string | null,
  maxWaitMs: number = OUTER_MS,
  previousAttempts = 0
): Promise<SpeedScan> {
  const waitMs = Math.max(5_000, Math.min(OUTER_MS, maxWaitMs));
  const result = await Promise.race([
    run(url, waitMs),
    new Promise<SpeedScan>((r) =>
      setTimeout(
        () =>
          r(
            empty(
              "PageSpeed Insights の応答が時間内に返りませんでした。重いページでは測定に時間がかかります。自動で測り直します。",
              true
            )
          ),
        waitMs
      )
    ),
  ]);
  return { ...result, attempts: previousAttempts + 1 };
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
async function callPsi(url: string, key: string | undefined, fetchMs: number = FETCH_MS): Promise<PsiCallResult> {
  const q = new URLSearchParams({ url, strategy: "mobile", category: "performance", locale: "ja" });
  if (key) q.set("key", key);

  let j: PsiResponse;
  try {
    // 計測そのものに時間がかかる。工程を保存できないまま関数ごと切られないよう上限を置く
    const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${q}`, {
      signal: AbortSignal.timeout(fetchMs),
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

async function run(url: string | null, waitMs: number = OUTER_MS): Promise<SpeedScan> {
  if (!url) return empty("URLがないため測定できません");

  const key = process.env.PAGESPEED_API_KEY || process.env.GOOGLE_MAPS_API_KEY;

  // 「Lighthouse returned error: Something went wrong.」やタイムアウトは、
  // Google 側のクロール環境が一時的に詰まっているだけのことが多い。
  // 1回の再試行では直らないサイトもあったため、間隔を空けながら計3回まで試す
  // （OUTER_MS の外側タイムアウトが最終的な歯止めになる）
  //
  // 2026-10-05: 1回の呼び出しの待ち時間を固定100秒にしていたため、外側の待ち時間（waitMs）が
  // それより短いと最初の1回で使い切り、再試行する前に「時間内に返らなかった」で終わっていた。
  // 呼び出しごとに「残り時間」から待ち時間を決め、重いページでも1回目に使える時間を最大にする
  const startedAt = Date.now();
  const left = () => Math.max(5_000, waitMs - (Date.now() - startedAt) - 3_000);
  let result = await callPsi(url, key, Math.min(FETCH_MS * 2, left()));
  let attempt = 1;
  const RETRY_DELAYS_MS = [4_000, 8_000];
  while (!result.ok && result.retryable && attempt <= RETRY_DELAYS_MS.length && left() > 25_000) {
    await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt - 1]));
    result = await callPsi(url, key, Math.min(FETCH_MS * 2, left()));
    attempt += 1;
  }
  if (!result.ok) return empty(result.message, result.retryable);
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

  const opportunities = Object.entries(audits)
    .filter(([id, a]) => !SKIP_AUDIT_IDS.has(id) && !!a?.title)
    .map(([, a]) => {
      // 合格している項目は「改善」ではない。短縮見込みの表示だけ見ると
      // 「サーバーの応答時間は短い」まで改善案として並んでしまう
      const passing = typeof a!.score === "number" && a!.score! >= 0.9;
      if (passing) return null;
      const parsed = parseSaving(a!.displayValue);
      // 具体的な短縮見込みの数字が無い項目（「サードパーティ」「DOMサイズ」等の
      // 診断情報のみの監査）は、ランク付けできないため一覧には出さない
      if (!parsed) return null;
      return {
        title: a!.title!,
        kind: parsed.kind,
        magnitude: parsed.magnitude,
        savingsDisplay: parsed.display,
        detail: (a!.description ?? "").replace(/\s*\[[^\]]*\]\([^)]*\)/g, ""),
      };
    })
    .filter((x): x is { title: string; kind: "time" | "size"; magnitude: number; savingsDisplay: string; detail: string } => !!x)
    // 時間の短縮（表示速度に直結）を先に、データ量の削減を後に。
    // 種類の違う数字（ミリ秒とKiB）を直接比較しても意味がないため、種類内でのみ大きい順
    .sort((a, b) => (a.kind === b.kind ? b.magnitude - a.magnitude : a.kind === "time" ? -1 : 1))
    .slice(0, 12)
    .map(({ title, savingsDisplay, detail }) => ({ title, savingsDisplay, detail }));

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
