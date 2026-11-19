import type { SupabaseClient } from "@supabase/supabase-js";
import { htmlToText, publicFetch } from "@/lib/aio/net";

/**
 * 公式ページの本文の取り方（2026-11-19）。
 * 普通の取得（publicFetch）で取れない・本文がほとんど無い（JavaScript で描くページ・ボット対策のページ）ときは、
 * Apify のブラウザ（Website Content Crawler）で開いて、表示された本文を取る。
 * 有料なので：1日の回数の上限を、実際の fetch の直前の1箇所（renderFetch）で必ず通す（AGENTS.md）。
 * 取れなかったページは次回に回し、取れたページは保存済みの本文を使うので繰り返さない。
 */
export const RENDER_DAILY_MAX = 30;
const MIN_TEXT = 200;
const jstDay = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

export type RenderFn = (url: string) => Promise<string>;

export function apifyRender(admin: SupabaseClient, f: typeof fetch = fetch): RenderFn {
  return async (url) => {
    const token = process.env.APIFY_API_TOKEN;
    if (!token) throw new Error("Apify の API トークンが未設定です（ブラウザ表示では取れません）");
    const { data, error } = await admin.rpc("claim_knowhow_render_call", { p_day: jstDay(), p_max: RENDER_DAILY_MAX });
    if (error || data !== true) throw new Error(`今日のブラウザ表示の上限（${RENDER_DAILY_MAX}回）に達したため、取得していません`);
    const res = await f(`https://api.apify.com/v2/acts/apify~website-content-crawler/run-sync-get-dataset-items?token=${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        startUrls: [{ url }],
        maxCrawlDepth: 0,
        maxCrawlPages: 1,
        crawlerType: "playwright:firefox",
        proxyConfiguration: { useApifyProxy: true },
        removeCookieWarnings: true,
        saveMarkdown: false,
        saveHtml: false,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`ブラウザ表示での取得に失敗しました（HTTP ${res.status}）`);
    const items = (await res.json()) as { text?: unknown }[];
    const text = items.map((i) => (typeof i.text === "string" ? i.text : "")).join("\n").trim();
    if (!text) throw new Error("ブラウザで開きましたが、本文が取れませんでした");
    return text;
  };
}

/** mode=browser はいつもブラウザ表示。auto は普通に取り、失敗・本文が少ないときだけブラウザ表示 */
export function makeFetchText(render: RenderFn, plain: (url: string) => Promise<string> = plainText) {
  return async (url: string, mode: string = "auto"): Promise<string> => {
    if (mode === "browser") return render(url);
    let plainErr = "";
    try {
      const t = await plain(url);
      if (t.trim().length >= MIN_TEXT) return t;
      plainErr = "本文がほとんど取れませんでした";
    } catch (e) {
      plainErr = e instanceof Error ? e.message : String(e);
    }
    try {
      return await render(url);
    } catch (e) {
      throw new Error(`${plainErr}／ブラウザ表示でも取れませんでした（${e instanceof Error ? e.message : String(e)}）`.slice(0, 300));
    }
  };
}

async function plainText(url: string): Promise<string> {
  const res = await publicFetch(url, { timeoutMs: 20_000 });
  if (!res.ok) throw new Error(`取得できませんでした（HTTP ${res.status}）`);
  return htmlToText((await res.text()).slice(0, 1_500_000));
}
