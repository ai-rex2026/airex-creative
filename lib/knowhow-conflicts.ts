/**
 * 新しいノウハウ案が、いまのロジック・承認済みの案と矛盾しないかのチェック（2026-11-19）。
 * 比べる相手は「同じ領域で承認済みの案」（AI への指示の文・法令の辞書・コードで実装した案）。
 * AI は1回の呼び出しで、新しい案をまとめて判定する（案ごとには呼ばない）。矛盾が疑われる案は管理者が内容を見て、確認した上で承認する（承認の自動ブロックではない）
 */
export type ConflictRef = { id: string; area: string; form: string; title: string; text: string };
export type NewItem = { key: string; area: string; title: string; text: string };
export type Conflict = { with: string; label: string; why: string };
export type ConflictAsk = (system: string, user: string) => Promise<{ results?: { key?: string; conflicts?: { with?: number; why?: string }[] }[] }>;

/** 1回の判定に出す比較対象の上限（長くなりすぎないように）と、1件の文字数 */
export const MAX_REFS = 80;
export const MAX_NEW = 10;
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);

const SYSTEM = `あなたは広告・集客ツールのルール管理者です。「新しい案」が、「いまのルール」（承認済みの案）と矛盾していないかを判定します。
- 矛盾とは、同じ状況で両方を守れない（一方が「する」、他方が「しない」）、または数値・条件が食い違う場合のことです。
- 同じ趣旨の重複、言い換え、補足、対象が違うだけのものは矛盾ではありません（出さない）。
- 少しでも疑わしいだけのときは出さない。確かに食い違うものだけを挙げる。
- with は「いまのルール」の番号。why は日本語で、どこがどう食い違うかを60字以内で。
出力は JSON のみ：{"results":[{"key":"新しい案のkey","conflicts":[{"with":番号,"why":"…"}]}]}。矛盾の無い案は conflicts を空配列にする。`;

/** 新しい案（最大 MAX_NEW 件）を、同じ領域のいまのルールと照らす。AI が失敗したら null（呼び出し側は「未確認」のまま残す） */
export async function detectConflicts(items: NewItem[], existing: ConflictRef[], ask: ConflictAsk): Promise<Map<string, Conflict[]> | null> {
  const out = new Map<string, Conflict[]>();
  const batch = items.slice(0, MAX_NEW);
  if (batch.length === 0) return out;
  // 比較対象は、新しい案の領域のものだけ（SEO と AIO は記事づくりで共有なので、相互に比べる）
  const SHARED: Record<string, string[]> = { seo: ["seo", "aio"], aio: ["seo", "aio"] };
  const areasOf = (a: string) => SHARED[a] ?? [a];
  const refs = existing.filter((e) => batch.some((b) => areasOf(b.area).includes(e.area))).slice(0, MAX_REFS);
  if (refs.length === 0) {
    for (const b of batch) out.set(b.key, []);
    return out;
  }
  const user = `いまのルール：\n${refs.map((r, i) => `${i}. [${r.area}/${r.form}] ${clip(r.title, 40)}：${clip(r.text, 160)}`).join("\n")}\n\n新しい案：\n${batch
    .map((b) => `key=${b.key} [${b.area}] ${clip(b.title, 40)}：${clip(b.text, 200)}`)
    .join("\n")}`;
  let res;
  try {
    res = await ask(SYSTEM, user);
  } catch {
    return null;
  }
  const byKey = new Map((res.results ?? []).map((r) => [String(r.key ?? ""), r.conflicts ?? []]));
  for (const b of batch) {
    const list: Conflict[] = [];
    const seen = new Set<string>();
    for (const c of byKey.get(b.key) ?? []) {
      const ref = typeof c.with === "number" ? refs[c.with] : undefined;
      const why = String(c.why ?? "").trim();
      // 同じ領域の相手だけ・番号が正しいものだけ・理由があるものだけ
      if (!ref || !why || !areasOf(b.area).includes(ref.area) || seen.has(ref.id)) continue;
      seen.add(ref.id);
      list.push({ with: ref.id, label: clip(ref.title, 60), why: clip(why, 120) });
    }
    out.set(b.key, list);
  }
  return out;
}
