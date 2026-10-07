/**
 * Googleビジネスプロフィールの「更新」に使う純粋ロジック（通信なし）。
 *
 * 更新できる項目は 説明文・営業時間・Webサイト の3つだけ。
 * 店舗名・住所・電話番号・カテゴリは対象にしない（変更すると Google の再確認（ビデオ確認など）が
 * 入って掲載が止まることがあり、アプリから気軽に触らせる項目ではないため）。
 * 項目ごとに別々の PATCH にして、1項目の失敗がほかの項目の反映を止めないようにする。
 */

export const DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] as const;
export type Day = (typeof DAYS)[number];
export const DAY_LABEL: Record<Day, string> = {
  MONDAY: "月",
  TUESDAY: "火",
  WEDNESDAY: "水",
  THURSDAY: "木",
  FRIDAY: "金",
  SATURDAY: "土",
  SUNDAY: "日",
};

/** 1日1つの時間帯だけを扱う（昼休みなど複数の時間帯がある店舗は、アプリでは編集させない） */
export type DayHours = { closed: boolean; open: string; close: string };
export type WeeklyHours = Record<Day, DayHours>;

export type ProfileKey = "description" | "website" | "hours";
export const PROFILE_LABEL: Record<ProfileKey, string> = {
  description: "ビジネスの説明",
  website: "Webサイト",
  hours: "営業時間",
};
export const PROFILE_KEYS: ProfileKey[] = ["description", "website", "hours"];

/** Google 側の現在の値 */
export type GbpProfile = {
  description: string;
  website: string;
  /** 営業時間が未登録なら null */
  hours: WeeklyHours | null;
  /** 複数の時間帯・日またぎ・24時間営業など、アプリの編集画面で表せない営業時間を持つ */
  hoursComplex: boolean;
};

/** 画面から送る、反映したい値（送らなかった項目は触らない） */
export type ProfileInput = { description?: string; website?: string; hours?: WeeklyHours };

type RawTime = { hours?: number; minutes?: number };
export type RawHours = {
  periods?: { openDay?: string; openTime?: RawTime; closeDay?: string; closeTime?: RawTime }[];
};
export type RawProfile = { profile?: { description?: string }; websiteUri?: string; regularHours?: RawHours };

const pad = (n: number) => String(n).padStart(2, "0");
const toTime = (t: RawTime | undefined) => `${pad(t?.hours ?? 0)}:${pad(t?.minutes ?? 0)}`;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function emptyHours(): WeeklyHours {
  return Object.fromEntries(DAYS.map((d) => [d, { closed: true, open: "09:00", close: "18:00" }])) as WeeklyHours;
}

/** Google の regularHours を1日1枠の形に直す。直せないものは complex にして編集させない */
export function parseHours(raw: RawHours | undefined): { hours: WeeklyHours | null; complex: boolean } {
  const periods = raw?.periods ?? [];
  if (!periods.length) return { hours: null, complex: false };
  const hours = emptyHours();
  const seen = new Set<string>();
  let complex = false;
  for (const p of periods) {
    const day = p.openDay as Day | undefined;
    const open = toTime(p.openTime);
    const close = p.closeTime ? toTime(p.closeTime) : "";
    // 同じ日に2枠以上・日またぎ・24:00閉店・時刻の欠けは、アプリの画面で正しく表せない
    if (!day || !DAYS.includes(day) || p.closeDay !== p.openDay || !close || !TIME_RE.test(open) || !TIME_RE.test(close) || close <= open || seen.has(day)) {
      complex = true;
      continue;
    }
    seen.add(day);
    hours[day] = { closed: false, open, close };
  }
  return { hours: complex ? null : hours, complex };
}

export function parseProfile(raw: RawProfile): GbpProfile {
  const h = parseHours(raw.regularHours);
  return { description: raw.profile?.description ?? "", website: raw.websiteUri ?? "", hours: h.hours, hoursComplex: h.complex };
}

/** 画面に見せる営業時間の文面（差分表示にも、比較にも使う） */
export function formatHours(h: WeeklyHours | null): string {
  if (!h) return "未登録";
  return DAYS.map((d) => `${DAY_LABEL[d]} ${h[d].closed ? "休み" : `${h[d].open}–${h[d].close}`}`).join(" / ");
}

