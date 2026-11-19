import { createHash } from "node:crypto";

/**
 * 一次情報（公式ページ）の定期取得の中身（2026-11-18）。DB・ネットワーク・AI には触れない純粋な処理だけを置き、
 * 外部との接続は deps で差し替えられる（検証は deps をスタブにして行う。実際の公式ページや AI は呼ばない）。
 * 流れ：取得 → 前回と同じなら何もしない → 初回は基準だけ保存 → 変わったら「追加された行」だけを AI に渡して案にする
 */
export type SourceArea = "meo" | "seo" | "aio" | "lpo" | "image" | "legal" | "ads";

export type Source = {
  key: string;
  area: SourceArea;
  title: string;
  url: string;
  official: boolean;
  last_hash: string | null;
  last_text: string;
  /** auto＝普通に取り、取れなければブラウザ表示／browser＝いつもブラウザ表示 */
  fetch_mode?: string;
};

export type Draft = { title?: unknown; summary?: unknown; proposal?: unknown; applied_text?: unknown; caveat?: unknown; is_guess?: unknown; kind?: unknown; form?: unknown; impl_note?: unknown };

export type ItemInsert = {
  key: string;
  area: SourceArea;
  kind: "add" | "change";
  title: string;
  summary: string;
  proposal: string;
  applied_text: string;
  target: string;
  sources: { title: string; url: string }[];
  evidence: "official" | "vendor";
  caveat: string;
  is_guess: boolean;
  risk: "normal" | "legal";
  form: "note" | "code";
  /** form=code のときだけ。何をどう実装するか */
  impl_note?: string;
  fetched_on: string;
};

/**
 * 案の実装の形。コードで確実に守るべきもの（判定・数値の上限・必須の表示・文言のチェックなど。AI への指示では守られないもの）は code。
 * code の案は AI の指示に足さない（applied_text は空）。実装の要点は impl_note に入れ、承認すると「実装待ち」に入る
 */
export function formFields(d: Draft, applied: string): { form: "note" | "code"; applied_text: string; impl_note?: string } {
  if (d.form === "code") return { form: "code", applied_text: "", impl_note: str(d.impl_note, 1000) || str(d.proposal, 300) };
  return { form: "note", applied_text: applied };
}

export type SourceUpdate = {
  last_hash: string;
  last_text: string;
  last_checked_at: string;
  last_changed_at?: string;
  last_error: string;
  fail_count: number;
};

export type CheckDeps = {
  /** ページの本文（テキスト）を返す。取れなければ throw */
  fetchText: (url: string, mode?: string) => Promise<string>;
  /** 追加された行から、更新案の下書きを作る（AI）。呼ぶのは「変わったとき」だけ */
  draft: (source: Source, added: string) => Promise<Draft[]>;
  /** 反映される文に断定語などが無いか（true = 問題なし） */
  guardOk: (text: string) => boolean;
  now: () => Date;
};

export const TEXT_CAP = 60_000;
export const ADDED_CAP = 6_000;
/** 追加行がこれを超えたら、内容の変更ではなくページの作り替えとみなし、案は作らず確認を促す */
export const LAYOUT_CHANGE_LINES = 300;
export const MAX_ITEMS_PER_SOURCE = 3;

export function hashText(t: string): string {
  return createHash("sha256").update(t).digest("hex");
}

export function normalizeText(t: string): string {
  return t.replace(/\r/g, "").replace(/[ \t　]+/g, " ").replace(/\n{2,}/g, "\n").trim().slice(0, TEXT_CAP);
}

const lines = (t: string) => t.split("\n").map((l) => l.trim()).filter((l) => l.length >= 8);

