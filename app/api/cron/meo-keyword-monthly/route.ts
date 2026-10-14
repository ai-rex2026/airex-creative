import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { measureStoreKeywords, normalizeOrigin, originFromStore, rowToKeyword, KEYWORD_COLUMNS } from "@/lib/meo-ops/keywords";
import type { MeoStoreSnapshot } from "@/lib/meo-ops/types";

// 店舗×キーワードぶん Text Search を投げるので長めに取る
export const maxDuration = 300;

/**
 * キーワード順位の月次計測。Vercel Cron から毎月1日 4:30 JST に叩かれる。
 * キーワードを登録している店舗だけを回す（登録が無い店舗にはコストを払わない）。
 * 同じ日の再実行は保存済みを飛ばす（measureStoreKeywords 側で判定）。
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  const out: { store_id: string; measured: number; skipped: number; failed: number }[] = [];
  try {
    const { data: kws } = await admin.from("meo_keywords").select(`${KEYWORD_COLUMNS}, store_id`).order("store_id");
    const byStore = new Map<string, ReturnType<typeof rowToKeyword>[]>();
    for (const r of (kws ?? []) as Record<string, unknown>[]) {
      const sid = String(r.store_id);
      byStore.set(sid, [...(byStore.get(sid) ?? []), rowToKeyword(r)]);
    }
    for (const [storeId, keywords] of byStore) {
      const { data: s } = await admin.from("stores").select("meo_place_id, meo_store, meo_rank_origin").eq("id", storeId).maybeSingle();
      if (!s?.meo_place_id) continue;
      const origin = normalizeOrigin(s.meo_rank_origin) ?? originFromStore((s.meo_store as MeoStoreSnapshot | null) ?? null);
      if (!origin) continue;
      try {
        const r = await measureStoreKeywords(admin, storeId, s.meo_place_id as string, origin, keywords, "monthly");
        out.push({ store_id: storeId, ...r });
      } catch (e) {
        console.error("[meo-keyword-monthly]", storeId, e instanceof Error ? e.message : e);
        out.push({ store_id: storeId, measured: 0, skipped: 0, failed: keywords.length });
      }
    }
    return NextResponse.json({ stores: out });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e), stores: out }, { status: 500 });
  }
}
