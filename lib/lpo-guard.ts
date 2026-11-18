import { checkGuardDict } from "./guardrail";
import { loadLegalRules } from "./knowhow";
import type { LpoGroup, LpoItem } from "./deep";
import type { Industry } from "./types";

/**
 * LP改善の指摘に、法令チェックの辞書を通す（2026-11-18）。
 * 指摘は「サイトをこう直す」という助言なので、消さずに注意（caution）を付けるだけにする。
 * 例：「症例写真を並べる」は助言としては自然だが、医療広告ガイドラインで制限がある表現。
 * 辞書だけで AI は呼ばない（無料）。実測のグループ（セキュリティ等）は対象外。
 */
export const LPO_GUARD_SKIP = new Set(["セキュリティ", "表示速度"]);

export function guardCaution(text: string, industry: Industry): string | undefined {
  const hits = checkGuardDict([text], industry);
  if (!hits.length) return undefined;
  const parts = hits.slice(0, 3).map((h) => `「${h.text}」${h.reason}（${h.law}）`);
  return `${parts.join("／")}。載せるときは表現と根拠を確かめる`;
}

export async function annotateLpoGuard(groups: LpoGroup[], industry: Industry): Promise<LpoGroup[]> {
  await loadLegalRules();
  return groups.map((g) => {
    if (LPO_GUARD_SKIP.has(g.area)) return g;
    return {
      ...g,
      items: (g.items ?? []).map((x): LpoItem | string => {
        if (typeof x === "string") return x;
        const caution = guardCaution(x.text, industry);
        return caution ? { ...x, caution } : x;
      }),
    };
  });
}
