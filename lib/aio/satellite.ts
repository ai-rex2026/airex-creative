import type { AioSatellite } from "./content-types";

/**
 * サテライトサイトの記事を公開するときに、コードで必ず入れるもの（AI には書かせない）。
 * - 冒頭の表記：運営者の明記と、運営者の商品・サービスを扱うときの PR 表記（景品表示法のステマ規制への対応）
 * - 運営者の商品・自社サイトへのリンクに rel="sponsored"（Google のリンクに関する方針への対応）
 * - アフィリエイトリンクを入れた商品は、記事内の公式サイトへのリンクをその URL に差し替え、rel="sponsored" と広告の表記を付ける（2026-10-21）
 */

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** 運営者側（自社）のドメイン。自社の商品の公式 URL と、対象（AIO の対象）の URL */
export function ownDomains(sat: AioSatellite, projectUrl: string | null): string[] {
  const list = [...sat.items.filter((i) => i.own).map((i) => hostOf(i.url)), projectUrl ? hostOf(projectUrl) : ""].filter(Boolean);
  return [...new Set(list)];
}

const matchHost = (host: string, domains: string[]) => domains.some((d) => host === d || host.endsWith(`.${d}`));

/** 冒頭に置く表記の文面（画面のプレビューと公開で同じものを使う） */
export function disclosureText(sat: AioSatellite, bodyMd: string, projectUrl: string | null): { pr: boolean; text: string } {
  const own = sat.items.filter((i) => i.own && i.name && bodyMd.includes(i.name)).map((i) => i.name);
  const linksOwn = ownDomains(sat, projectUrl).some((d) => new RegExp(`https?://([a-z0-9-]+\\.)*${d.replace(/\./g, "\\.")}`, "i").test(bodyMd));
  const aff = affiliateLinked(sat, bodyMd).length > 0;
  const operator = sat.operator.trim() || "運営者";
  const media = sat.mediaName.trim() ? `「${sat.mediaName.trim()}」` : "当メディア";
  const base = `本記事は${operator}が運営する${media}が作成しています。`;
  if (own.length || linksOwn || aff) {
    const rel = sat.relation.trim() ? `（${sat.relation.trim()}）` : "";
    const names = own.length ? `記事内の${own.map((n) => `「${n}」`).join("・")}は運営者${rel}の商品・サービスです。` : linksOwn ? "記事内に運営者の商品・サービスへのリンクを含みます。" : "";
    const affText = aff ? "記事内のリンクには広告（アフィリエイトリンク）を含み、リンク先での申し込み等により当メディアが報酬を受け取ることがあります。" : "";
    return { pr: true, text: `PR：${base}${names}${affText}` };
  }
  return { pr: false, text: base };
}

/** URL を比べやすい形に（末尾の / と #… を落とす） */
function normUrl(u: string): string {
  try {
    const x = new URL(u);
    x.hash = "";
    return `${x.hostname.toLowerCase().replace(/^www\./, "")}${x.pathname.replace(/\/+$/, "")}${x.search}`;
  } catch {
    return "";
  }
}

/** このリンクが、アフィリエイトリンクを入れた商品の公式サイトを指すなら、その商品。URL が完全に一致するものを優先し、無ければドメインが1つの商品にだけ当たるときに使う */
export function affiliateFor(sat: AioSatellite, href: string) {
  const withAff = sat.items.filter((i) => i.affiliateUrl && i.url);
  const n = normUrl(href);
  if (!n) return null;
  const exact = withAff.find((i) => normUrl(i.url) === n);
  if (exact) return exact;
  const host = hostOf(href);
  const sameHost = sat.items.filter((i) => i.url && hostOf(i.url) === host);
  return sameHost.length === 1 && sameHost[0].affiliateUrl ? sameHost[0] : null;
}

/** 本文（Markdown）の中で、アフィリエイトリンクに差し替わる商品 */
export function affiliateLinked(sat: AioSatellite, bodyMd: string) {
  const hrefs = [...bodyMd.matchAll(/\]\((https?:\/\/[^\s)]+)\)/g)].map((m) => m[1]);
  return [...new Set(hrefs.map((h) => affiliateFor(sat, h)).filter((i): i is NonNullable<typeof i> => !!i))];
}

/** WordPress に送る HTML に、冒頭の表記と rel="sponsored" を入れる */
export function applySatellite(html: string, sat: AioSatellite, bodyMd: string, projectUrl: string | null): string {
  const domains = ownDomains(sat, projectUrl);
  const linked = html.replace(/<a href="([^"]+)">/g, (m, href: string) => {
    const raw = href.replace(/&amp;/g, "&").replace(/%22/g, '"');
    const host = hostOf(raw);
    if (!host) return m;
    // アフィリエイトリンクを入れた商品の公式サイトへのリンクは、そのアフィリエイトリンクに差し替える
    const aff = affiliateFor(sat, raw);
    if (aff?.affiliateUrl) return `<a href="${esc(aff.affiliateUrl)}" rel="sponsored noopener" target="_blank">`;
    return matchHost(host, domains) ? `<a href="${href}" rel="sponsored noopener" target="_blank">` : `<a href="${href}" rel="noopener" target="_blank">`;
  });
  const d = disclosureText(sat, bodyMd, projectUrl);
  const box = `<p class="airex-disclosure" style="border:1px solid #ddd;padding:8px 12px;font-size:0.9em;">${d.pr ? "<strong>PR</strong>　" : ""}${esc(d.text.replace(/^PR：/, ""))}</p>`;
  return `${box}\n${linked}`;
}
