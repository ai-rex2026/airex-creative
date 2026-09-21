"use server";

import { createClient } from "@/lib/supabase/server";
import { getAdCredentials } from "@/lib/ads/tokens";
import {
  fetchCampaignMetrics,
  isCustomerId,
  DATE_RE,
  type CampaignMetric,
  type DailyMetric,
} from "@/lib/ads/google";

/**
 * Google 広告：選んだアカウントのキャンペーン別実績（読み取りのみ）。
 * 選択は ad_connections.meta.selected（saveGoogleSelection で検証済みのもの）だけを使う。
 */

export type AdPerformance = {
  account: { id: string; name: string; loginCustomerId: string | null };
  campaigns: CampaignMetric[];
  daily: DailyMetric[];
  error?: string;
};

const MAX_RANGE_DAYS = 366;

export async function googlePerformance(
  from: string,
  to: string
): Promise<{ results: AdPerformance[]; error?: string }> {
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) return { results: [], error: "期間の形式が正しくありません" };
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1;
  if (!(days >= 1)) return { results: [], error: "終了日は開始日以降にしてください" };
  if (days > MAX_RANGE_DAYS) return { results: [], error: `期間は${MAX_RANGE_DAYS}日以内にしてください` };

  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user || user.is_anonymous) return { results: [], error: "ログインしてください" };
  const creds = await getAdCredentials(user.id, "google");
  if (!creds) return { results: [], error: "Google 広告と連携してください" };

  const raw = (creds.meta as { selected?: unknown }).selected;
  const selected = (Array.isArray(raw) ? raw : []).filter(
    (x): x is AdPerformance["account"] =>
      !!x &&
      isCustomerId((x as AdPerformance["account"]).id) &&
      ((x as AdPerformance["account"]).loginCustomerId === null || isCustomerId((x as AdPerformance["account"]).loginCustomerId))
  );
  if (selected.length === 0) return { results: [], error: "分析する広告アカウントを選んで保存してください" };

  const results = await Promise.all(
    selected.map(async (account): Promise<AdPerformance> => {
      try {
        const m = await fetchCampaignMetrics(creds.accessToken, account.id, account.loginCustomerId, from, to);
        return { account, ...m };
      } catch (e) {
        return { account, campaigns: [], daily: [], error: e instanceof Error ? e.message : String(e) };
      }
    })
  );
  return { results };
}
