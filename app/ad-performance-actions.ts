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
import {
  fetchCampaignMetrics as fetchYahooCampaignMetrics,
  type YahooCampaignMetric,
  type YahooDailyMetric,
} from "@/lib/ads/yahoo";
import {
  fetchCampaignMetrics as fetchMicrosoftCampaignMetrics,
  type MicrosoftCampaignMetric,
  type MicrosoftDailyMetric,
} from "@/lib/ads/microsoft";

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

/**
 * ヤフーLINE広告：選んだアカウントのキャンペーン別実績（読み取りのみ）。
 * 選択は ad_connections.meta.selected（saveYahooSelection で検証済みのもの）だけを使う。
 * MCC自身は選べない仕様なので、ここに来る account.id は必ず配下の広告アカウント自身のID。
 * account.mccId は x-z-base-account-id ヘッダーに使う「直接の base account」を選ぶために必要
 * （MCC配下で選んだ場合はそのMCCのID、直下で選んだ場合は null＝lib/ads/yahoo.ts 側で
 * account.id 自身にフォールバックする。詳細は lib/ads/yahoo.ts 冒頭のコメント）。
 */

export type YahooAdPerformance = {
  account: { id: string; name: string };
  campaigns: YahooCampaignMetric[];
  daily: YahooDailyMetric[];
  error?: string;
};

export async function yahooPerformance(
  from: string,
  to: string
): Promise<{ results: YahooAdPerformance[]; error?: string }> {
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) return { results: [], error: "期間の形式が正しくありません" };
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1;
  if (!(days >= 1)) return { results: [], error: "終了日は開始日以降にしてください" };
  if (days > MAX_RANGE_DAYS) return { results: [], error: `期間は${MAX_RANGE_DAYS}日以内にしてください` };

  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user || user.is_anonymous) return { results: [], error: "ログインしてください" };
  const creds = await getAdCredentials(user.id, "yahoo");
  if (!creds) return { results: [], error: "ヤフーLINE広告と連携してください" };

  const raw = (creds.meta as { selected?: unknown }).selected;
  const selected = (Array.isArray(raw) ? raw : []).filter(
    (x): x is { id: string; name: string; mccId: string | null } =>
      !!x && typeof (x as { id?: unknown }).id === "string" && (x as { id: string }).id.length > 0
  );
  if (selected.length === 0) return { results: [], error: "分析する広告アカウントを選んで保存してください" };

  const results = await Promise.all(
    selected.map(async (account): Promise<YahooAdPerformance> => {
      const acc = { id: account.id, name: account.name };
      try {
        const m = await fetchYahooCampaignMetrics(creds.accessToken, account.id, account.mccId, from, to);
        return { account: acc, ...m };
      } catch (e) {
        return { account: acc, campaigns: [], daily: [], error: e instanceof Error ? e.message : String(e) };
      }
    })
  );
  return { results };
}

/**
 * Microsoft 広告：選んだアカウントのキャンペーン別実績（読み取りのみ）。
 * 選択は ad_connections.meta.selected（saveMicrosoftSelection で検証済みのもの）だけを使う。
 * account.customerId は GetCampaignsByAccountId・Reporting Service の SOAP ヘッダー
 * CustomerId に使う ParentCustomerId（保存時に Microsoft から取り直したもの。lib/ads/microsoft.ts 参照）。
 */

export type MicrosoftAdPerformance = {
  account: { id: string; name: string };
  campaigns: MicrosoftCampaignMetric[];
  daily: MicrosoftDailyMetric[];
  error?: string;
};

export async function microsoftPerformance(
  from: string,
  to: string
): Promise<{ results: MicrosoftAdPerformance[]; error?: string }> {
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) return { results: [], error: "期間の形式が正しくありません" };
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1;
  if (!(days >= 1)) return { results: [], error: "終了日は開始日以降にしてください" };
  if (days > MAX_RANGE_DAYS) return { results: [], error: `期間は${MAX_RANGE_DAYS}日以内にしてください` };

  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user || user.is_anonymous) return { results: [], error: "ログインしてください" };
  const creds = await getAdCredentials(user.id, "microsoft");
  if (!creds) return { results: [], error: "Microsoft 広告と連携してください" };

  const raw = (creds.meta as { selected?: unknown }).selected;
  const selected = (Array.isArray(raw) ? raw : []).filter(
    (x): x is { id: string; name: string; customerId: string } =>
      !!x && typeof (x as { id?: unknown }).id === "string" && (x as { id: string }).id.length > 0
  );
  if (selected.length === 0) return { results: [], error: "分析する広告アカウントを選んで保存してください" };

  const results = await Promise.all(
    selected.map(async (account): Promise<MicrosoftAdPerformance> => {
      const acc = { id: account.id, name: account.name };
      try {
        const m = await fetchMicrosoftCampaignMetrics(creds.accessToken, account.id, account.customerId, from, to);
        return { account: acc, ...m };
      } catch (e) {
        return { account: acc, campaigns: [], daily: [], error: e instanceof Error ? e.message : String(e) };
      }
    })
  );
  return { results };
}
