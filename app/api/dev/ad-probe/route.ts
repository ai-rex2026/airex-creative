import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * 一時的な試験用（2026-10-06）。公開情報から広告を取る Apify Actor 2本を、実在の1社で1回だけ試す。
 * 結果は dev_ad_probe に保存し、2回目以降は保存済みの結果を返すだけ（Apify は呼ばない）。
 * 試験が終わったらこのファイルごと削除する。
 */
export const maxDuration = 300;

const KEY_SHA256 = "1b131db011cd8e0f9f7cd70289bacc297a09d77016aafc97fc6cf7c7945a2ce6";
const PROBE_ID = "medicalbrows-1006";

async function runActor(actor: string, input: unknown) {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) return { error: "APIFY_API_TOKEN がありません" };
  try {
    const res = await fetch(`https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${token}&timeout=150`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(170_000),
    });
    const text = await res.text();
    if (!res.ok) return { error: `HTTP ${res.status}: ${text.slice(0, 500)}` };
    const items = JSON.parse(text);
    return { count: Array.isArray(items) ? items.length : 0, items: Array.isArray(items) ? items.slice(0, 10) : items };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get("key") ?? "";
  if (createHash("sha256").update(key).digest("hex") !== KEY_SHA256) return new Response("not found", { status: 404 });
  const sb = createAdminClient();
  const { data: cur } = await sb.from("dev_ad_probe").select("status, payload").eq("id", PROBE_ID).maybeSingle();
  if (cur) return Response.json({ cached: true, status: cur.status, payload: cur.payload });
  // 同時に2回呼ばれても Apify を2回呼ばないよう、先に行を作る（作れなければ他が実行中）
  const { error } = await sb.from("dev_ad_probe").insert({ id: PROBE_ID, status: "running" });
  if (error) return Response.json({ cached: true, status: "running" });
  const [google, meta] = await Promise.all([
    runActor("automation-lab~google-ads-scraper", { domains: ["medicalbrows.jp"], region: "JP", maxAds: 10 }),
    runActor("automation-lab~facebook-ads-library", {
      pageUrls: ["https://www.facebook.com/Medicalbrows/"],
      country: "JP",
      activeStatus: "active",
      maxAds: 10,
    }),
  ]);
  const payload = { google, meta };
  await sb.from("dev_ad_probe").update({ status: "done", payload }).eq("id", PROBE_ID);
  return Response.json({ cached: false, status: "done", summary: { google: (google as { count?: number; error?: string }).count ?? (google as { error?: string }).error, meta: (meta as { count?: number; error?: string }).count ?? (meta as { error?: string }).error } });
}
