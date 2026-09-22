"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdPlatform, type AdPlatform } from "@/lib/ads/platforms";
import { getAdCredentials } from "@/lib/ads/tokens";
import type { AdAccount } from "@/lib/ads/accounts";
import {
  isCustomerId,
  listAccessibleCustomers,
  listChildCustomers,
  verifyClients,
} from "@/lib/ads/google";

/** 画面に出してよい形。トークンは含めない */
export type AdConnectionView = {
  platform: AdPlatform;
  connected_at: string;
  accounts: { id: string; name: string; manager?: boolean }[];
  note: string | null;
};

async function currentUser() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  return user;
}

/**
 * 連携済みの広告媒体。ad_connections は RLS で閉じているので、
 * ログイン中の本人の行だけを service role で読む。
 */
export async function adConnections(): Promise<AdConnectionView[]> {
  const user = await currentUser();
  if (!user || user.is_anonymous) return [];
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("ad_connections")
      .select("platform, connected_at, accounts, meta")
      .eq("user_id", user.id);
    return (data ?? [])
      .filter((r) => isAdPlatform(r.platform as string))
      .map((r) => ({
        platform: r.platform as AdPlatform,
        connected_at: r.connected_at as string,
        accounts: (r.accounts as { id: string; name: string; manager?: boolean }[]) ?? [],
        // 更新の失敗（再連携が必要）を、アカウント一覧の注記より優先して出す
        note: ((r.meta as { tokenError?: string; note?: string } | null)?.tokenError ?? (r.meta as { note?: string } | null)?.note) ?? null,
      }));
  } catch {
    // テーブル未作成などで設定画面ごと落とさない
    return [];
  }
}

/** 連携を解除する（保存したトークンを削除）。媒体側のアクセス許可は各媒体の設定から取り消せる */
export async function disconnectAd(platform: string) {
  const user = await currentUser();
  if (!user || !isAdPlatform(platform)) return;
  const admin = createAdminClient();
  await admin.from("ad_connections").delete().eq("user_id", user.id).eq("platform", platform);
}

/* ------------------------------------------------------------------
 * Google 広告：分析する広告アカウントの選択
 * 一覧 → （MCC を開いて）配下を展開 → 選択を保存。
 * MCC は実績を持たないので選べない（開くだけ）。選べるのは配下のアカウント。
 * ------------------------------------------------------------------ */

export type AdPickerAccount = { id: string; name: string; manager: boolean };
export type AdSelection = { id: string; name: string; loginCustomerId: string | null };

const MAX_SELECTED = 50;

async function googleCreds() {
  const user = await currentUser();
  if (!user || user.is_anonymous) return null;
  const creds = await getAdCredentials(user.id, "google");
  return creds ? { user, creds } : null;
}

function readSelected(meta: Record<string, unknown>): AdSelection[] {
  const v = meta.selected;
  return Array.isArray(v)
    ? v.filter((x): x is AdSelection => !!x && isCustomerId((x as AdSelection).id))
    : [];
}

/** 選択画面の最初の一覧（直接アクセスできるアカウント）と、保存済みの選択 */
export async function googleAccountPicker(): Promise<
  | { connected: false }
  | {
      connected: true;
      accounts: AdPickerAccount[];
      failed: { id: string; error: string }[];
      selected: AdSelection[];
      error?: string;
    }
> {
  const g = await googleCreds();
  if (!g) return { connected: false };
  const selected = readSelected(g.creds.meta);
  try {
    const { accounts, failed } = await listAccessibleCustomers(g.creds.accessToken);
    return { connected: true, accounts, failed, selected };
  } catch (e) {
    return { connected: true, accounts: [], failed: [], selected, error: e instanceof Error ? e.message : String(e) };
  }
}

