/**
 * MEO運用ワークスペースの純ロジック（AI-REX 本体 features/meo/utils/* の移植）。
 * サーバーでもブラウザでも使うので、外部IO・Node専用APIには触れない。
 */

import type {
  AiSearchCheck,
  MeoAiReplySettings,
  MeoDailyPoint,
  MeoMetric,
  MeoNotificationSettings,
  MeoPhotoOverview,
  MeoProfileDraft,
  MeoStoreSnapshot,
  MeoTodo,
  MeoWorkspaceData,
  ProfileChecklistItem,
} from "./types";

// ── 既定値 ─────────────────────────────────
export const DEFAULT_AI_REPLY_SETTINGS: MeoAiReplySettings = {
  keywords: [],
  tone: "polite",
  styleInstruction: "",
  ngWords: [],
  signature: "",
};

export const DEFAULT_NOTIFICATION_SETTINGS: MeoNotificationSettings = {
  newReview: true,
  editedReview: true,
  monthlyReport: false,
};

export const EMPTY_PROFILE_DRAFT: MeoProfileDraft = {
  description: "",
  paymentMethods: [],
  attributes: {},
  storeName: "",
  phoneNumber: "",
  address: "",
  websiteUrl: "",
};

// ── タブとパス ────────────────────────────────
export type MeoTabKey = "home" | "reviews" | "posts" | "profile" | "photos" | "insights" | "ai-search" | "settings";

/** MEOワークスペースのタブ。並び順は運用頻度が高いものを左に置く */
export const MEO_TABS: { key: MeoTabKey; path: string; label: string }[] = [
  { key: "home", path: "", label: "ホーム" },
  { key: "reviews", path: "/reviews", label: "クチコミ" },
  { key: "posts", path: "/posts", label: "投稿" },
  { key: "profile", path: "/profile", label: "プロフィール" },
  { key: "photos", path: "/photos", label: "写真" },
  { key: "insights", path: "/insights", label: "分析" },
  { key: "ai-search", path: "/ai-search", label: "AI検索" },
  { key: "settings", path: "/settings", label: "設定" },
];

export function meoPath(analysisId: string, subPath = ""): string {
  return `/analysis/${analysisId}/meo${subPath}`;
}

// ── 写真 ──────────────────────────────────
/**
 * 写真の掲載を「揃っている」とみなす枚数。
 * プロフィール完成度のチェックリストと同じ基準を使う（二箇所に数字を置くと食い違う）。
 */
export const PHOTO_TARGET_COUNT = 10;

export function buildPhotoOverview(store: MeoStoreSnapshot | null): MeoPhotoOverview {
  const competitors = (store?.competitors ?? [])
    .map((c) => ({ name: c.name, count: c.photoCount }))
    // 枚数が取れていない競合は比較に使えない。0枚として混ぜると平均も順位も歪む
    .filter((c): c is { name: string; count: number } => c.count != null)
    .sort((a, b) => b.count - a.count);
  return { ownCount: store?.photoCount ?? null, competitors };
}

export function photoBenchmark(overview: MeoPhotoOverview) {
  const { ownCount, competitors } = overview;
  const counts = competitors.map((c) => c.count);
  const competitorAverage =
    counts.length > 0 ? Math.round((counts.reduce((s, n) => s + n, 0) / counts.length) * 10) / 10 : null;
  return {
    shortfall: ownCount == null ? 0 : Math.max(0, PHOTO_TARGET_COUNT - ownCount),
    competitorAverage,
    // 同数は同順位（自分より多い店舗の数 + 1）
    rank: ownCount == null ? null : counts.filter((n) => n > ownCount).length + 1,
    totalStores: ownCount == null ? counts.length : counts.length + 1,
  };
}

// ── プロフィール完成度 ────────────────────────────
/**
 * GBP由来の項目は店舗の実測（Places）から、アプリ内で編集する項目は下書きから判定する。
 */
