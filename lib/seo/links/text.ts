/**
 * 内部リンク分析の「通常のコード」の部分（2026-10-27）。
 * 記事の抽出・TF-IDF と類似度による候補の絞り込み・リンクを入れる文の抽出・アンカー候補の作成。
 * AI にはすべての記事の組み合わせを総当たりさせず、ここで絞ったものだけを判定させる。
 * ネットワークにもデータベースにも触らない（検証しやすいように純粋な関数だけにしている）
 */

export type PageDoc = { url: string; title: string; h1: string; headings: string[]; body: string; links: string[] };

// ── HTML からの抽出 ─────────────────────

const decode = (s: string) =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
const strip = (s: string) => decode(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** URL を同じものとして数えられる形にする（#・?・末尾の / を落とし、www は同一視） */
export function normalizeUrl(raw: string, base?: string): string | null {
  try {
    const u = new URL(raw, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "") || "/";
    return `https://${host}${path}`;
  } catch {
    return null;
  }
}

/** HTML から、タイトル・見出し・本文・同じサイト内への既存リンクを取り出す */
export function extractPage(html: string, pageUrl: string): Omit<PageDoc, "url"> {
  const title = strip((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) ?? [])[1] ?? "");
  let main = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  // 記事の本体だけを見る（あれば）。無ければ body。ナビ・フッター・サイドバーは外す
  const art = main.match(/<article[\s\S]*?<\/article>/i) ?? main.match(/<main[\s\S]*?<\/main>/i);
  if (art) main = art[0];
  else main = (main.match(/<body[\s\S]*<\/body>/i) ?? [main])[0];
  main = main
    .replace(/<(nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, " ");

  const h1 = strip((main.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) ?? [])[1] ?? "");
  const headings = [...main.matchAll(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi)].map((m) => strip(m[1])).filter(Boolean);

  const baseHost = normalizeUrl(pageUrl)?.replace(/^https:\/\//, "").split("/")[0] ?? "";
  const self = normalizeUrl(pageUrl);
  const links = new Set<string>();
  for (const m of main.matchAll(/<a\s[^>]*href=["']([^"'#][^"']*)["'][^>]*>/gi)) {
    const n = normalizeUrl(decode(m[1]), pageUrl);
    if (!n || n === self) continue;
    if (n.replace(/^https:\/\//, "").split("/")[0] === baseHost) links.add(n);
  }

  const body = decode(
    main
      .replace(/<\/(p|h[1-6]|li|div|br|tr|blockquote)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t　]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim()
    .slice(0, 20_000);

  return { title, h1, headings, body, links: [...links] };
}

// ── トークン化と TF-IDF ─────────────────────

const STOP = new Set(["する", "ます", "です", "こと", "もの", "ため", "これ", "それ", "ない", "ある", "いる", "この", "その"]);

/** 日本語は文字の2-gram、英数字は単語にする（形態素解析の辞書を持たずに済ませる） */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  const t = text.toLowerCase().normalize("NFKC");
  for (const m of t.matchAll(/[a-z0-9][a-z0-9\-_.]{1,}|[぀-ヿ㐀-鿿々ー]+/g)) {
    const s = m[0];
    if (/^[a-z0-9]/.test(s)) {
      out.push(s);
      continue;
    }
    if (s.length < 2) continue;
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      if (STOP.has(g)) continue;
      // ひらがなだけの2文字（です・ます・して 等）は主題を表さないので外す
      if (/^[぀-ゟ]{2}$/.test(g)) continue;
      out.push(g);
    }
  }
  return out;
}

export type Vec = Map<string, number>;

/** タイトル・見出しは本文より強く効かせる（重みの付けた回数だけ数える） */
function weightedTokens(d: PageDoc): string[] {
  const head = [d.title, d.h1, ...d.headings].join("\n");
  const ht = tokenize(head);
  return [...ht, ...ht, ...ht, ...tokenize(d.body)];
}

export type Index = { vecs: Map<string, Vec>; norm: Map<string, number> };

export function buildIndex(docs: PageDoc[]): Index {
  const tfs = new Map<string, Map<string, number>>();
  const df = new Map<string, number>();
  for (const d of docs) {
    const tf = new Map<string, number>();
    for (const tok of weightedTokens(d)) tf.set(tok, (tf.get(tok) ?? 0) + 1);
    tfs.set(d.url, tf);
    for (const tok of tf.keys()) df.set(tok, (df.get(tok) ?? 0) + 1);
  }
  const n = docs.length;
  const vecs = new Map<string, Vec>();
  const norm = new Map<string, number>();
  for (const [url, tf] of tfs) {
    const v: Vec = new Map();
    let sq = 0;
    for (const [tok, c] of tf) {
      // 全記事に出る語は効かせない。1記事だけの語（固有の綴り違い等）も弱める
      const d = df.get(tok) ?? 1;
      if (n > 3 && d === n) continue;
      const w = (1 + Math.log(c)) * (Math.log((n + 1) / (d + 0.5)) + 1);
      v.set(tok, w);
      sq += w * w;
    }
    vecs.set(url, v);
    norm.set(url, Math.sqrt(sq) || 1);
  }
  return { vecs, norm };
}

export function cosine(ix: Index, a: string, b: string): number {
  const va = ix.vecs.get(a);
  const vb = ix.vecs.get(b);
  if (!va || !vb) return 0;
  const [s, l] = va.size <= vb.size ? [va, vb] : [vb, va];
  let dot = 0;
  for (const [k, w] of s) {
    const o = l.get(k);
    if (o) dot += w * o;
  }
  return dot / ((ix.norm.get(a) ?? 1) * (ix.norm.get(b) ?? 1));
}

// ── 候補の絞り込み ─────────────────────

export type Candidate = { from: string; to: string; similarity: number };

/**
 * リンク元ごとに、類似度が高く、まだリンクしていない上位の相手を候補にする。
 * perSource：1記事から最大何本まで／minSim：これ未満は候補にしない
 */
export function pickCandidates(docs: PageDoc[], opts: { perSource?: number; minSim?: number } = {}): Candidate[] {
  const perSource = opts.perSource ?? 3;
  const minSim = opts.minSim ?? 0.12;
  const ix = buildIndex(docs);
  const out: Candidate[] = [];
  for (const a of docs) {
    const existing = new Set(a.links);
    const scored: Candidate[] = [];
    for (const b of docs) {
      if (a.url === b.url || existing.has(b.url)) continue;
      const s = cosine(ix, a.url, b.url);
      if (s >= minSim) scored.push({ from: a.url, to: b.url, similarity: +s.toFixed(4) });
    }
    scored.sort((x, y) => y.similarity - x.similarity);
    out.push(...scored.slice(0, perSource));
  }
  return out;
}

// ── リンクを入れる文とアンカー ─────────────────────

export function splitSentences(body: string): string[] {
  return body
    .split(/(?<=[。！？!?])|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 12 && s.length <= 200);
}

/** リンク先を表す語（タイトル・見出しの語）に近い順に、リンク元の文を上位 k 件返す */
export function bestSentences(from: PageDoc, to: PageDoc, ix: Index, k = 3): string[] {
  const target = ix.vecs.get(to.url);
  if (!target) return [];
  const scored = splitSentences(from.body).map((s) => {
    const toks = new Set(tokenize(s));
    let w = 0;
    for (const t of toks) w += target.get(t) ?? 0;
    return { s, score: w / Math.sqrt(toks.size || 1) };
  });
  return scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((x) => x.s);
}

/**
 * アンカー候補：その文に実在する語句のうち、リンク先のタイトル・見出しにも現れるもの。
 * 長いものから、重ならない範囲で最大 max 件。リンク先の語を勝手に作らない
 */
export function anchorCandidates(sentence: string, to: PageDoc, max = 4): string[] {
  const hay = [to.title, to.h1, ...to.headings].join("\n").toLowerCase().normalize("NFKC");
  const s = sentence.normalize("NFKC");
  const lower = s.toLowerCase();
  const taken: [number, number][] = [];
  const found: string[] = [];
  for (let len = Math.min(18, s.length); len >= 3 && found.length < max; len--) {
    for (let i = 0; i + len <= s.length && found.length < max; i++) {
      const piece = lower.slice(i, i + len);
      if (!hay.includes(piece)) continue;
      if (/^[\s、。，．・（）()「」『』]|[\s、。，．・（）()「」『』]$/.test(piece)) continue;
      // ひらがなだけ・助詞で始まる断片は避ける
      if (/^[぀-ゟ]+$/.test(piece) || /^[はがをにでとのもへや]/.test(piece) || /[はがをにでとのもへや]$/.test(piece)) continue;
      if (taken.some(([a, b]) => i < b && i + len > a)) continue;
      taken.push([i, i + len]);
      found.push(s.slice(i, i + len));
    }
  }
  return found;
}

// ── 構造の集計（可視化用） ─────────────────────

export type Edge = { from: string; to: string };

export function inOutCounts(urls: string[], edges: Edge[]): Map<string, { in: number; out: number }> {
  const m = new Map(urls.map((u) => [u, { in: 0, out: 0 }]));
  for (const e of edges) {
    const a = m.get(e.from);
    const b = m.get(e.to);
    if (a) a.out++;
    if (b) b.in++;
  }
  return m;
}