export function hoursEqual(a: WeeklyHours | null, b: WeeklyHours | null): boolean {
  if (!a || !b) return a === b;
  return DAYS.every((d) => a[d].closed === b[d].closed && (a[d].closed || (a[d].open === b[d].open && a[d].close === b[d].close)));
}

/** 営業時間の入力を検査する。問題があれば人が直せる文面で投げる */
export function validateHours(h: WeeklyHours): void {
  for (const d of DAYS) {
    const x = h[d];
    if (!x || typeof x.closed !== "boolean") throw new Error("営業時間の入力が不正です");
    if (x.closed) continue;
    if (!TIME_RE.test(x.open) || !TIME_RE.test(x.close)) throw new Error(`${DAY_LABEL[d]}曜日の時刻の形式が正しくありません`);
    if (x.close <= x.open) throw new Error(`${DAY_LABEL[d]}曜日は、閉店時刻を開店時刻より後にしてください（日をまたぐ営業はGoogleの管理画面で設定してください）`);
  }
  // 全日が休みだと営業時間が空になる（登録を消す操作になるので、アプリからはさせない）
  if (DAYS.every((d) => h[d].closed)) throw new Error("営業する曜日を1日以上選んでください");
}

export function normalizeWebsite(s: string): string {
  const v = s.trim();
  if (v.length > 500) throw new Error("WebサイトのURLが長すぎます");
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    throw new Error("WebサイトのURLの形式が正しくありません（https:// から入力してください）");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("WebサイトのURLは http:// または https:// で始めてください");
  return v;
}

export function validateDescription(s: string): string {
  const v = s.trim();
  if (!v) throw new Error("ビジネスの説明が空です");
  if ([...v].length > 750) throw new Error("ビジネスの説明は750文字までです");
  return v;
}

export type ProfileChange = {
  key: ProfileKey;
  label: string;
  /** Google の現在の値（画面表示用の文面） */
  current: string;
  /** 反映する値（画面表示用の文面） */
  next: string;
  changed: boolean;
};

/** 入力のうち、送られた項目だけを検査して現在値と並べる。送られなかった項目は出さない */
export function planChanges(current: GbpProfile, input: ProfileInput): ProfileChange[] {
  const out: ProfileChange[] = [];
  if (input.description !== undefined) {
    const next = validateDescription(input.description);
    out.push({ key: "description", label: PROFILE_LABEL.description, current: current.description, next, changed: next !== current.description.trim() });
  }
  if (input.website !== undefined) {
    const next = normalizeWebsite(input.website);
    out.push({ key: "website", label: PROFILE_LABEL.website, current: current.website, next, changed: next !== current.website });
  }
  if (input.hours !== undefined) {
    if (current.hoursComplex) throw new Error("Google側の営業時間は複数の時間帯などを含むため、アプリからは変更できません。Googleの管理画面で編集してください");
    validateHours(input.hours);
    out.push({ key: "hours", label: PROFILE_LABEL.hours, current: formatHours(current.hours), next: formatHours(input.hours), changed: !hoursEqual(current.hours, input.hours) });
  }
  return out;
}

/** 現在値を、画面で承認した時点と同じ形の文字列にする（承認後に Google 側が変わっていないかの照合用） */
export function snapshotOf(current: GbpProfile, key: ProfileKey): string {
  if (key === "description") return current.description.trim();
  if (key === "website") return current.website;
  return formatHours(current.hours);
}

function toTimeObj(t: string): RawTime {
  const [h, m] = t.split(":").map(Number);
  return { hours: h, minutes: m };
}

/** 1項目ぶんの PATCH（updateMask と本文）。ほかの項目を巻き込まない */
export function buildPatch(key: ProfileKey, input: ProfileInput): { updateMask: string; body: Record<string, unknown> } {
  if (key === "description") return { updateMask: "profile.description", body: { profile: { description: validateDescription(input.description ?? "") } } };
  if (key === "website") return { updateMask: "websiteUri", body: { websiteUri: normalizeWebsite(input.website ?? "") } };
  const h = input.hours;
  if (!h) throw new Error("営業時間が指定されていません");
  validateHours(h);
  const periods = DAYS.filter((d) => !h[d].closed).map((d) => ({
    openDay: d,
    openTime: toTimeObj(h[d].open),
    closeDay: d,
    closeTime: toTimeObj(h[d].close),
  }));
  return { updateMask: "regularHours", body: { regularHours: { periods } } };
}
