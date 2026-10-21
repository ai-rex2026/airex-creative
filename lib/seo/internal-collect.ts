import { scanSite, type SiteScan } from "../site-scan";
import { assertPublicUrl, fetchHtml, publicFetch } from "../aio/net";
import { htmlHints, type SweepInput } from "./internal";

/** 内部対策の洗い出しに使う読み取り（サーバー専用）。検証のために差し替えられる */
export type CollectDeps = {
  scan: (url: string) => Promise<SiteScan>;
  html: (url: string) => Promise<string>;
  text: (url: string) => Promise<{ ok: boolean; body: string }>;
};

export const COLLECT_DEPS: CollectDeps = {
  scan: scanSite,
  html: async (url) => (await fetchHtml(url, { browserUa: true })).html,
  text: async (url) => {
    const res = await publicFetch(url, { timeoutMs: 10_000 });
    return { ok: res.ok, body: res.ok ? (await res.text()).slice(0, 200_000) : "" };
  },
};

/** サイトのトップ・robots.txt・llms.txt を読む。読めなかったものは null（その判定は出さない） */
export async function collectSweepInput(rawUrl: string, deps: CollectDeps = COLLECT_DEPS): Promise<SweepInput & { notes: string[] }> {
  const u = assertPublicUrl(rawUrl);
  const origin = `${u.protocol}//${u.host}`;
  const notes: string[] = [];
  const [scan, html, robots, llms] = await Promise.allSettled([
    deps.scan(u.toString()),
    deps.html(u.toString()),
    deps.text(`${origin}/robots.txt`),
    deps.text(`${origin}/llms.txt`),
  ]);
  if (scan.status === "rejected") notes.push(`サイトを読めませんでした（${scan.reason instanceof Error ? scan.reason.message.slice(0, 120) : "不明"}）`);
  return {
    site: scan.status === "fulfilled" ? scan.value : null,
    html: html.status === "fulfilled" ? htmlHints(html.value) : null,
    robots: robots.status === "fulfilled" ? (robots.value.ok ? robots.value.body : "") : null,
    llms: llms.status === "fulfilled" ? llms.value.ok && llms.value.body.trim().length > 0 && !/<html/i.test(llms.value.body.slice(0, 500)) : null,
    notes,
  };
}