/** 前回に無かった行（出てきた順）。ページの先頭に新しい項目が足される形の更新履歴で、新しい項目だけが取り出せる */
export function addedLines(before: string, after: string): string[] {
  const seen = new Set(lines(before));
  return lines(after).filter((l) => !seen.has(l));
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * 反映する文（AI への指示に足す短い文）を決める。AI の文が空・断定語を含むときは、案の「運用への取り入れ方」（proposal）を使う（管理者が一から書かなくて済むように）。
 * 候補は 200 字以内に収め（長ければ文の区切りで切る）、辞書チェックを通ったものだけ。どれも通らなければ空（管理者が書く）
 */
export function pickApplied(d: Draft, proposal: string, guardOk: (t: string) => boolean): string {
  const fit = (t: string) => {
    const x = t.trim();
    if (x.length <= 200) return x;
    const cut = x.slice(0, 200);
    const i = cut.lastIndexOf("。");
    return i >= 40 ? cut.slice(0, i + 1) : "";
  };
  for (const c of [str(d.applied_text, 400), proposal]) {
    const t = fit(c);
    if (t && guardOk(t)) return t;
  }
  return "";
}

export function toItems(source: Source, drafts: Draft[], deps: Pick<CheckDeps, "guardOk" | "now">): ItemInsert[] {
  const day = deps.now().toISOString().slice(0, 10);
  const stamp = day.replace(/-/g, "");
  const out: ItemInsert[] = [];
  for (const d of drafts.slice(0, MAX_ITEMS_PER_SOURCE)) {
    const title = str(d.title, 80);
    const proposal = str(d.proposal, 300);
    if (!title || !proposal) continue;
    const applied = pickApplied(d, proposal, deps.guardOk); // 断定語を含む文は使わない（proposal で補い、それも通らなければ空）
    out.push({
      key: `src-${source.key}-${stamp}-${out.length + 1}`,
      area: source.area,
      kind: d.kind === "change" ? "change" : "add",
      title,
      summary: str(d.summary, 300),
      proposal,
      ...formFields(d, applied),
      target: "",
      sources: [{ title: source.title, url: source.url }],
      evidence: source.official ? "official" : "vendor",
      caveat: str(d.caveat, 300) || "公式ページの更新から自動で作成した案。原文を確認してから承認すること。",
      is_guess: d.is_guess === true,
      risk: source.area === "legal" ? "legal" : "normal",
      fetched_on: day,
    });
  }
  return out;
}

export type CheckResult = {
  update: SourceUpdate;
  items: ItemInsert[];
  outcome: "baseline" | "unchanged" | "changed" | "layout" | "error";
};

/** 1つの公式ページを確認する。例外は投げず、失敗は outcome=error と fail_count で返す */
export async function checkSource(source: Source, deps: CheckDeps, prevFailCount = 0): Promise<CheckResult> {
  const nowIso = deps.now().toISOString();
  let text: string;
  try {
    text = normalizeText(await deps.fetchText(source.url, source.fetch_mode));
    if (text.length < 200) throw new Error("本文がほとんど取れませんでした");
  } catch (e) {
    return {
      outcome: "error",
      items: [],
      update: {
        last_hash: source.last_hash ?? "",
        last_text: source.last_text,
        last_checked_at: nowIso,
        last_error: (e instanceof Error ? e.message : String(e)).slice(0, 300),
        fail_count: prevFailCount + 1,
      },
    };
  }
  const hash = hashText(text);
  const base = { last_hash: hash, last_text: text, last_checked_at: nowIso, last_error: "", fail_count: 0 };
  if (!source.last_hash) return { outcome: "baseline", items: [], update: { ...base, last_changed_at: nowIso } };
  if (hash === source.last_hash) return { outcome: "unchanged", items: [], update: { ...base, last_text: source.last_text } };

  const added = addedLines(source.last_text, text);
  if (added.length === 0) return { outcome: "unchanged", items: [], update: base }; // 行の削除だけ。案は作らない
  if (added.length > LAYOUT_CHANGE_LINES) {
    return {
      outcome: "layout",
      items: [],
      update: { ...base, last_changed_at: nowIso, last_error: "ページの構成が大きく変わったため、案は作っていません。ページを確認してください" },
    };
  }
  let drafts: Draft[];
  try {
    drafts = await deps.draft(source, added.join("\n").slice(0, ADDED_CAP));
  } catch (e) {
    // AI が失敗したら、ハッシュを更新しない（次回また同じ差分から案を作り直せる）
    return {
      outcome: "error",
      items: [],
      update: {
        last_hash: source.last_hash,
        last_text: source.last_text,
        last_checked_at: nowIso,
        last_error: `案の作成に失敗：${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`,
        fail_count: prevFailCount + 1,
      },
    };
  }
  return { outcome: "changed", items: toItems(source, drafts, deps), update: { ...base, last_changed_at: nowIso } };
}

// ── 過去分を含めた全取り込み（2026-11-19）────────────────────────────
// 定期取得は「前回との差分」だけを案にする。初回に保存した全文（基準）から、一度だけ案を作るための処理。
// 全文を小分けにして1つずつ AI に通し、1つ済むごとに進み具合（full_cursor）を保存する。やり直しても済んだ分は呼ばない

/** 1回の AI 呼び出しに渡す文字数 */
export const FULL_CHUNK_CHARS = 6_000;
/** 1つの小分けから作る案の上限 */
export const FULL_ITEMS_PER_CHUNK = 2;

/** 行の途中で切らずに、size 文字以内の小分けにする（長い1行はそのまま1つにする） */
export function chunkText(text: string, size = FULL_CHUNK_CHARS): string[] {
  const out: string[] = [];
  let cur = "";
  for (const line of text.split("\n")) {
    if (cur && cur.length + line.length + 1 > size) {
      out.push(cur);
      cur = "";
    }
    cur += (cur ? "\n" : "") + line;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

export type FullDeps = {
  /** 全文の小分け（i 番目／全 n 個）から、更新案の下書きを作る（AI） */
  draftFull: (source: Source, chunk: string, i: number, n: number) => Promise<Draft[]>;
  guardOk: (text: string) => boolean;
  now: () => Date;
};

/** 全取り込みの案。key は見出しから決める（同じ案を再実行で重複して作らない） */
export function toFullItems(source: Source, drafts: Draft[], deps: Pick<FullDeps, "guardOk" | "now">): ItemInsert[] {
  const day = deps.now().toISOString().slice(0, 10);
  const out: ItemInsert[] = [];
  for (const d of drafts.slice(0, FULL_ITEMS_PER_CHUNK)) {
    const title = str(d.title, 80);
    const proposal = str(d.proposal, 300);
    if (!title || !proposal) continue;
    const applied = pickApplied(d, proposal, deps.guardOk);
    out.push({
      key: `full-${source.key}-${hashText(title).slice(0, 10)}`,
      area: source.area,
      kind: d.kind === "change" ? "change" : "add",
      title,
      summary: str(d.summary, 300),
      proposal,
      ...formFields(d, applied),
      target: "",
      sources: [{ title: source.title, url: source.url }],
      evidence: source.official ? "official" : "vendor",
      caveat: str(d.caveat, 300) || "公式ページの全文から自動で作成した案。原文を確認してから承認すること。",
      is_guess: d.is_guess === true,
      risk: source.area === "legal" ? "legal" : "normal",
      fetched_on: day,
    });
  }
  return out;
}

export type IngestStep = { items: ItemInsert[]; nextCursor: number; done: boolean; total: number; error?: string };

/** 小分けを1つだけ処理する。例外は投げず、失敗は error で返す（nextCursor は進めない） */
export async function ingestStep(source: Source, text: string, cursor: number, deps: FullDeps): Promise<IngestStep> {
  const chunks = chunkText(text);
  const total = chunks.length;
  if (cursor >= total) return { items: [], nextCursor: total, done: true, total };
  try {
    const drafts = await deps.draftFull(source, chunks[cursor], cursor + 1, total);
    const items = toFullItems(source, drafts, deps);
    return { items, nextCursor: cursor + 1, done: cursor + 1 >= total, total };
  } catch (e) {
    return { items: [], nextCursor: cursor, done: false, total, error: `案の作成に失敗：${(e instanceof Error ? e.message : String(e)).slice(0, 200)}` };
  }
}
