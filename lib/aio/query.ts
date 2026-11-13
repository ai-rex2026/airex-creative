import { normalizeJapanese } from "../meo-ops/japanese";

/** Google 検索の「AI による概要」を測るときの検索語を整える（全角30字前後・空白1つ区切り） */
export const cleanQuery = (q: unknown) => normalizeJapanese(String(q ?? "")).replace(/\s+/g, " ").trim().slice(0, 40);
