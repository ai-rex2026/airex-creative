/**
 * 利用者が入れた URL（コラム一覧・note・WordPress）を読むときの共通の入口。
 * 社内アドレス・IP 直書き・ポート指定は読まない。リダイレクトは1回ずつ行き先を確かめて追う
 * （行き先が社内アドレスでも素通りしないように）。
 */

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

export function assertPublicUrl(raw: string, opt: { httpsOnly?: boolean } = {}): URL {
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
  } catch {
    throw new Error("URL の形が正しくありません");
  }
  const host = u.hostname.toLowerCase();
  const okProto = opt.httpsOnly ? u.protocol === "https:" : u.protocol === "https:" || u.protocol === "http:";
  if (!okProto) throw new Error(opt.httpsOnly ? "https:// で始まる URL を入れてください" : "http(s):// の URL を入れてください");
  if (
    !host.includes(".") ||
    /^[\d.]+$/.test(host) ||
    host.includes(":") ||
    host.startsWith("[") ||
    /\.(local|internal|lan|localhost)$/.test(host) ||
    host === "localhost" ||
    (u.port && u.port !== "443" && u.port !== "80") ||
    u.username ||
    u.password
  ) {
    throw new Error("この URL は読めません（社内のアドレスや IP 直書きは使えません）");
  }
  return u;
}

export type FetchOpts = {
  method?: string;
  headers?: Record<string, string>;
  body?: BodyInit | null;
  timeoutMs?: number;
  browserUa?: boolean;
  httpsOnly?: boolean;
  /** リダイレクトを追う回数（0 で追わない） */
  maxRedirects?: number;
};

/** 公開 URL に fetch する。リダイレクト先も assertPublicUrl を通す */
export async function publicFetch(url: string, opts: FetchOpts = {}): Promise<Response> {
  let current = assertPublicUrl(url, { httpsOnly: opts.httpsOnly });
  const max = opts.maxRedirects ?? 3;
  for (let hop = 0; ; hop++) {
    const res = await fetch(current.toString(), {
      method: opts.method ?? "GET",
      headers: { "user-agent": opts.browserUa ? BROWSER_UA : "Mozilla/5.0 (compatible; AirexBot/1.0)", "accept-language": "ja,en;q=0.8", ...(opts.headers ?? {}) },
      body: opts.body ?? null,
      redirect: "manual",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      // 認証つき・本文つきの呼び出しは、行き先が変わったら送り直さない（資格情報を別の場所へ送らない）
      if (hop >= max || (opts.method && opts.method !== "GET") || opts.headers?.authorization) {
        throw Object.assign(new Error(`転送されました（${res.status} → ${res.headers.get("location")}）`), { redirectTo: new URL(res.headers.get("location")!, current).toString() });
      }
      current = assertPublicUrl(new URL(res.headers.get("location")!, current).toString(), { httpsOnly: opts.httpsOnly });
      continue;
    }
    return res;
  }
}

export async function fetchHtml(url: string, opt: { browserUa?: boolean; timeoutMs?: number } = {}): Promise<{ html: string; finalUrl: string }> {
  const res = await publicFetch(url, { browserUa: opt.browserUa, timeoutMs: opt.timeoutMs, headers: { accept: "text/html,application/xhtml+xml,*/*" } });
  if (res.status >= 400) throw new Error(`ページを開けませんでした（HTTP ${res.status}）`);
  return { html: (await res.text()).slice(0, 2_000_000), finalUrl: res.url || url };
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

/** HTML から本文のテキストにする */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<\/(p|h[1-6]|li|div|br|tr)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t　]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

/** WordPress の REST の入口とパスをつなぐ（パーマリンク未設定のサイトは ?rest_route=/ 形式になる） */
export function apiUrl(root: string, path: string): string {
  const p = path.replace(/^\//, "");
  if (/[?&]rest_route=/.test(root)) {
    const [route, query] = p.split("?");
    return `${root.replace(/\/?$/, "/")}${route}${query ? `&${query}` : ""}`;
  }
  return `${root.endsWith("/") ? root : `${root}/`}${p}`;
}
