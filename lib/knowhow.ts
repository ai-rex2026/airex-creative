import { createAdminClient } from "@/lib/supabase/admin";

/**
 * 承認したノウハウを、実際のルールに反映する（2026-11-18）。反映するのは status=approved のものだけ。
 * 「判断待ちに戻す」「却下」にすると、次の呼び出しから外れる。DB が読めないときは何も足さない（本来の動作のまま）。
 *  - form=note … 領域ごとの AI への指示の末尾に、短い文を足す（knowhowBlock / withKnowhow）
 *  - form=legal_rule … 法令チェックの辞書に足す（loadLegalRules。lib/guardrail.ts が使う）
 */
export type KnowhowArea = "meo" | "seo" | "aio" | "lpo" | "image" | "legal";

/** 1回の呼び出しに足す量の上限（指示が長くなりすぎて、本来の指示が薄まらないように） */
export const MAX_NOTES = 8;
export const MAX_NOTE_CHARS = 1500;
export const MAX_APPLIED_TEXT = 200;

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
    const lines: string[] = [];
    let total = 0;
    for (const r of data ?? []) {
      const t = String(r.applied_text ?? "").trim();
      if (!t || total + t.length > MAX_NOTE_CHARS) continue;
      lines.push(`- ${t}`);
      total += t.length;
    }
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

export type ExtraRule = { pattern: RegExp; reason: string; law: string; suggestion: string; industries?: string[] };

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
    const { data } = await createAdminClient().from("knowhow_items").select("rule").eq("status", "approved").eq("form", "legal_rule").limit(50);
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