/** MCC を開いたときに、配下のアカウントを返す。loginCustomerId は最上位の MCC */
export async function googleChildAccounts(
  parentId: string,
  loginCustomerId: string | null
): Promise<{ accounts: AdPickerAccount[]; error?: string }> {
  if (!isCustomerId(parentId) || (loginCustomerId !== null && !isCustomerId(loginCustomerId))) {
    return { accounts: [], error: "アカウントIDが正しくありません" };
  }
  const g = await googleCreds();
  if (!g) return { accounts: [], error: "Google 広告と連携してください" };
  try {
    return { accounts: await listChildCustomers(g.creds.accessToken, parentId, loginCustomerId) };
  } catch (e) {
    return { accounts: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/** 選んだアカウントを保存する。本人がアクセスできるアカウントかを、Google に確かめてから保存 */
export async function saveGoogleSelection(
  picks: { id: string; loginCustomerId: string | null }[]
): Promise<{ selected: AdSelection[] } | { error: string }> {
  const g = await googleCreds();
  if (!g) return { error: "Google 広告と連携してください" };
  if (!Array.isArray(picks) || picks.length > MAX_SELECTED) {
    return { error: `選べるのは${MAX_SELECTED}件までです` };
  }
  for (const p of picks) {
    if (!isCustomerId(p?.id) || (p.loginCustomerId !== null && !isCustomerId(p.loginCustomerId))) {
      return { error: "アカウントIDが正しくありません" };
    }
  }

  try {
    const token = g.creds.accessToken;
    const { accounts: direct } = await listAccessibleCustomers(token);
    const directById = new Map(direct.map((a) => [a.id, a]));
    const out: AdSelection[] = [];

    // MCC 配下：MCC ごとに、配下であることを確かめる
    const byLogin = new Map<string, string[]>();
    for (const p of picks) {
      if (p.loginCustomerId === null) {
        const a = directById.get(p.id);
        if (!a) return { error: `アクセスできないアカウントが含まれています（${p.id}）` };
        if (a.manager) return { error: `MCC（管理者アカウント）は選べません。配下のアカウントを選んでください（${a.name}）` };
        out.push({ id: a.id, name: a.name, loginCustomerId: null });
      } else {
        if (!directById.get(p.loginCustomerId)?.manager) {
          return { error: `MCC にアクセスできません（${p.loginCustomerId}）` };
        }
        byLogin.set(p.loginCustomerId, [...(byLogin.get(p.loginCustomerId) ?? []), p.id]);
      }
    }
    for (const [login, ids] of byLogin) {
      const found = await verifyClients(token, login, ids);
      for (const id of ids) {
        const c = found.get(id);
        if (!c) return { error: `MCC の配下にないアカウントが含まれています（${id}）` };
        if (c.manager) return { error: `MCC（管理者アカウント）は選べません。配下のアカウントを選んでください（${c.name}）` };
        out.push({ id, name: c.name, loginCustomerId: login });
      }
    }

    const admin = createAdminClient();
    const meta = { ...g.creds.meta, selected: out };
    const { error } = await admin
      .from("ad_connections")
      .update({ meta, updated_at: new Date().toISOString() })
      .eq("user_id", g.user.id)
      .eq("platform", "google");
    if (error) return { error: `保存できませんでした：${error.message}` };
    return { selected: out };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/* ------------------------------------------------------------------
 * ヤフーLINE広告：分析する広告アカウントの選択
 * BaseAccountService/get が連携直後に控える一覧（lib/ads/accounts.ts）は
 * すでにフラット（MCC・広告アカウントが1階層で並ぶ）なので、Google のような
 * 「MCC を開いて配下を取りに行く」操作はない。MCC は実績を持たないため選べない。
 * ------------------------------------------------------------------ */

export type YahooSelection = { id: string; name: string };

const MAX_SELECTED_YAHOO = 50;

async function yahooCreds() {
  const user = await currentUser();
  if (!user || user.is_anonymous) return null;
  const creds = await getAdCredentials(user.id, "yahoo");
  return creds ? { user, creds } : null;
}

function readYahooSelected(meta: Record<string, unknown>): YahooSelection[] {
  const v = meta.selected;
  return Array.isArray(v)
    ? v.filter((x): x is YahooSelection => !!x && typeof (x as YahooSelection).id === "string" && (x as YahooSelection).id.length > 0)
    : [];
}

/** 選択画面の一覧（連携時に控えた MCC・広告アカウント）と、保存済みの選択 */
export async function yahooAccountPicker(): Promise<
  { connected: false } | { connected: true; accounts: AdAccount[]; selected: YahooSelection[] }
> {
  const y = await yahooCreds();
  if (!y) return { connected: false };
  return { connected: true, accounts: y.creds.accounts, selected: readYahooSelected(y.creds.meta) };
}

/** 選んだ広告アカウントIDを保存する。連携時に控えた一覧にあるか（MCCでないか）を確かめてから保存 */
export async function saveYahooSelection(ids: string[]): Promise<{ selected: YahooSelection[] } | { error: string }> {
  const y = await yahooCreds();
  if (!y) return { error: "ヤフーLINE広告と連携してください" };
  if (!Array.isArray(ids) || ids.length > MAX_SELECTED_YAHOO) {
    return { error: `選べるのは${MAX_SELECTED_YAHOO}件までです` };
  }
  const byId = new Map(y.creds.accounts.map((a) => [a.id, a]));
  const out: YahooSelection[] = [];
  for (const id of ids) {
    if (typeof id !== "string") return { error: "アカウントIDが正しくありません" };
    const a = byId.get(id);
    if (!a) return { error: `アクセスできないアカウントが含まれています（${id}）` };
    if (a.manager) return { error: `MCC（管理者アカウント）は選べません。配下のアカウントを選んでください（${a.name}）` };
    out.push({ id: a.id, name: a.name });
  }

  const admin = createAdminClient();
  const meta = { ...y.creds.meta, selected: out };
  const { error } = await admin
    .from("ad_connections")
    .update({ meta, updated_at: new Date().toISOString() })
    .eq("user_id", y.user.id)
    .eq("platform", "yahoo");
  if (error) return { error: `保存できませんでした：${error.message}` };
  return { selected: out };
}
