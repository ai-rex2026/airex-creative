/**
 * サイトの技術面をその場で測る。AIは使わず、実際に取得できた事実だけを返す。
 * 本番 AI-REX の「サイト概要」「セキュリティチェック」に相当する。
 */

export type HeaderCheck = {
  key: string;
  label: string;
  desc: string;
  value: string | null;
  pass: boolean;
};

export type SiteScan = {
  finalUrl: string;
  https: boolean;
  title: string;
  description: string;
  headers: HeaderCheck[];
  robotsTxt: boolean;
  sitemapXml: boolean;
  structuredData: boolean;
  internalLinks: number;
  externalLinks: number;
  adTags: string[];
  tech: string[];
  passed: number;
  total: number;
};

const UA = "Mozilla/5.0 (compatible; AI-REX/1.0; +https://airex-ad.ai)";

async function head(url: string) {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(8000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function scanSite(input: string): Promise<SiteScan> {
  const res = await fetch(input, {
    headers: { "user-agent": UA },
    redirect: "follow",
    signal: AbortSignal.timeout(20000),
  });
  const html = await res.text();
  const finalUrl = res.url || input;
  const origin = new URL(finalUrl).origin;
  const host = new URL(finalUrl).host;
  const h = (n: string) => res.headers.get(n);

  const headers: HeaderCheck[] = [
    { key: "hsts", label: "HSTS", desc: "HTTP Strict-Transport-Security", value: h("strict-transport-security"), pass: !!h("strict-transport-security") },
    { key: "csp", label: "CSP", desc: "Content-Security-Policy", value: h("content-security-policy"), pass: !!h("content-security-policy") },
    {
      key: "clickjacking",
      label: "クリックジャッキング対策",
      desc: "X-Frame-Options / CSP frame-ancestors",
      value: h("x-frame-options") ?? (h("content-security-policy")?.includes("frame-ancestors") ? "frame-ancestors" : null),
      pass: !!h("x-frame-options") || !!h("content-security-policy")?.includes("frame-ancestors"),
    },
    { key: "referrer", label: "Referrer-Policy", desc: "リファラの送信範囲", value: h("referrer-policy"), pass: !!h("referrer-policy") },
    { key: "permissions", label: "Permissions-Policy", desc: "Permissions-Policy（旧 Feature-Policy）", value: h("permissions-policy"), pass: !!h("permissions-policy") },
    { key: "nosniff", label: "X-Content-Type-Options", desc: "MIMEタイプの推測を止める", value: h("x-content-type-options"), pass: h("x-content-type-options") === "nosniff" },
  ];

  const [robotsTxt, sitemapXml] = await Promise.all([
    head(`${origin}/robots.txt`),
    head(`${origin}/sitemap.xml`),
  ]);

  const links = [...html.matchAll(/<a\s[^>]*href=["']([^"'#]+)["']/gi)].map((m) => m[1]);
  let internalLinks = 0;
  let externalLinks = 0;
  for (const href of links) {
    if (href.startsWith("/") || href.includes(host)) internalLinks++;
    else if (/^https?:\/\//i.test(href)) externalLinks++;
  }

  const structuredData = /application\/ld\+json/i.test(html);

  const adTags: string[] = [];
  if (/connect\.facebook\.net|fbq\(/i.test(html)) adTags.push("Meta Pixel");
  if (/googleadservices|gtag\('config',\s*'AW-/i.test(html)) adTags.push("Google 広告");
  if (/analytics\.tiktok\.com/i.test(html)) adTags.push("TikTok Pixel");
  if (/yjtag\.yahoo|s\.yjtag\.jp/i.test(html)) adTags.push("Yahoo! タグ");
  if (/lineads|tr\.line\.me/i.test(html)) adTags.push("LINE Tag");

  const tech: string[] = [];
  if (/googletagmanager\.com\/gtm\.js|GTM-/i.test(html)) tech.push("Google Tag Manager");
  if (/gtag\/js\?id=G-/i.test(html)) tech.push("Google Analytics 4");
  if (/wp-content|wp-includes/i.test(html)) tech.push("WordPress");
  if (/_next\/static/i.test(html)) tech.push("Next.js");
  if (/cdn\.shopify\.com/i.test(html)) tech.push("Shopify");
  if (/studio\.design/i.test(html)) tech.push("STUDIO");

  const https = finalUrl.startsWith("https://");
  // 通過数は「ヘッダー6項目 ＋ HTTPS ＋ robots.txt ＋ sitemap.xml ＋ 構造化データ」の10点で数える
  const passed =
    headers.filter((x) => x.pass).length +
    (https ? 1 : 0) +
    (robotsTxt ? 1 : 0) +
    (sitemapXml ? 1 : 0) +
    (structuredData ? 1 : 0);

  return {
    finalUrl,
    https,
    title: html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "",
    description: html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1] ?? "",
    headers,
    robotsTxt,
    sitemapXml,
    structuredData,
    internalLinks,
    externalLinks,
    adTags,
    tech,
    passed,
    total: 10,
  };
}

export type SeoEstimate = {
  score: number;
  label: string;
  comment: string;
};

/**
 * SEO強度の推定。外部の被リンクデータは持っていないので、
 * その場で測れる指標だけから出した「推定値」であることを画面にも明記する。
 */
export function estimateSeo(s: SiteScan): SeoEstimate {
  const headerRatio = s.headers.filter((h) => h.pass).length / s.headers.length;
  const score = Math.round(
    Math.min(100,
      20 +
      (s.https ? 12 : 0) +
      (s.sitemapXml ? 12 : 0) +
      (s.robotsTxt ? 6 : 0) +
      (s.structuredData ? 14 : 0) +
      headerRatio * 16 +
      Math.min(20, s.internalLinks / 5)
    )
  );
  const label = score >= 70 ? "標準以上" : score >= 45 ? "やや弱い" : "低権威";
  const comment =
    score >= 70
      ? "技術面の土台はできています。あとは被リンクとコンテンツの積み上げで伸ばせます。"
      : score >= 45
        ? "土台に穴があります。まずは構造化データとサイトマップ、セキュリティヘッダーを埋めるのが早いです。"
        : "技術面の整備が進んでいません。競合の激しいキーワードでは上位表示に時間がかかります。ロングテールから攻めることを推奨します。";
  return { score, label, comment };
}
