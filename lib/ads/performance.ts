import { getAdCredentials } from "./tokens";
import { AD_PLATFORMS, type AdPlatform } from "./platforms";
import { fetchCampaignMetrics as fetchGoogle, isCustomerId } from "./google";
import { fetchCampaignMetrics as fetchYahoo } from "./yahoo";
import { fetchCampaignMetrics as fetchMicrosoft } from "./microsoft";
import { fetchCampaignMetrics as fetchMeta } from "./meta";
import { fetchCampaignMetrics as fetchX } from "./x";
import { fetchCampaignMetrics as fetchTiktok } from "./tiktok";

/**
 * 分析の工程（lib/analysis.ts）から、利用者が連携して選んだ広告アカウントの実績をまとめて読む（読み取りのみ）。
 *
 * 2026-10-06 新設。画面から呼ぶ app/ad-performance-actions.ts は「ログイン中の本人」の実績しか読めない
 * （サーバーアクションなので、利用者IDを引数で受け取る形にすると外から他人のIDで呼べてしまう）。
 * 分析の工程はログインの無いところ（cron・after）で動くので、ここに利用者IDで読む版を置く。
 * このファイルは "use server" にしない（ブラウザから呼べる関数にしない）。
 * 選んだアカウントの扱い（meta.selected の検証）は app/ad-performance-actions.ts と同じ。
 */

export type AdCampaignRow = {
  name: string;
  status?: string;
  cost: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionsValue: number;
};

export type AdAccountPerf = {
  platform: AdPlatform;
  platformName: string;
  accountId: string;
  accountName: string;
  campaigns: AdCampaignRow[];
  error?: string;
};

export type AdPerfCollection = {
  /** 連携している媒体（アカウントを選んでいなくても含む） */
  connected: AdPlatform[];
  /** 選んだアカウントごとの実績 */
  accounts: AdAccountPerf[];
};

/** 1媒体の取得にかける上限。返らない媒体があっても分析全体を止めない */
const PER_PLATFORM_MS = 60_000;

type Sel = { id: string; name: string; [k: string]: unknown };

function selectedOf(meta: Record<string, unknown>): Sel[] {
  const raw = (meta as { selected?: unknown }).selected;
  return (Array.isArray(raw) ? raw : []).filter(
    (x): x is Sel => !!x && typeof (x as { id?: unknown }).id === "string" && (x as { id: string }).id.length > 0
  );
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error("時間内に実績を取得できませんでした")), ms)),
  ]);
}

async function onePlatform(userId: string, platform: AdPlatform, from: string, to: string): Promise<AdAccountPerf[] | null> {
  const creds = await getAdCredentials(userId, platform);
  if (!creds) return null;
  const name = AD_PLATFORMS.find((p) => p.id === platform)?.name ?? platform;
  const selected = selectedOf(creds.meta);
  const fetchOne = (s: Sel): Promise<{ campaigns: AdCampaignRow[] }> => {
    switch (platform) {
      case "google": {
        const login = (s.loginCustomerId ?? null) as string | null;
        if (!isCustomerId(s.id) || (login !== null && !isCustomerId(login))) throw new Error("アカウントIDの形式が正しくありません");
        return fetchGoogle(creds.accessToken, s.id, login, from, to);
      }
      case "yahoo":
        return fetchYahoo(creds.accessToken, s.id, (s.mccId ?? null) as string | null, from, to);
      case "microsoft":
        return fetchMicrosoft(creds.accessToken, s.id, String(s.customerId ?? ""), from, to);
      case "meta":
        return fetchMeta(creds.accessToken, s.id, from, to);
      case "x":
        if (!creds.tokenSecret) throw new Error("連携情報が壊れています。もう一度連携し直してください");
        return fetchX(creds.accessToken, creds.tokenSecret, s.id, from, to);
      case "tiktok":
        return fetchTiktok(creds.accessToken, s.id, from, to);
    }
  };
  const settled = await Promise.allSettled(selected.map((s) => withTimeout(Promise.resolve().then(() => fetchOne(s)), PER_PLATFORM_MS)));
  return selected.map((s, i) => {
    const r = settled[i];
    const base = { platform, platformName: name, accountId: s.id, accountName: s.name };
    if (r.status === "rejected") {
      return { ...base, campaigns: [], error: r.reason instanceof Error ? r.reason.message : String(r.reason) };
    }
    return {
      ...base,
      campaigns: (r.value.campaigns ?? []).map((c) => ({
        name: c.name,
        status: c.status,
        cost: c.cost,
        impressions: c.impressions,
        clicks: c.clicks,
        conversions: c.conversions,
        conversionsValue: c.conversionsValue,
      })),
    };
  });
}

/** 連携しているすべての媒体について、選んだアカウントの実績を読む。1媒体の失敗は他に影響させない */
export async function collectAdPerformance(userId: string, from: string, to: string): Promise<AdPerfCollection> {
  const ids = AD_PLATFORMS.map((p) => p.id);
  const settled = await Promise.allSettled(ids.map((p) => onePlatform(userId, p, from, to)));
  const connected: AdPlatform[] = [];
  const accounts: AdAccountPerf[] = [];
  settled.forEach((r, i) => {
    if (r.status === "rejected") {
      // 連携情報の読み出し自体に失敗した（トークン更新の失敗など）。連携はしているものとして扱う
      connected.push(ids[i]);
      accounts.push({
        platform: ids[i],
        platformName: AD_PLATFORMS[i].name,
        accountId: "",
        accountName: "",
        campaigns: [],
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      });
      return;
    }
    if (r.value === null) return;
    connected.push(ids[i]);
    accounts.push(...r.value);
  });
  return { connected, accounts };
}
