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
  /** GTM コンテナID。中身まで読めたかどうかで、タグ診断の断定可否が変わる */
  gtmId: string | null;
  gtmRead: boolean;
  /** JSON-LD から拾えた事業所情報。MEO の照合に使う */
  bizName: string | null;
  bizAddress: string | null;
  bizPhone: string | null;
  /** サイトから辿れる公式SNS。実際に張られているリンクだけ */
  social: { platform: string; url: string; handle: string }[];
  /** 申し込みの受け口。KPIツリーの「予約率」を考える土台になる */
  conversions: { kind: string; detail: string; measurable: boolean }[];
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
  // エラーページを本文として読むと、その後の分析が全部そのページの上に建つ。
  // 「403 Forbidden」をタイトルとして商材を推定した実例があるので、ここで止める。
  if (!res.ok) {
    throw new Error(
      `サイトを読み込めませんでした（HTTP ${res.status}）。` +
        (res.status === 403 || res.status === 429
          ? "サーバー側でアクセスが拒否されています。WAFやbot対策の設定をご確認ください。"
          : "URLをご確認ください。")
    );
  }
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
  const biz = readBusiness(html);
  const social = readSocial(html, host);
  const conversions = readConversions(html);

  // GTM はタグを表示時に差し込むので HTML だけでは分からない。
  // コンテナ自体は公開されているので中身を読んで判定する
  const gtmId = html.match(/GTM-[A-Z0-9]{4,}/)?.[0] ?? null;
  const gtmSrc = gtmId ? await fetchGtm(gtmId) : null;

  // ページのHTMLは「その文字列がある＝そのタグを読み込んでいる」でよい。
  // 一方 GTM コンテナには未設定のタグの送信先URLも最初から入っているため、
  // ホスト名だけで判定すると誤検知する（例: googleadservices は常に含まれる）。
  // コンテナ側は「実際に設定されたID」がある場合だけ検出する。
  const TAGS: { name: string; inHtml: RegExp; inGtm: RegExp }[] = [
    { name: "Meta Pixel", inHtml: /connect\.facebook\.net|fbq\(/i, inGtm: /facebook\.com\\?\/tr\?id=\d{6,}|fbq\(\s*["']init/i },
    { name: "Google 広告", inHtml: /googleadservices|AW-\d{6,}/i, inGtm: /AW-\d{6,}/ },
    { name: "TikTok Pixel", inHtml: /analytics\.tiktok\.com/i, inGtm: /ttq\.load\(|tiktok[^"']{0,20}pixel_code/i },
    { name: "Yahoo! タグ", inHtml: /yjtag\.yahoo|s\.yjtag\.jp/i, inGtm: /yjtag\.jp\\?\/tag\/\?site=|yahoo_ss_retargeting/i },
    { name: "LINE Tag", inHtml: /lineads|tr\.line\.me/i, inGtm: /tr\.line\.me\\?\/tag\.js|_lt\(\s*["']init/i },
  ];
  const adTags = TAGS.filter((t) => t.inHtml.test(html) || (gtmSrc ? t.inGtm.test(gtmSrc) : false)).map((t) => t.name);

  const tech: string[] = [];
  if (gtmId) tech.push("Google Tag Manager");
  if (/gtag\/js\?id=G-/i.test(html) || /["']G-[A-Z0-9]{6,}["']/.test(gtmSrc ?? "")) tech.push("Google Analytics 4");
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
    gtmId,
    gtmRead: gtmSrc !== null,
    bizName: biz.name,
    bizAddress: biz.address,
    bizPhone: biz.phone,
    social,
    conversions,
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

/**
 * JSON-LD から店舗名・住所・電話を拾う。
 * MEO で「そのGoogleビジネスプロフィールが本当にこのサイトの店か」を照合するのに使う。
 */
function readBusiness(html: string) {
  const out: { name: string | null; address: string | null; phone: string | null } = {
    name: null, address: null, phone: null,
  };
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let json: unknown;
    try {
      json = JSON.parse(m[1].trim());
    } catch {
      continue; // 壊れた JSON-LD は珍しくない。無視して次へ
    }
    const nodes: Record<string, unknown>[] = [];
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") {
        const o = v as Record<string, unknown>;
        nodes.push(o);
        if (Array.isArray(o["@graph"])) walk(o["@graph"]);
      }
    };
    walk(json);
    for (const n of nodes) {
      const type = String(n["@type"] ?? "");
      // LocalBusiness とその派生（Dentist, Restaurant, MedicalClinic …）だけを見る
      if (!/Business|Store|Clinic|Dentist|Restaurant|Organization|Hospital|Salon/i.test(type)) continue;
      if (!out.name && typeof n.name === "string") out.name = n.name;
      if (!out.phone && typeof n.telephone === "string") out.phone = n.telephone;
      if (!out.address) {
        const a = n.address;
        if (typeof a === "string") out.address = a;
        else if (a && typeof a === "object") {
          const o = a as Record<string, unknown>;
          const parts = ["postalCode", "addressRegion", "addressLocality", "streetAddress"]
            .map((k) => (typeof o[k] === "string" ? (o[k] as string) : ""))
            .filter(Boolean);
          if (parts.length) out.address = parts.join(" ");
        }
      }
    }
  }
  return out;
}

const SOCIAL_HOSTS: { platform: string; re: RegExp }[] = [
  { platform: "Instagram", re: /instagram\.com\/([A-Za-z0-9._]+)/i },
  { platform: "X（Twitter）", re: /(?:twitter|x)\.com\/([A-Za-z0-9_]+)/i },
  { platform: "Facebook", re: /facebook\.com\/([A-Za-z0-9.\-]+)/i },
  { platform: "TikTok", re: /tiktok\.com\/@([A-Za-z0-9._]+)/i },
  { platform: "YouTube", re: /youtube\.com\/(?:@|channel\/|c\/|user\/)([A-Za-z0-9._\-]+)/i },
  { platform: "LINE", re: /lin\.ee\/([A-Za-z0-9._~\-]+)|line\.me\/(?:R\/ti\/p\/)?(@?[A-Za-z0-9._~\-]+)/i },
];

/** サイトに実際に張られている公式SNSリンクだけを拾う。推測はしない */
function readSocial(html: string, host: string) {
  const found = new Map<string, { platform: string; url: string; handle: string }>();
  for (const m of html.matchAll(/<a\s[^>]*href=["']([^"']+)["']/gi)) {
    const href = m[1];
    if (href.includes(host)) continue;
    for (const { platform, re } of SOCIAL_HOSTS) {
      const hit = href.match(re);
      // share ボタンなど、自分のページを渡すだけのリンクは公式アカウントではない
      if (!hit || /\/(share|sharer|intent|home)\b/i.test(href)) continue;
      const handle = hit.slice(1).find(Boolean) ?? "";
      if (handle && !found.has(platform)) found.set(platform, { platform, url: href, handle });
    }
  }
  return [...found.values()];
}

/** GTM の公開コンテナを取る。取れなければ null（＝タグの有無を断定しない） */
async function fetchGtm(id: string): Promise<string | null> {
  try {
    const res = await fetch(`https://www.googletagmanager.com/gtm.js?id=${id}`, {
      headers: { "user-agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * 申し込みの受け口を探す。
 *
 * measurable は「広告のコンバージョンとして計測できるか」。
 * 電話は発信そのものを計測できず、外部の予約サービスへ飛ぶと自サイトを離れる。
 * ここが弱いサイトは、タグを入れても成果を測れない。
 */
function readConversions(html: string) {
  const out: { kind: string; detail: string; measurable: boolean }[] = [];
  const uniq = (re: RegExp) => [...new Set([...html.matchAll(re)].map((m) => m[1]))];

  const forms = (html.match(/<form[\s>]/gi) ?? []).length;
  if (forms > 0) out.push({ kind: "フォーム", detail: `${forms}件`, measurable: true });

  const tel = uniq(/href="tel:([^"]+)"/gi);
  if (tel.length) out.push({ kind: "電話", detail: tel.slice(0, 2).join(" / "), measurable: false });

  const line = uniq(/href="(https?:\/\/(?:lin\.ee|line\.me)[^"]*)"/gi);
  if (line.length) out.push({ kind: "LINE", detail: "友だち追加リンク", measurable: false });

  const mail = uniq(/href="mailto:([^"?]+)"/gi);
  if (mail.length) out.push({ kind: "メール", detail: mail[0], measurable: false });

  // 外部の予約サービスへ飛ぶと自サイトを離れるため、こちらでは計測できない
  const ext = uniq(/href="(https?:\/\/[^"]*(?:epark|airrsv|hotpepper|coubic|square|timerex|reserva|yoyaku)[^"]*)"/gi);
  if (ext.length) out.push({ kind: "外部の予約サービス", detail: new URL(ext[0]).host, measurable: false });

  const page = uniq(/href="(\/[^"]*(?:contact|reserve|yoyaku|counseling|inquiry)[^"]*)"/gi);
  if (page.length && forms === 0) {
    out.push({ kind: "問い合わせページ", detail: page[0], measurable: true });
  }
  return out;
}
