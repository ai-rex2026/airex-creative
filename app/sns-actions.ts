"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isSnsPlatform, type SnsPlatform } from "@/lib/social-connect/platforms";
import { snsConnectionsFor } from "@/lib/social-connect/tokens";
import { canPublishViaApi, composeBody, publishToX } from "@/lib/sns-ops/publish";
import { insertDrafts, listPosts, loadSettings, saveSettings } from "@/lib/sns-ops/store";
import { draftSnsPosts } from "@/lib/sns-ops/writer";
import { checkGuard } from "@/lib/guardrail";
import type { SnsAccount, SnsPost, SnsSettings } from "@/lib/sns-ops/types";
import type { Industry } from "@/lib/types";

/**
 * SNS運用（/sns）の Server Action。
 * 投稿案の生成・編集・（人が確認したうえでの）投稿・自動運用の設定。
 * sns_posts / sns_settings は本人のセッション（RLS）で読み書きする。
 * 連携トークンに触るのは publishToX（service role）だけ。
 */

async function me() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) throw new Error("ログインが必要です");
  if (user.is_anonymous) throw new Error("SNS運用を使うには、先に無料登録してください");
  return { sb, user };
}

const refresh = () => revalidatePath("/sns");

/** 設定画面で連携したアカウントと、投稿に使える方法 */
export async function snsAccountsAction(): Promise<SnsAccount[]> {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user || user.is_anonymous) return [];
  try {
    const rows = await snsConnectionsFor(user.id);
    return rows
      .filter((r) => isSnsPlatform(r.platform))
      .map((r) => {
        const profile = (r.profile as Record<string, unknown>) ?? {};
        const label = (profile.username as string | undefined) ?? (profile.displayName as string | undefined) ?? (profile.name as string | undefined) ?? null;
        const f = (profile.followers ?? profile.followerCount) as unknown;
        const pub = canPublishViaApi(r.platform as SnsPlatform, r.scope);
        return {
          platform: r.platform as SnsPlatform,
          label,
          followers: typeof f === "number" ? f : null,
          connectedAt: r.connected_at,
          canPublishViaApi: pub.ok,
          publishNote: pub.note,
        };
      });
  } catch {
    return [];
  }
}

export async function snsPostsAction(): Promise<SnsPost[]> {
  const { sb, user } = await me();
  return listPosts(sb, user.id);
}

export async function snsSettingsAction(): Promise<SnsSettings> {
  const { sb, user } = await me();
  return loadSettings(sb, user.id);
}

export async function saveSnsSettingsAction(input: SnsSettings) {
  const { sb, user } = await me();
  const industries: Industry[] = ["beauty", "medical", "supplement", "finance", "general"];
  await saveSettings(sb, user.id, {
    autoEnabled: !!input.autoEnabled,
    autoWeekday: Number(input.autoWeekday) || 0,
    brandName: String(input.brandName ?? "").trim(),
    brandUrl: String(input.brandUrl ?? "").trim(),
    brandNotes: String(input.brandNotes ?? "").trim(),
    industry: industries.includes(input.industry) ? input.industry : "general",
  });
  refresh();
}

/** テーマから、選んだ媒体ごとの投稿案を作って下書きに保存する */
export async function generateSnsDraftsAction(topic: string, platforms: string[]): Promise<{ topicId: string; count: number }> {
  const { sb, user } = await me();
  const t = topic.trim();
  if (!t) throw new Error("テーマを入力してください");
  const connected = new Set((await snsConnectionsFor(user.id)).map((r) => r.platform));
  const targets = platforms.filter(isSnsPlatform).filter((p) => connected.has(p));
  if (!targets.length) throw new Error("投稿先の媒体を選んでください（設定で連携した媒体だけ選べます）");
  const settings = await loadSettings(sb, user.id);
  const drafts = await draftSnsPosts(t, targets, settings);
  const topicId = await insertDrafts(sb, user.id, t, drafts, "manual");
  refresh();
  return { topicId, count: drafts.length };
}

/** 本文・ハッシュタグを直す。直した文面で法令チェックをやり直す（生成と同時の原則を編集後も保つ） */
export async function updateSnsPostAction(postId: string, body: string, hashtags: string[]) {
  const { sb, user } = await me();
  const b = body.trim();
  if (!b) throw new Error("本文を入力してください");
  const settings = await loadSettings(sb, user.id);
  const guard = await checkGuard([b], settings.industry);
  const tags = hashtags.map((h) => h.trim().replace(/^#/, "").replace(/\s+/g, "")).filter(Boolean).slice(0, 10);
  const { error } = await sb.from("sns_posts").update({ body: b, hashtags: tags, guard, updated_at: new Date().toISOString() }).eq("id", postId).eq("user_id", user.id);
  if (error) throw new Error(`保存できませんでした：${error.message}`);
  refresh();
  return guard;
}

/** 人が確認した投稿を X に送る（API 投稿できる媒体は今は X だけ） */
export async function publishSnsPostAction(postId: string) {
  const { sb, user } = await me();
  const { data } = await sb.from("sns_posts").select("platform, body, hashtags, guard, status").eq("id", postId).eq("user_id", user.id).maybeSingle();
  if (!data) throw new Error("投稿が見つかりません");
  if (data.status === "published") throw new Error("すでに投稿済みです");
  if (data.platform !== "x") throw new Error("この媒体は API で投稿できません。文面をコピーしてアプリから投稿してください");
  const guard = data.guard as { level?: string } | null;
  if (guard?.level === "red") throw new Error("法令チェックで赤の指摘があります。本文を直してから投稿してください");

  const text = composeBody(String(data.body ?? ""), Array.isArray(data.hashtags) ? (data.hashtags as unknown[]).map(String) : []);
  try {
    const id = await publishToX(user.id, text);
    await sb.from("sns_posts").update({ status: "published", published_via: "api", external_id: id, error_message: null, published_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", postId).eq("user_id", user.id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sb.from("sns_posts").update({ error_message: msg.slice(0, 500), updated_at: new Date().toISOString() }).eq("id", postId).eq("user_id", user.id);
    refresh();
    throw e;
  }
  refresh();
}

/** コピーして各アプリから投稿したものを「投稿済み」にする */
export async function markSnsPostPublishedAction(postId: string) {
  const { sb, user } = await me();
  const { error } = await sb.from("sns_posts").update({ status: "published", published_via: "copy", published_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", postId).eq("user_id", user.id);
  if (error) throw new Error(`更新できませんでした：${error.message}`);
  refresh();
}

/** 使わない案を片付ける */
export async function skipSnsPostAction(postId: string) {
  const { sb, user } = await me();
  await sb.from("sns_posts").update({ status: "skipped", updated_at: new Date().toISOString() }).eq("id", postId).eq("user_id", user.id);
  refresh();
}

export async function deleteSnsPostAction(postId: string) {
  const { sb, user } = await me();
  await sb.from("sns_posts").delete().eq("id", postId).eq("user_id", user.id);
  refresh();
}
