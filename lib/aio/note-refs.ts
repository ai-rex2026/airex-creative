import type { SupabaseClient } from "@supabase/supabase-js";
import { defaultComparisonDeps, claudeSearch } from "./comparison";
import { decodeEntities, fetchHtml, htmlToText, publicFetch } from "./net";
import { geminiGenerate, hasGemini } from "../gemini";
import { normalizeJapanese } from "../meo-ops/japanese";
import type { AioProject } from "./types";

/**
 * note 記事の「参考にする人気記事」（2026-10-27）。週1回、対象ごとに：
 * 1. 調べるテーマを決める（事業内容・対策キーワード・これまでの note 記事から。AI 1回・少量）
 * 2. テーマごとに note.com の記事を Web 検索で探す（note の検索ページ /search と /api は robots.txt で禁止なので使わない）
 * 3. 見つけた記事の公開ページ（/:user/n/:key。robots.txt で許可）を1本ずつ読み、スキ数・見出し・冒頭・文字数を取る
 * 人が貼った URL（source=manual）も同じ読み方で取り込む。記事を書くときは、これを「切り口・見出しの型」の参考として渡す
 * （文章はまねない・事実は持ち込まない）。1件ごとに保存し、読んだ記事は7日間読み直さない。外部は NoteRefDeps で差し替えて検証できる
 */

export type NoteRef = {
  id: string;
  url: string;
  theme: string;
  title: string;
  author: string;
  likes: number | null;
  headings: string[];
  lead: string;
  chars: number | null;
  source: "search" | "manual";
  status: "pending" | "done" | "error";
  error: string | null;
  fetchedAt: string | null;
};

export const NOTE_REF_COLUMNS = "id, url, theme, title, author, likes, headings, lead, chars, source, status, error, fetched_at";
export const REFRESH_DAYS = 7;
const MAX_THEMES = 4;
const PER_THEME = 6;
/** 検索で見つけた記事を対象ごとに残す本数（スキの多い順） */
const MAX_KEEP = 60;

export function rowToNoteRef(r: Record<string, unknown>): NoteRef {
  return {
    id: String(r.id),
    url: String(r.url),
    theme: String(r.theme ?? ""),
    title: String(r.title ?? ""),
    author: String(r.author ?? ""),
    likes: r.likes === null || r.likes === undefined ? null : Number(r.likes),
    headings: Array.isArray(r.headings) ? (r.headings as string[]) : [],
    lead: String(r.lead ?? ""),
    chars: r.chars === null || r.chars === undefined ? null : Number(r.chars),
    source: r.source === "manual" ? "manual" : "search",
    status: r.status === "done" ? "done" : r.status === "error" ? "error" : "pending",
    error: (r.error as string | null) ?? null,
    fetchedAt: (r.fetched_at as string | null) ?? null,
  };
}

/** note の記事の URL か（/:user/n/:key だけ。検索・API・アーカイブなどは robots.txt で禁止されているので読まない） */
export function noteArticleUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.hostname !== "note.com" && u.hostname !== "www.note.com") return null;
    const m = u.pathname.match(/^\/([A-Za-z0-9_-]+)\/n\/(n[0-9a-f]{12})\/?$/);
    return m ? `https://note.com/${m[1]}/n/${m[2]}` : null;
  } catch {
    return null;
  }
}

export function findNoteUrls(text: string): string[] {
  const found = [...text.matchAll(/https?:\/\/(?:www\.)?note\.com\/[A-Za-z0-9_-]+\/n\/n[0-9a-f]{12}/g)].map((m) => noteArticleUrl(m[0])).filter((u): u is string => !!u);
  return [...new Set(found)];
}

