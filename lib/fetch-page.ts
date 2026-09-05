/** LPのHTMLを取って本文だけにする。広告のコピーを書くのに要るのは可視テキストだけ。 */
export async function fetchPageText(url: string): Promise<{ title: string; text: string }> {
  const res = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; AI-REX/1.0; +https://airex-ad.ai)" },
    redirect: "follow",
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`ページを取得できませんでした (HTTP ${res.status})`);
  const html = await res.text();
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "";
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return { title, text: text.slice(0, 12000) };
}