export function buildProfileChecklist(
  store: MeoStoreSnapshot | null,
  draft: MeoProfileDraft
): ProfileChecklistItem[] {
  const gbpExists = store != null;
  const hasPhotos = (store?.photoCount ?? 0) >= PHOTO_TARGET_COUNT;
  return [
    {
      key: "gbp",
      label: "ビジネスプロフィールの登録",
      description: "Googleビジネスプロフィールを登録し、オーナー確認を完了させます。",
      done: gbpExists,
      weight: 20,
      editableInApp: false,
    },
    {
      key: "category",
      label: "メインカテゴリの設定",
      description: "業種に最も近いカテゴリを選ぶと、マップ検索での表示対象が正しくなります。",
      done: gbpExists && !!store?.category,
      weight: 10,
      editableInApp: true,
    },
    {
      key: "description",
      label: "ビジネスの説明",
      description: "店舗の強み・来店メリットを750文字以内で記載します。",
      done: draft.description.trim() !== "",
      weight: 15,
      editableInApp: true,
    },
    {
      key: "photos",
      label: "写真の掲載（10枚以上）",
      description: "ロゴ・外観・内観・商品の写真を揃えると閲覧数が伸びます。",
      done: hasPhotos,
      weight: 15,
      editableInApp: false,
    },
    {
      key: "hours",
      label: "営業時間・特別営業時間",
      description: "通常の営業時間に加え、祝日や臨時休業を登録します。",
      done: gbpExists && !!store?.hasOpeningHours,
      weight: 10,
      editableInApp: false,
    },
    {
      key: "payment",
      label: "決済方法",
      description: "カード・QR決済などの対応状況を登録します。",
      done: draft.paymentMethods.length > 0,
      weight: 10,
      editableInApp: true,
    },
    {
      key: "attributes",
      label: "設備・属性",
      description: "Wi-Fi・駐車場・子ども連れ可などを設定します。",
      done: Object.values(draft.attributes).some(Boolean),
      weight: 10,
      editableInApp: true,
    },
    {
      key: "nap",
      label: "NAP情報の統一",
      description: "店舗名・住所・電話番号を自社サイトや各種媒体と一致させます。",
      done: draft.storeName.trim() !== "" && draft.address.trim() !== "" && draft.phoneNumber.trim() !== "",
      weight: 10,
      editableInApp: true,
    },
  ];
}

export function calcCompleteness(checklist: ProfileChecklistItem[]): number {
  const total = checklist.reduce((s, i) => s + i.weight, 0);
  if (total === 0) return 0;
  const done = checklist.reduce((s, i) => (i.done ? s + i.weight : s), 0);
  return Math.round((done / total) * 100);
}

/** 未設定の項目を、スコアへの寄与が大きい順に返す */
export function pendingItems(checklist: ProfileChecklistItem[]): ProfileChecklistItem[] {
  return checklist.filter((i) => !i.done).sort((a, b) => b.weight - a.weight);
}

// ── 日次推移 ─────────────────────────────────
/**
 * 直近2つの「値がある」点の差。欠測日（null）を飛ばして比べる。
 */
function deltaOfLatest(points: MeoDailyPoint[], pick: (p: MeoDailyPoint) => number | null) {
  const values: number[] = [];
  for (let i = points.length - 1; i >= 0 && values.length < 2; i--) {
    const v = pick(points[i]);
    if (v != null) values.push(v);
  }
  return values.length === 2 ? values[0] - values[1] : null;
}

export function summarizeDailyTrend(points: MeoDailyPoint[]) {
  return {
    latest: points.at(-1) ?? null,
    meoScoreDelta: deltaOfLatest(points, (p) => p.meoScore),
    averageRatingDelta: deltaOfLatest(points, (p) => p.averageRating),
    // 前日スナップショットが無い日（null）は増加数が不明なので合計に含めない
    newReviewsTotal: points.reduce((t, p) => t + (p.newReviewCount ?? 0), 0),
  };
}

/** 点が1つだと線が引けないため、2点以上を条件にする */
export function hasDailyTrend(points: MeoDailyPoint[]): boolean {
  return points.length >= 2;
}