/** 記事ページの HTML から、スキ数・タイトル・著者・見出し・冒頭・文字数を取る */
export function parseNotePage(html: string, url: string) {
  const key = url.match(/\/n\/(n[0-9a-f]{12})/)?.[1] ?? "";
  // ページに埋め込まれた記事データ（引用符はエスケープされている）。その記事の key の後ろにある最初の likeCount を使う
  let likes: number | null = null;
  const keyAt = key ? html.search(new RegExp(`key[\\\\"]*\\s*:\\s*[\\\\"]*${key}`)) : -1;
  const tail = keyAt >= 0 ? html.slice(keyAt) : html;
  const lm = tail.match(/likeCount\\*"?\s*:\s*(\d+)/) ?? html.match(/likeCount\\*"?\s*:\s*(\d+)/);
  if (lm) likes = Number(lm[1]);
  const meta = (p: string) => decodeEntities(html.match(new RegExp(`<meta[^>]+property="${p}"[^>]+content="([^"]*)"`))?.[1] ?? "");
  const rawTitle = meta("og:title") || decodeEntities(html.match(/<title>([^<]*)/)?.[1] ?? "");
  const [title, author] = rawTitle.split("｜").map((s) => s.trim());
  const body = html.match(/<div[^>]+(?:data-name="body"|class="[^"]*note-common-styles__textnote-body[^"]*")[^>]*>([\s\S]*?)<\/div>\s*<\/div>/)?.[1] ?? html;
  const headings = [...body.matchAll(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/g)].map((m) => normalizeJapanese(htmlToText(m[1])).slice(0, 60)).filter(Boolean).slice(0, 12);
  const text = htmlToText(body);
  const lead = normalizeJapanese(htmlToText(body.match(/<p[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? "")).slice(0, 200);
  return { title: normalizeJapanese(title ?? "").slice(0, 120), author: normalizeJapanese(author ?? "").slice(0, 60), likes, headings, lead, chars: text.length || null };
}

export type NoteRefDeps = {
  fetchPage: (url: string) => Promise<{ html: string; finalUrl: string }>;
  json: <T>(system: string, user: string) => Promise<T>;
  /** Web 検索（本文と出典の URL）。note の記事 URL を拾う。まず安い Gemini（Google 検索つき）、URL が取れなければ searchFallback */
  search: SearchFn | null;
  /** Claude の Web 検索（出典が実際のページの URL で返る） */
  searchFallback: SearchFn | null;
  /** Gemini の出典（Google の中継 URL）を、転送先の実際の URL にする */
  resolve: (uri: string) => Promise<string | null>;
};
type SearchFn = (system: string, question: string) => Promise<{ text: string; sources: { uri: string; title: string }[] }>;

/** 中継 URL を1回だけ問い合わせ、転送先（Location）を返す。本文は読まない */
async function resolveRedirect(uri: string): Promise<string | null> {
  try {
    const res = await publicFetch(uri, { maxRedirects: 0, timeoutMs: 8_000 });
    return res.headers.get("location");
  } catch (e) {
    return (e as { redirectTo?: string }).redirectTo ?? null;
  }
}

export const defaultNoteRefDeps = (): NoteRefDeps => {
  const c = defaultComparisonDeps();
  return {
    fetchPage: (url) => fetchHtml(url, { browserUa: true, timeoutMs: 12_000 }),
    json: c.json,
    // 費用の安い Gemini（Google 検索。月5,000回まで無料）を先に使い、note の URL が取れなかったテーマだけ Claude の Web 検索
    search: hasGemini()
      ? async (system, question) => {
          const r = await geminiGenerate({ system, parts: [{ text: question }], maxTokens: 2000, search: true, timeoutMs: 90_000 });
          return { text: r.text, sources: (r.grounding?.sources ?? []).map((s) => ({ uri: s.uri, title: s.title })) };
        }
      : null,
    searchFallback: process.env.ANTHROPIC_API_KEY ? claudeSearch : null,
    resolve: resolveRedirect,
  };
};

const THEMES_SYSTEM = `あなたは note の編集者です。事業者が note で書くべきテーマを、見込み客が note で読みそうな話題として決めます。
- 2〜${MAX_THEMES}個。1つは15字以内の検索語（例：「美容室 開業 失敗」「Web広告 内製化」）
- 宣伝ではなく、読者の悩み・体験・ノウハウの話題にする
出力は JSON: {"themes":["…"]}`;

export async function planNoteThemes(project: AioProject, hints: string[], deps: Pick<NoteRefDeps, "json">): Promise<string[]> {
  const r = await deps.json<{ themes?: unknown[] }>(
    THEMES_SYSTEM,
    [`事業者: ${project.name}`, `業種・探され方: ${project.category}`, project.notes ? `事業内容: ${project.notes.slice(0, 800)}` : "", hints.length ? `参考（対策キーワード・最近の記事）: ${hints.slice(0, 20).join(" / ")}` : ""].filter(Boolean).join("\n")
  );
  return [...new Set((r.themes ?? []).map((t) => normalizeJapanese(String(t ?? "").trim()).slice(0, 30)).filter(Boolean))].slice(0, MAX_THEMES);
}

const SEARCH_SYSTEM = `あなたは note の記事を探す調査担当です。Web 検索で、note.com に公開されている記事（URL が https://note.com/ユーザー名/n/… の形）を探します。
- 指定のテーマについて、よく読まれている・スキが多い記事を優先する
- 見つけた記事の URL を1行に1つ、最大${PER_THEME}件書く。URL 以外は書かない`;

export async function searchNoteArticles(theme: string, deps: Pick<NoteRefDeps, "search" | "searchFallback" | "resolve">): Promise<string[]> {
  const q = `テーマ「${theme}」の note 記事を探してください（site:note.com）`;
  const fromResult = async (r: { text: string; sources: { uri: string; title: string }[] }) => {
    const urls = [...findNoteUrls(r.text), ...findNoteUrls(r.sources.map((s) => s.uri).join("\n"))];
    // Gemini の出典は Google の中継 URL。出典のサイトが note のものだけ、転送先を確かめて記事の URL にする
    const relay = r.sources.filter((s) => !noteArticleUrl(s.uri) && /note\.com/i.test(s.title)).slice(0, PER_THEME * 2);
    const resolved = await Promise.allSettled(relay.map((s) => deps.resolve(s.uri)));
    for (const x of resolved) if (x.status === "fulfilled" && x.value) urls.push(...findNoteUrls(x.value));
    return [...new Set(urls)].slice(0, PER_THEME);
  };
  let urls: string[] = [];
  if (deps.search) {
    try {
      urls = await fromResult(await deps.search(SEARCH_SYSTEM, q));
    } catch {
      /* Claude で探す */
    }
  }
  if (!urls.length && deps.searchFallback) urls = await fromResult(await deps.searchFallback(SEARCH_SYSTEM, q));
  return urls;
}

/** 1件を読んで保存する（pending → done / error） */
export async function fetchNoteRef(sb: SupabaseClient, id: string, url: string, deps: Pick<NoteRefDeps, "fetchPage">) {
  try {
    const page = await deps.fetchPage(url);
    const p = parseNotePage(page.html, url);
    await sb.from("aio_note_refs").update({ ...p, status: "done", error: null, fetched_at: new Date().toISOString() }).eq("id", id);
  } catch (e) {
    await sb.from("aio_note_refs").update({ status: "error", error: (e instanceof Error ? e.message : "読めませんでした").slice(0, 200), fetched_at: new Date().toISOString() }).eq("id", id);
  }
}

/**
 * 週1回の調査。テーマ決め・検索は前回から REFRESH_DAYS 日たったとき（force なら今すぐ）。読むのは pending の記事だけ。
 * 締め切りを過ぎたら途中でやめ、続きは次の回（検索済みの URL は pending で残るので、検索はやり直さない）
 */
export async function refreshNoteRefs(
  sb: SupabaseClient,
  project: AioProject,
  opt: { force?: boolean; deadline: number },
  deps: NoteRefDeps = defaultNoteRefDeps()
): Promise<{ searched: boolean; themes: string[]; added: number; read: number; notes: string[] }> {
  const notes: string[] = [];
  const { data: ch } = await sb.from("aio_channels").select("id, note_refs_at").eq("project_id", project.id).eq("kind", "note").maybeSingle();
  const last = ch?.note_refs_at ? new Date(String(ch.note_refs_at)).getTime() : 0;
  const due = opt.force || Date.now() - last > REFRESH_DAYS * 864e5;
  let themes: string[] = [];
  let added = 0;
  if (due) {
    const [{ data: kws }, { data: arts }] = await Promise.all([
      sb.from("seo_keywords").select("keyword").eq("project_id", project.id).limit(20),
      sb.from("aio_articles").select("title").eq("project_id", project.id).eq("channel", "note").order("created_at", { ascending: false }).limit(10),
    ]);
    const hints = [...((kws ?? []) as { keyword: string }[]).map((k) => k.keyword), ...((arts ?? []) as { title: string }[]).map((a) => a.title)];
    themes = await planNoteThemes(project, hints, deps);
    for (const theme of themes) {
      if (Date.now() > opt.deadline - 60_000) break;
      try {
        const urls = await searchNoteArticles(theme, deps);
        if (!urls.length) notes.push(`「${theme}」で note の記事が見つかりませんでした`);
        // テーマごとにその場で保存する（同じ URL は重ねない）
        for (const url of urls) {
          const { error } = await sb.from("aio_note_refs").insert({ project_id: project.id, url, theme, source: "search", status: "pending" });
          if (!error) added++;
        }
      } catch (e) {
        notes.push(`「${theme}」の検索に失敗しました（${e instanceof Error ? e.message.slice(0, 80) : "不明"}）`);
      }
    }
    if (ch?.id) await sb.from("aio_channels").update({ note_refs_at: new Date().toISOString() }).eq("id", ch.id);
  }
  // 読むのは、まだ読んでいない記事と、7日以上前に読んだ記事（スキ数が変わるため）
  const stale = new Date(Date.now() - REFRESH_DAYS * 864e5).toISOString();
  const { data: todo } = await sb
    .from("aio_note_refs")
    .select("id, url")
    .eq("project_id", project.id)
    .or(`status.eq.pending,fetched_at.lt.${stale}`)
    .limit(30);
  let read = 0;
  for (const r of (todo ?? []) as { id: string; url: string }[]) {
    if (Date.now() > opt.deadline - 20_000) break;
    await fetchNoteRef(sb, r.id, r.url, deps);
    read++;
  }
  // 溜まりすぎないよう、検索で見つけた記事はスキの多い順に MAX_KEEP 本だけ残す（人が貼った記事は消さない）
  if (due) {
    const { data: all } = await sb.from("aio_note_refs").select("id, likes").eq("project_id", project.id).eq("source", "search").order("likes", { ascending: false, nullsFirst: false }).limit(500);
    const drop = ((all ?? []) as { id: string }[]).slice(MAX_KEEP).map((r) => r.id);
    if (drop.length) await sb.from("aio_note_refs").delete().in("id", drop);
  }
  return { searched: due, themes, added, read, notes };
}

/** 記事を書くときに渡す参考（人が貼ったもの → スキの多い順。最大6件） */
export function noteRefsForDraft(refs: NoteRef[]): string {
  const use = refs
    .filter((r) => r.status === "done" && r.title)
    .sort((a, b) => Number(b.source === "manual") - Number(a.source === "manual") || (b.likes ?? -1) - (a.likes ?? -1))
    .slice(0, 6);
  if (!use.length) return "";
  return use
    .map((r, i) => `${i + 1}. 「${r.title}」${r.likes !== null ? `（スキ ${r.likes}）` : ""}${r.theme ? ` テーマ: ${r.theme}` : ""}${r.source === "manual" ? "【運用者が選んだ記事】" : ""}\n   見出し: ${r.headings.slice(0, 8).join(" / ") || "（なし）"}\n   冒頭: ${r.lead.slice(0, 120)}`)
    .join("\n");
}
