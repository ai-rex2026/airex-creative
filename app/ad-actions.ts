"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdPlatform, type AdPlatform } from "@/lib/ads/platforms";
import { getAdCredentials } from "@/lib/ads/tokens";
import {
  isCustomerId,
  listAccessibleCustomers,
  listChildCustomers,
  verifyClients,
} from "@/lib/ads/google";
import { yahooChildAccounts } from "@/lib/ads/yahoo";
import { microsoftUserId, microsoftSearchAccounts } from "@/lib/ads/microsoft";

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
 * 「操作対象のビジネスIDが直接権限を持つアカウント」だけのフラットな一覧で、
 * MCC の配下に複数の広告アカウントがひもづいていてもそこには出てこない
 * （本番で確認済み）。Google と同じ「MCC を開いて配下を取りに行く」操作を持たせ、
 * 配下は AccountLinkService/get（x-z-base-account-id ヘッダーで MCC を指定）で
 * 都度取得する（lib/ads/yahoo.ts の yahooChildAccounts。本番で配下の列挙自体は
 * 成功することを確認済み。名前の引き直しが失敗する子アカウントがある場合は
 * nameLookupError に診断メッセージが入るので、それを note として画面に出す）。
 * ------------------------------------------------------------------ */

export type YahooPickerAccount = { id: string; name: string; manager: boolean };
export type YahooSelection = { id: string; name: string; mccId: string | null };

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
    ? v.filter(
        (x): x is YahooSelection =>
          !!x && typeof (x as YahooSelection).id === "string" && (x as YahooSelection).id.length > 0
      )
    : [];
}

/** 選択画面の最初の一覧（連携時に控えた MCC・広告アカウント）と、保存済みの選択 */
export async function yahooAccountPicker(): Promise<
  { connected: false } | { connected: true; accounts: YahooPickerAccount[]; selected: YahooSelection[] }
> {
  const y = await yahooCreds();
  if (!y) return { connected: false };
  return {
    connected: true,
    accounts: y.creds.accounts.map((a) => ({ id: a.id, name: a.name, manager: !!a.manager })),
    selected: readYahooSelected(y.creds.meta),
  };
}