export function formatDailyAxisDate(date: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(date);
  return m ? `${Number(m[1])}/${Number(m[2])}` : date;
}

// ── 指標 ─────────────────────────────────────
/**
 * パフォーマンス指標の定義（表示順）。月次の集計前でも枠を固定するため常に6件出す。
 * 取れていない指標は value: null（画面では「-」）。0 で埋めない。
 */
export const MEO_METRIC_DEFINITIONS: ReadonlyArray<Pick<MeoMetric, "key" | "label" | "unit" | "higherIsBetter">> = [
  { key: "impressions", label: "表示回数", unit: "回", higherIsBetter: true },
  { key: "calls", label: "電話タップ", unit: "件", higherIsBetter: true },
  { key: "routes", label: "ルート検索", unit: "件", higherIsBetter: true },
  { key: "websiteClicks", label: "サイトクリック", unit: "件", higherIsBetter: true },
  { key: "newReviews", label: "新規クチコミ", unit: "件", higherIsBetter: true },
  { key: "replyRate", label: "返信率", unit: "%", higherIsBetter: true },
];

export function withMetricPlaceholders(metrics: MeoMetric[]): MeoMetric[] {
  const byKey = new Map(metrics.map((m) => [m.key, m]));
  const known = MEO_METRIC_DEFINITIONS.map(
    (def) => byKey.get(def.key) ?? { ...def, value: null, changeRate: null }
  );
  const extras = metrics.filter((m) => !MEO_METRIC_DEFINITIONS.some((d) => d.key === m.key));
  return [...known, ...extras];
}

// ── 店舗 ─────────────────────────────────────
/** 「店舗名 | サイトタイトル」から店舗名だけを取り出す */
export function storeShortName(name: string): string {
  return name.split("|")[0].trim() || name;
}

