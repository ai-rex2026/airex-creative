import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAdCredentials } from "@/lib/ads/tokens";
import { xAdAccounts, fetchCampaignMetrics } from "@/lib/ads/x";

/**
 * X広告 stats取得の動作確認用（一時的）エンドポイント。
 * x-debug-secret ヘッダーが DEBUG_STATS_SECRET と一致しないと 403。
 * 確認が終わったら削除してよい。
 */
export async function GET(req: Request) {
  const secret = req.headers.get("x-debug-secret");
  if (!secret || !process.env.DEBUG_STATS_SECRET || secret !== process.env.DEBUG_STATS_SECRET) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!from || !to) {
    return NextResponse.json({ error: "from/to が必要です（YYYY-MM-DD）" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: conn } = await admin
    .from("ad_connections")
    .select("user_id")
    .eq("platform", "x")
    .limit(1)
    .maybeSingle();
  if (!conn) return NextResponse.json({ error: "X 広告の連携がありません" }, { status: 404 });

  const creds = await getAdCredentials(conn.user_id as string, "x");
  if (!creds || !creds.tokenSecret) {
    return NextResponse.json({ error: "トークンが取得できません" }, { status: 404 });
  }

  try {
    const accounts = await xAdAccounts(creds.accessToken, creds.tokenSecret);
    const results = [];
    for (const a of accounts.slice(0, 3)) {
      try {
        const r = await fetchCampaignMetrics(creds.accessToken, creds.tokenSecret, a.id, from, to);
        const totalCost = r.campaigns.reduce((s, c) => s + c.cost, 0);
        results.push({
          account: a,
          ok: true,
          campaignCount: r.campaigns.length,
          dayCount: r.daily.length,
          totalCost,
        });
      } catch (e) {
        results.push({ account: a, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return NextResponse.json({ accountCount: accounts.length, results });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