/** MCC を開いたときに、配下のアカウントを返す。note は名前の引き直しが一部/全部失敗した場合の診断メッセージ（配下の一覧自体は取れている） */
export async function yahooChildAccountsAction(
  mccId: string
): Promise<{ accounts: YahooPickerAccount[]; error?: string; note?: string }> {
  if (typeof mccId !== "string" || !mccId) return { accounts: [], error: "アカウントIDが正しくありません" };
  const y = await yahooCreds();
  if (!y) return { accounts: [], error: "ヤフーLINE広告と連携してください" };
  if (!y.creds.accounts.some((a) => a.id === mccId && a.manager)) {
    return { accounts: [], error: "MCCアカウントが見つかりません" };
  }
  try {
    const { accounts, nameLookupError } = await yahooChildAccounts(y.creds.accessToken, mccId);
    return {
      accounts: accounts.map((a) => ({ id: a.id, name: a.name, manager: !!a.manager })),
      note: nameLookupError,
    };
  } catch (e) {
    return { accounts: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/** 選んだ広告アカウントを保存する。直下の選択は連携時の一覧、MCC配下の選択はその場で MCC に確かめてから保存 */
export async function saveYahooSelection(
  picks: { id: string; mccId: string | null }[]
): Promise<{ selected: YahooSelection[] } | { error: string }> {
  const y = await yahooCreds();
  if (!y) return { error: "ヤフーLINE広告と連携してください" };
  if (!Array.isArray(picks) || picks.length > MAX_SELECTED_YAHOO) {
    return { error: `選べるのは${MAX_SELECTED_YAHOO}件までです` };
  }
  for (const p of picks) {
    if (typeof p?.id !== "string" || !p.id) return { error: "アカウントIDが正しくありません" };
  }

  const byId = new Map(y.creds.accounts.map((a) => [a.id, a]));
  const out: YahooSelection[] = [];

  const byMcc = new Map<string, string[]>();
  for (const p of picks) {
    if (p.mccId === null) {
      const a = byId.get(p.id);
      if (!a) return { error: `アクセスできないアカウントが含まれています（${p.id}）` };
      if (a.manager) return { error: `MCC（管理者アカウント）は選べません。配下のアカウントを選んでください（${a.name}）` };
      out.push({ id: a.id, name: a.name, mccId: null });
    } else {
      if (!byId.get(p.mccId)?.manager) return { error: `MCCにアクセスできません（${p.mccId}）` };
      byMcc.set(p.mccId, [...(byMcc.get(p.mccId) ?? []), p.id]);
    }
  }
  for (const [mccId, ids] of byMcc) {
    let result: Awaited<ReturnType<typeof yahooChildAccounts>>;
    try {
      result = await yahooChildAccounts(y.creds.accessToken, mccId);
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
    const found = new Map(result.accounts.map((c) => [c.id, c]));
    for (const id of ids) {
      const c = found.get(id);
      if (!c) return { error: `MCC の配下にないアカウントが含まれています（${id}）` };
      if (c.manager) return { error: `MCC（管理者アカウント）は選べません。配下のアカウントを選んでください（${c.name}）` };
      out.push({ id: c.id, name: c.name, mccId });
    }
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

/* ------------------------------------------------------------------
 * Microsoft 広告：分析する広告アカウントの選択
 * SearchAccounts（lib/ads/microsoft.ts）が、このユーザーがアクセスできる広告アカウントを
 * すでにフラットな一覧で返す（MCC配下の展開が要らない）ため、Google/ヤフーLINE広告のような
 * 「MCC を開いて配下を辿る」操作は持たせず、一覧から直接チェックして保存するだけにする。
 * 実績取得（GetCampaignsByAccountId・Reporting Service）の CustomerId ヘッダーに使う
 * ParentCustomerId は連携時点ではキャッシュせず、保存のたびに Microsoft 側から取り直して
 * 検証する（Google の googleAccountPicker が listAccessibleCustomers を都度呼ぶのと同じ考え方）。
 * ------------------------------------------------------------------ */

export type MicrosoftPickerAccount = { id: string; name: string };
export type MicrosoftSelection = { id: string; name: string; customerId: string };

const MAX_SELECTED_MICROSOFT = 50;

async function microsoftCreds() {
  const user = await currentUser();
  if (!user || user.is_anonymous) return null;
  const creds = await getAdCredentials(user.id, "microsoft");
  return creds ? { user, creds } : null;
}

function readMicrosoftSelected(meta: Record<string, unknown>): MicrosoftSelection[] {
  const v = meta.selected;
  return Array.isArray(v)
    ? v.filter(
        (x): x is MicrosoftSelection =>
          !!x && typeof (x as MicrosoftSelection).id === "string" && (x as MicrosoftSelection).id.length > 0
      )
    : [];
}

/** 選択画面の一覧（本人がアクセスできる広告アカウント、フラット）と、保存済みの選択 */
export async function microsoftAccountPicker(): Promise<
  | { connected: false }
  | { connected: true; accounts: MicrosoftPickerAccount[]; selected: MicrosoftSelection[]; error?: string }
> {
  const m = await microsoftCreds();
  if (!m) return { connected: false };
  const selected = readMicrosoftSelected(m.creds.meta);
  try {
    const { id: userId } = await microsoftUserId(m.creds.accessToken);
    const accounts = await microsoftSearchAccounts(m.creds.accessToken, userId);
    return { connected: true, accounts: accounts.map((a) => ({ id: a.id, name: a.name })), selected };
  } catch (e) {
    return { connected: true, accounts: [], selected, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 選んだアカウントを保存する。Microsoft から一覧を取り直して含まれるか確かめ、CustomerId とあわせて保存 */
export async function saveMicrosoftSelection(
  picks: { id: string }[]
): Promise<{ selected: MicrosoftSelection[] } | { error: string }> {
  const m = await microsoftCreds();
  if (!m) return { error: "Microsoft 広告と連携してください" };
  if (!Array.isArray(picks) || picks.length > MAX_SELECTED_MICROSOFT) {
    return { error: `選べるのは${MAX_SELECTED_MICROSOFT}件までです` };
  }
  for (const p of picks) {
    if (typeof p?.id !== "string" || !p.id) return { error: "アカウントIDが正しくありません" };
  }

  try {
    const { id: userId } = await microsoftUserId(m.creds.accessToken);
    const accounts = await microsoftSearchAccounts(m.creds.accessToken, userId);
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const out: MicrosoftSelection[] = [];
    for (const p of picks) {
      const a = byId.get(p.id);
      if (!a) return { error: `アクセスできないアカウントが含まれています（${p.id}）` };
      out.push({ id: a.id, name: a.name, customerId: a.parentCustomerId });
    }

    const admin = createAdminClient();
    const meta = { ...m.creds.meta, selected: out };
    const { error } = await admin
      .from("ad_connections")
      .update({ meta, updated_at: new Date().toISOString() })
      .eq("user_id", m.user.id)
      .eq("platform", "microsoft");
    if (error) return { error: `保存できませんでした：${error.message}` };
    return { selected: out };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
