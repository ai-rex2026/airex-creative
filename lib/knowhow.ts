import { createAdminClient } from "@/lib/supabase/admin";
import { GUARD_SCOPES, type GuardScope } from "@/lib/types";

/**
 * 承認したノウハウを、実際のルールに反映する（2026-11-18）。反映するのは status=approved のものだけ。
 * 「判断待ちに戻す」「却下」にすると、次の呼び出しから外れる。DB が読めないときは何も足さない（本来の動作のまま）。
 *  - form=note … 領域ごとの AI への指示の末尾に、短い文を足す（knowhowBlock / withKnowhow）
 *  - form=legal_rule … 法令チェックの辞書に足す（loadLegalRules。lib/guardrail.ts が使う）
 */
/** ads は広告運用（画面ができたら、承認した案の反映先をつなぐ。いまは案を溜めるだけ） */
export type KnowhowArea = "meo" | "seo" | "aio" | "lpo" | "image" | "legal" | "ads";

/** 1回の呼び出しに足す量の上限（指示が長くなりすぎて、本来の指示が薄まらないように） */
// 2026-11-19：20件・1500字 → 40件・3500字（ノウハウが増える前提。足す量は画面 /admin/knowhow の「枠の使用状況」で見る）
export const MAX_NOTES = 40;
export const MAX_NOTE_CHARS = 3500;
export const MAX_APPLIED_TEXT = 200;
/** 辞書は AI の指示に入らず、コードが照合するだけなので件数の制約は小さい。暴走を防ぐ安全弁として大きめに置く（2026-11-19：50 → 500） */
export const MAX_LEGAL_RULES = 500;

/**
 * 承認済みの文（承認が古い順）から、実際に AI の指示へ入るものを選ぶ。上限（件数・文字数）に入らない文は飛ばす。
 * knowhowBlock と管理画面の「枠の使用状況」が同じ判定を使う（画面の表示と実際の反映をずらさないため）
 */
export function pickNotes<T extends { applied_text?: unknown }>(rows: T[]): { used: { row: T; text: string }[]; skipped: T[]; chars: number } {
  const used: { row: T; text: string }[] = [];
  const skipped: T[] = [];
  let chars = 0;
  for (const row of rows.slice(0, MAX_NOTES)) {
    const text = String(row.applied_text ?? "").trim();
    if (!text) continue;
    if (chars + text.length > MAX_NOTE_CHARS) {
      skipped.push(row);
      continue;
    }
    used.push({ row, text });
    chars += text.length;
  }
  // 件数の上限を超えた分も「入っていない」に数える
  skipped.push(...rows.slice(MAX_NOTES));
  return { used, skipped, chars };
}

export async function knowhowBlock(areas: KnowhowArea[]): Promise<string> {
  try {
    const { data } = await createAdminClient()
      .from("knowhow_items")
      .select("applied_text")
      .eq("status", "approved")
      .eq("form", "note")
      .neq("kind", "nochange")
      .neq("applied_text", "")
      .in("area", areas)
      .order("decided_at", { ascending: true })
      .limit(MAX_NOTES);
    const lines = pickNotes(data ?? []).used.map((u) => `- ${u.text}`);
    if (lines.length === 0) return "";
    return `\n\n【運営が確認した最新のノウハウ（参考にする。効果や順位を断定する根拠には使わない）】\n${lines.join("\n")}`;
  } catch {
    return "";
  }
}

/** askJson 系の関数に「承認済みノウハウを system の末尾へ足す」処理を被せる。引数と戻り値の型はそのまま */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withKnowhow<F extends (system: string, ...rest: any[]) => Promise<any>>(fn: F, areas: KnowhowArea[]): F {
  return (async (system: string, ...rest: unknown[]) => fn(system + (await knowhowBlock(areas)), ...rest)) as unknown as F;
}

export type ExtraRule = { pattern: RegExp; reason: string; law: string; suggestion: string; industries?: string[]; scopes?: GuardScope[] };

/** 管理者が承認した rule（JSON）を検査用の規則にする。壊れた正規表現・長すぎるものは捨てる */
export function toRule(raw: unknown): ExtraRule | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const pattern = typeof r.pattern === "string" ? r.pattern : "";
  if (!pattern || pattern.length > 300) return null;
  const reason = typeof r.reason === "string" ? r.reason : "";
  const law = typeof r.law === "string" ? r.law : "";
  if (!reason || !law) return null;
  try {
    return {
      pattern: new RegExp(pattern, "g"),
      reason,
      law,
      suggestion: typeof r.suggestion === "string" ? r.suggestion : "",
      industries: Array.isArray(r.industries) ? r.industries.filter((x): x is string => typeof x === "string") : undefined,
      scopes: Array.isArray(r.scopes) ? r.scopes.filter((x): x is GuardScope => (GUARD_SCOPES as readonly string[]).includes(x as string)) : undefined,
    };
  } catch {
    return null;
  }
}

let legalCache: { at: number; rules: ExtraRule[] } | null = null;
const LEGAL_TTL_MS = 60_000;

/** 承認済みの法令ルール。60秒だけ使い回す（取り消しは1分以内に効く）。読めないときは空 */
export async function loadLegalRules(): Promise<ExtraRule[]> {
  if (legalCache && Date.now() - legalCache.at < LEGAL_TTL_MS) return legalCache.rules;
  try {
    const { data } = await createAdminClient().from("knowhow_items").select("rule").eq("status", "approved").eq("form", "legal_rule").limit(MAX_LEGAL_RULES);
    const rules = (data ?? []).map((r) => toRule(r.rule)).filter((x): x is ExtraRule => !!x);
    legalCache = { at: Date.now(), rules };
    return rules;
  } catch {
    legalCache = { at: Date.now(), rules: legalCache?.rules ?? [] };
    return legalCache.rules;
  }
}

/** 同期で使う側（checkGuardDict）用。読み込み済みのものを返し、古ければ裏で読み直す */
export function cachedLegalRules(): ExtraRule[] {
  if (!legalCache || Date.now() - legalCache.at >= LEGAL_TTL_MS) void loadLegalRules();
  return legalCache?.rules ?? [];
}