/** 指標の対象期間（yyyy-mm）を見出し用の文言にする */
export function formatMetricsPeriod(period: string | null): string | null {
  if (!period) return null;
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return `${m[1]}年${month}月`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" });
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── 今日やること ──────────────────────────────
const MINUTES_PER_ITEM: Record<string, number> = { unreplied: 2, needsUpdate: 2, drafts: 3, profile: 1 };
const DEFAULT_MINUTES_PER_ITEM = 2;

/** ホームのリストと起動時のダイアログが同じ並び・件数を出すよう、ここで一度だけ決める */
export function buildMeoTodos(data: MeoWorkspaceData): MeoTodo[] {
  const unreplied = data.reviews.filter((r) => r.status === "unreplied");
  const needsUpdate = data.reviews.filter((r) => r.status === "needsUpdate");
  const drafts = data.posts.filter((p) => p.status === "draft");
  const pending = pendingItems(data.checklist);
  const todos: (MeoTodo | null)[] = [
    unreplied.length > 0
      ? { id: "unreplied", label: "未返信のクチコミ", count: unreplied.length, path: "/reviews?filter=unreplied", actionLabel: "返信する", tone: "urgent" }
      : null,
    needsUpdate.length > 0
      ? { id: "needsUpdate", label: "編集されたクチコミ（再返信）", count: needsUpdate.length, path: "/reviews?filter=needsUpdate", actionLabel: "返信を見直す", tone: "normal" }
      : null,
    drafts.length > 0
      ? { id: "drafts", label: "下書きのままの投稿", count: drafts.length, path: "/posts", actionLabel: "投稿を仕上げる", tone: "normal" }
      : null,
    pending.length > 0
      ? { id: "profile", label: "プロフィールの未設定項目", count: pending.length, path: "/profile", actionLabel: "項目を埋める", tone: "normal" }
      : null,
  ];
  return todos.filter((t): t is MeoTodo => t !== null);
}

/** 0分と出すと「やらなくていい」に読めるため、1件でもあれば最低1分にする */
export function totalTodoMinutes(todos: MeoTodo[]): number {
  const minutes = todos.reduce(
    (t, todo) => t + todo.count * (MINUTES_PER_ITEM[todo.id] ?? DEFAULT_MINUTES_PER_ITEM),
    0
  );
  return todos.length > 0 ? Math.max(1, minutes) : 0;
}

/** ローカルタイムの yyyy-mm-dd（toISOString はUTCに寄るため使わない） */
export function localDateKey(date: Date = new Date()): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function readItem(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeItem(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 保存できない環境では「覚えない」だけにする
  }
}

export function isPromptDismissedToday(analysisId: string, today: string): boolean {
  return readItem(`meo:today-todos-dismissed:${analysisId}`) === today;
}

export function dismissPromptForToday(analysisId: string, today: string): void {
  writeItem(`meo:today-todos-dismissed:${analysisId}`, today);
}

export function readDoneTodoIds(analysisId: string, today: string): string[] {
  const raw = readItem(`meo:today-todos-done:${analysisId}`);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return [];
    const { date, ids } = parsed as { date?: unknown; ids?: unknown };
    if (date !== today || !Array.isArray(ids)) return [];
    return ids.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

export function writeDoneTodoIds(analysisId: string, today: string, ids: string[]): void {
  writeItem(`meo:today-todos-done:${analysisId}`, JSON.stringify({ date: today, ids }));
}

// ── AI検索 ───────────────────────────────────
export function completedChecks(checks: AiSearchCheck[]): AiSearchCheck[] {
  return checks.filter((c) => c.status === "completed");
}

/** 直近n回のうち何回言及されたか。スコアに丸めず「n回中m回」のまま返す */
export function mentionTally(checks: AiSearchCheck[]) {
  const done = completedChecks(checks);
  return { hits: done.filter((c) => c.mentioned).length, total: done.length };
}

export function latestCompletedCheck(checks: AiSearchCheck[]): AiSearchCheck | null {
  return completedChecks(checks)[0] ?? null;
}

/**
 * 実行中とみなす上限時間。サーバーが落ちて pending が残ったままでも、
 * 画面が「確認中」から抜けられなくならないよう一定時間で解除する。
 * サーバー側の実行上限（300秒）より長く取る。
 */
export const PENDING_TIMEOUT_MS = 10 * 60 * 1000;

export function pendingCheck(checks: AiSearchCheck[], now: number = Date.now()): AiSearchCheck | null {
  return (
    checks.find(
      (c) =>
        (c.status === "pending" || c.status === "running") &&
        now - new Date(c.executedAt).getTime() < PENDING_TIMEOUT_MS
    ) ?? null
  );
}

/** 利用者に失敗を伝えるべき実測（最新の1件だけ見る） */
export function failedCheck(checks: AiSearchCheck[], now: number = Date.now()): AiSearchCheck | null {
  const newest = checks[0];
  if (!newest) return null;
  if (newest.status === "failed") return newest;
  if (
    (newest.status === "pending" || newest.status === "running") &&
    now - new Date(newest.executedAt).getTime() >= PENDING_TIMEOUT_MS
  ) {
    return newest;
  }
  return null;
}

/**
 * 実測に使う質問文。**自店舗の名前は入れない**（入れるとAIがその店を拾いやすくなり、
 * 「聞かれたときに挙がるか」の実測にならない）。
 */
export function buildAiSearchPrompt(area: string, category: string): string {
  return `${area.trim()}で${category.trim()}を探しています。\nおすすめを5件、それぞれの理由と情報源つきで教えてください。`;
}

/** 住所から市区町村を取り出す（例: 東京都渋谷区道玄坂1-2-3 → 渋谷区） */
export function guessAreaFromAddress(address: string | null): string {
  if (!address) return "";
  const text = address
    .trim()
    .replace(/^日本[、,\s]*/, "")
    .replace(/^〒?\d{3}-?\d{4}\s*/, "")
    .replace(/^(東京都|北海道|京都府|大阪府|.{2,3}県)/, "");
  const m = /^(.+?[市区町村])/.exec(text);
  return m ? m[1] : "";
}
