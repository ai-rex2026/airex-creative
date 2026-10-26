import { extractPage, normalizeUrl } from "./text";

/**
 * 記事の URL を集めて、1ページずつ読む（サーバー専用の読み取りを差し替えられる形にしてある）。
 * 集め方：robots.txt の Sitemap → /sitemap.xml・/wp-sitemap.xml → 無ければトップのリンク
 */
export type LinkCollectDeps = {
  text: (url: string) => Promise<string | null>;
  html: (url: string) => Promise<{ html: string; finalUrl: string }>;
};

/** 読む記事の上限（多すぎると候補が爆発し、AI の費用も増える） */
export const MAX_PAGES = 80;

const SKIP_PATH = /\/(tag|tags|category|categories|author|authors|page|feed|wp-json|wp-admin|wp-content|search|cart|checkout|login|contact|privacy|terms)(\/|$)|\.(jpg|jpeg|png|gif|webp|svg|pdf|zip|xml|css|js)$/i;

export function isArticleUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return !SKIP_PATH.test(u.pathname) && u.pathname !== "/" && u.search === "";
  } catch {
    return false;
  }
}

function locs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\s\]]+)\s*(?:\]\]>)?\s*<\/loc>/gi)].map((m) => m[1]);
}

/** サイトマップ（入れ子も1段だけたどる）から、同じサイトの記事らしい URL を集める */
export async function discoverUrls(siteUrl: string, deps: Pick<LinkCollectDeps, "text" | "html">): Promise<{ urls: string[]; notes: string[] }> {
  const notes: string[] = [];
  const origin = new URL(siteUrl).origin;
  const host = normalizeUrl(siteUrl)!.replace(/^https:\/\//, "").split("/")[0];
  const sameSite = (u: string) => normalizeUrl(u)?.replace(/^https:\/\//, "").split("/")[0] === host;

  const maps: string[] = [];
  const robots = await deps.text(`${origin}/robots.txt`).catch(() => null);
  if (robots) for (const m of robots.matchAll(/^\s*sitemap:\s*(\S+)/gim)) maps.push(m[1]);
  if (maps.length === 0) maps.push(`${origin}/sitemap.xml`, `${origin}/wp-sitemap.xml`);

  const found = new Set<string>();
  const seen = new Set<string>();
  const queue = [...new Set(maps)].slice(0, 6);
  let fetched = 0;
  while (queue.length && fetched < 12) {
    const m = queue.shift()!;
    if (seen.has(m)) continue;
    seen.add(m);
    fetched++;
    const xml = await deps.text(m).catch(() => null);
    if (!xml) continue;
    for (const loc of locs(xml)) {
      if (/\.xml(\?|$)/i.test(loc) || /sitemap/i.test(loc)) {
        // 投稿以外（固定ページ・カテゴリ・タグ・ユーザー）のサイトマップは読まない
        if (!/(tax|categor|tag|author|user|page)/i.test(loc)) queue.push(loc);
      } else if (sameSite(loc)) {
        const n = normalizeUrl(loc);
        if (n && isArticleUrl(n)) found.add(n);
      }
    }
  }
  if (found.size === 0) {
    // サイトマップが無い／読めない：トップページのリンクから拾う
    notes.push("サイトマップを読めなかったので、トップページのリンクから記事を集めました（取りこぼしがあります）");
    try {
      const top = await deps.html(siteUrl);
      for (const m of top.html.matchAll(/<a\s[^>]*href=["']([^"'#][^"']*)["']/gi)) {
        const n = normalizeUrl(m[1].replace(/&amp;/g, "&"), top.finalUrl);
        if (n && sameSite(n) && isArticleUrl(n)) found.add(n);
      }
    } catch (e) {
      notes.push(`トップページを読めませんでした（${e instanceof Error ? e.message.slice(0, 80) : "不明"}）`);
    }
  }
  const urls = [...found];
  if (urls.length > MAX_PAGES) notes.push(`記事が${urls.length}件見つかりました。先頭の${MAX_PAGES}件だけを対象にします`);
  return { urls: urls.slice(0, MAX_PAGES), notes };
}

export async function readPage(url: string, deps: Pick<LinkCollectDeps, "html">) {
  const { html, finalUrl } = await deps.html(url);
  return extractPage(html, finalUrl || url);
}
