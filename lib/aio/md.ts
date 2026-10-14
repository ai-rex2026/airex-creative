/**
 * 記事の Markdown を HTML にする（WordPress への投稿・note への貼り付け・画面のプレビューで同じものを使う）。
 * AI が書く範囲の記法（見出し・段落・箇条書き・番号・太字・リンク・引用・表・コード）だけを扱う。
 * 本文中の HTML はすべてエスケープする（AI の出力をそのまま HTML として通さない）。
 */

/** placeholder を入れると画像の代わりにその文を置く（note に貼るとき：画像は人が差し込む） */
export type MdImage = { afterH2: number | null; src: string; alt: string; placeholder?: string };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function inline(s: string): string {
  let t = esc(s);
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
  t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, label: string, url: string) => `<a href="${url.replace(/"/g, "%22")}">${label}</a>`);
  return t;
}

function figure(img: MdImage): string {
  if (img.placeholder) return `<p>${esc(img.placeholder)}</p>`;
  return `<figure><img src="${esc(img.src)}" alt="${esc(img.alt)}" /></figure>`;
}

export function mdToHtml(md: string, images: MdImage[] = []): string {
  const lines = (md || "").replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let para: string[] = [];
  let list: { tag: "ul" | "ol"; items: string[] } | null = null;
  let quote: string[] = [];
  let table: string[][] | null = null;
  let code: string[] | null = null;
  let h2 = -1;

  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inline).join("<br />")}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`);
    list = null;
  };
  const flushQuote = () => {
    if (quote.length) out.push(`<blockquote><p>${quote.map(inline).join("<br />")}</p></blockquote>`);
    quote = [];
  };
  const flushTable = () => {
    if (table && table.length) {
      const [head, ...rows] = table;
      out.push(
        `<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rows
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table>`
      );
    }
    table = null;
  };
  const flushAll = () => {
    flushPara();
    flushList();
    flushQuote();
    flushTable();
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (code) {
      if (/^```/.test(line)) {
        out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`);
        code = null;
      } else code.push(raw);
      continue;
    }
    if (/^```/.test(line)) {
      flushAll();
      code = [];
      continue;
    }
    const h = /^(#{1,4})\s+(.+)$/.exec(line);
    if (h) {
      flushAll();
      // 記事のタイトルは別に持つので、本文の # は h2 として扱う
      const level = Math.max(2, h[1].length);
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      if (level === 2) {
        h2++;
        for (const img of images.filter((i) => i.afterH2 === h2)) out.push(figure(img));
      }
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(line)) {
      flushAll();
      out.push("<hr />");
      continue;
    }
    if (/^\|.*\|$/.test(line)) {
      flushPara();
      flushList();
      flushQuote();
      const cells = line.slice(1, -1).split("|").map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue; // 区切り行
      table = table ?? [];
      table.push(cells);
      continue;
    }
    flushTable();
    const ul = /^\s*[-*・]\s+(.+)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (ul || ol) {
      flushPara();
      flushQuote();
      const tag = ul ? "ul" : "ol";
      if (list && list.tag !== tag) flushList();
      list = list ?? { tag, items: [] };
      list.items.push((ul ?? ol)![1]);
      continue;
    }
    const q = /^>\s?(.*)$/.exec(line);
    if (q) {
      flushPara();
      flushList();
      quote.push(q[1]);
      continue;
    }
    if (!line.trim()) {
      flushAll();
      continue;
    }
    flushList();
    flushQuote();
    para.push(line.trim());
  }
  if (code) out.push(`<pre><code>${esc((code as string[]).join("\n"))}</code></pre>`);
  flushAll();
  // 見出しが足りず置けなかった本文中の画像は末尾に置く
  for (const img of images.filter((i) => i.afterH2 !== null && i.afterH2 > h2)) out.push(figure(img));
  return out.join("\n");
}

/** 見出し（##）の一覧（画像の置き場所を選ぶ・数える用） */
export function h2List(md: string): string[] {
  return (md || "")
    .split(/\r?\n/)
    .map((l) => /^#{1,2}\s+(.+)$/.exec(l.trim())?.[1])
    .filter((x): x is string => !!x);
}

/** 本文の文字数（記号・空白・Markdown の記号を除く。AI に数えさせない） */
export function bodyChars(md: string): number {
  return Array.from((md || "").replace(/^#+\s+/gm, "").replace(/[*`>|#\-\s]/g, "")).length;
}
