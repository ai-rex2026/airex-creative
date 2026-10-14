"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkGuard } from "@/lib/guardrail";
import { isSnsPlatform } from "@/lib/social-connect/platforms";
import { deleteOwnCreds, saveOwnCreds } from "@/lib/social-connect/app-creds";
import { defaultImageDeps, fillImages } from "@/lib/aio/images";
import { loadSettings } from "@/lib/sns-ops/store";
import { OPS_POST_COLUMNS, rowToOpsPost } from "@/lib/sns-ops/ops-store";
import { lengthWarnings } from "@/lib/sns-ops/x-brain";
import { xIntentUrl } from "@/lib/sns-ops/x-api";
import type { OpsMedia, XOpsConfig } from "@/lib/sns-ops/ops-types";
import { sendApprovedMedia } from "@/lib/sns-ops/media-run";
import { SNS_MEDIA_BUCKET, sendApproved, stripAspect, stepBench, stepDms, stepDrafts, stepEngage, stepImages, stepOwn, stepPatterns, stepSearch } from "@/lib/sns-ops/x-run";

/**
 * SNS運用（媒体ごと）の Server Action。1回目は X 運用と、各社のアプリの鍵の登録。
 * 送るのは人が承認した案だけ（AGENTS.md）。他人へのリプライ・引用で X の規約上 API から送れないものは、
 * X の投稿画面（本文入り）を開く URL を返し、人が送る。
 */

async function me() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) throw new Error("ログインが必要です");
  if (user.is_anonymous) throw new Error("SNS運用を使うには、先に無料登録してください");
  return { sb, userId: user.id };
}

const refresh = () => revalidatePath("/sns", "layout");
const now = () => new Date().toISOString();

// ── 各社のアプリの鍵 ─────────────────────

export async function saveAppKeysAction(platform: string, input: { clientId: string; clientSecret: string; configId?: string }) {
  const { userId } = await me();
  if (!isSnsPlatform(platform)) throw new Error("未対応の媒体です");
  if (!input.clientId.trim() || input.clientSecret.trim().length < 8) throw new Error("アプリの ID とシークレットを入れてください");
  await saveOwnCreds(userId, platform, input);
  revalidatePath("/sns", "layout");
}

export async function deleteAppKeysAction(platform: string) {
  const { userId } = await me();
  if (!isSnsPlatform(platform)) throw new Error("未対応の媒体です");
  await deleteOwnCreds(userId, platform);
  revalidatePath("/sns", "layout");
}

// ── X 運用の設定 ─────────────────────

export async function saveXOpsAction(input: { enabled: boolean; config: XOpsConfig }) {
  const { sb, userId } = await me();
  const handles = input.config.benchHandles.map((h) => h.trim().replace(/^@/, "").replace(/^https?:\/\/(x|twitter)\.com\//, "").split(/[/?]/)[0]).filter((h) => /^[A-Za-z0-9_]{1,15}$/.test(h));
  const config: XOpsConfig = {
    benchHandles: [...new Set(handles)].slice(0, 10),
    keywords: input.config.keywords.map((k) => k.trim()).filter(Boolean).slice(0, 5),
    dailyDrafts: Math.max(0, Math.min(10, Math.round(input.config.dailyDrafts))),
    dailyEngage: Math.max(0, Math.min(10, Math.round(input.config.dailyEngage))),
    rules: input.config.rules.slice(0, 1000),
  };
  const { error } = await sb.from("sns_ops_settings").upsert({ user_id: userId, platform: "x", enabled: input.enabled, config, updated_at: now() }, { onConflict: "user_id,platform" });
  if (error) throw new Error(`保存できませんでした：${error.message}`);
  refresh();
  return config;
}

/** 工程を手で動かす（毎日の自動と同じ処理。Apify は1日の上限を共有する） */
export async function runXStepAction(step: "collect" | "own" | "patterns" | "drafts" | "images" | "engage" | "dms", opt: { count?: number; theme?: string; postId?: string } = {}): Promise<string> {
  const { sb, userId } = await me();
  const admin = createAdminClient();
  let msg: string;
  if (step === "collect") {
    const parts = await Promise.allSettled([stepBench(sb, admin, userId), stepSearch(sb, admin, userId)]);
    msg = parts.map((p) => (p.status === "fulfilled" ? p.value : `失敗：${p.reason instanceof Error ? p.reason.message : String(p.reason)}`)).join("／");
  } else if (step === "own") msg = await stepOwn(sb, userId);
  else if (step === "patterns") msg = await stepPatterns(sb, userId);
  else if (step === "drafts") {
    msg = await stepDrafts(sb, userId, { count: opt.count ?? 3, theme: opt.theme?.slice(0, 300) });
    // 画像は続けて作る（時間が足りなければ、画面の「画像を作る」で続きから）
    msg += `。${await stepImages(sb, admin, userId, { deadline: Date.now() + 150_000 })}`;
  } else if (step === "images") msg = await stepImages(sb, admin, userId, { postId: opt.postId, deadline: Date.now() + 240_000 });
  else if (step === "engage") msg = await stepEngage(sb, userId, { count: opt.count ?? 5 });
  else msg = await stepDms(sb, userId);
  refresh();
  return msg;
}

// ── 案の編集・承認・送信 ─────────────────────

async function loadOwned(sb: Awaited<ReturnType<typeof createClient>>, userId: string, id: string) {
  const { data } = await sb.from("sns_posts").select(OPS_POST_COLUMNS).eq("id", id).eq("user_id", userId).maybeSingle();
  if (!data) throw new Error("案が見つかりません");
  return rowToOpsPost(data as Record<string, unknown>);
}

/** 人が直した文面を保存する。保存と同時に表現チェックをやり直す */
export async function updateOpsPostAction(id: string, patch: { body: string; thread: string[]; hashtags: string[] }) {
  const { sb, userId } = await me();
  const post = await loadOwned(sb, userId, id);
  if (post.status === "published") throw new Error("送信済みの案は直せません");
  const body = patch.body.trim().slice(0, 1000);
  const thread = patch.thread.map((t) => t.trim()).filter(Boolean).slice(0, 6);
  const hashtags = patch.hashtags.map((h) => h.replace(/^#/, "").trim()).filter(Boolean).slice(0, 5);
  if (!body && post.kind !== "repost") throw new Error("本文を入れてください");
  const brand = await loadSettings(sb, userId);
  const guard = body ? await checkGuard([body, ...thread], brand.industry) : { level: "green" as const, hits: [] };
  const warn = post.platform === "x" ? lengthWarnings(body, thread, hashtags) : [];
  const { error } = await sb
    .from("sns_posts")
    .update({ body, thread, hashtags, guard, reason: [post.reason.split(" / ")[0], ...warn].filter(Boolean).join(" / "), status: post.status === "approved" ? "draft" : post.status, updated_at: now() })
    .eq("id", id);
  if (error) throw new Error(`保存できませんでした：${error.message}`);
  refresh();
  return guard.level;
}

export type ApproveResult = { id: string; result: "published" | "scheduled" | "needs_human" | "error"; message?: string; intentUrl?: string };

/**
 * まとめて承認する。sendNow なら続けて送る（1件ずつ。失敗しても他は続ける）。scheduledAt なら予約（30分おきの自動で送る）。
 * 「要修正」の案・文字数オーバーの案は承認しない
 */
export async function approveOpsPostsAction(ids: string[], opt: { sendNow: boolean; scheduledAt?: string | null }): Promise<ApproveResult[]> {
  const { sb, userId } = await me();
  const admin = createAdminClient();
  const out: ApproveResult[] = [];
  const started = Date.now();
  for (const id of ids.slice(0, 30)) {
    try {
      const post = await loadOwned(sb, userId, id);
      if (post.status === "published") {
        out.push({ id, result: "published" });
        continue;
      }
      if (post.guard?.level === "red") throw new Error("表現チェックで「要修正」が残っています。直してから承認してください");
      if (post.platform === "x" && post.kind !== "repost" && post.kind !== "dm" && lengthWarnings(post.body, post.thread, post.hashtags).length) throw new Error("X の文字数の上限を超えています。直してから承認してください");
      if (post.media.some((m) => m.type === "image" && !m.path && !m.hasText && !m.error)) throw new Error("画像がまだできていません。画像を作ってから承認してください");
      const human = (post.kind === "reply" || post.kind === "quote") && !post.target?.summoned;
      const scheduledAt = human ? null : !opt.sendNow && opt.scheduledAt ? new Date(opt.scheduledAt).toISOString() : opt.sendNow ? null : now();
      await sb.from("sns_posts").update({ status: "approved", approved_at: now(), approved_by: userId, scheduled_at: scheduledAt, error_message: null, updated_at: now() }).eq("id", id);
      if (human) {
        // X の規約で API から送れない相手：X の投稿画面（本文入り）を開いて人が送る
        out.push({ id, result: "needs_human", intentUrl: xIntentUrl({ text: post.body, replyTo: post.kind === "reply" ? post.target?.externalId : null, quoteUrl: post.kind === "quote" ? post.target?.url : null }) });
        continue;
      }
      if (!opt.sendNow) {
        out.push({ id, result: "scheduled" });
        continue;
      }
      if (Date.now() - started > 220_000) {
        await sb.from("sns_posts").update({ scheduled_at: now() }).eq("id", id);
        out.push({ id, result: "scheduled", message: "時間の都合で、30分以内の自動送信に回しました" });
        continue;
      }
      const r = post.platform === "x" ? await sendApproved(sb, admin, userId, id) : await sendApprovedMedia(sb, admin, userId, id);
      if (r === "needs_human") {
        out.push({ id, result: "needs_human", intentUrl: xIntentUrl({ text: post.body, replyTo: post.kind === "reply" ? post.target?.externalId : null, quoteUrl: post.kind === "quote" ? post.target?.url : null }) });
      } else if (r === "processing") {
        await sb.from("sns_posts").update({ scheduled_at: now() }).eq("id", id);
        out.push({ id, result: "scheduled", message: "媒体側で処理中です。30分以内の自動で続きを送ります" });
      } else out.push({ id, result: "published" });
    } catch (e) {
      out.push({ id, result: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }
  refresh();
  return out;
}

/** X の画面から人が送った（API で送れない相手へのリプライ・引用） */
export async function markHumanSentAction(id: string) {
  const { sb, userId } = await me();
  await loadOwned(sb, userId, id);
  await sb.from("sns_posts").update({ status: "published", published_via: "copy", published_at: now(), updated_at: now() }).eq("id", id).eq("user_id", userId);
  refresh();
}

export async function skipOpsPostsAction(ids: string[]) {
  const { sb, userId } = await me();
  await sb.from("sns_posts").update({ status: "skipped", updated_at: now() }).in("id", ids.slice(0, 100)).eq("user_id", userId).in("status", ["draft", "approved", "failed"]);
  refresh();
}

/** 承認を取り消す（予約を止める） */
export async function unapproveOpsPostAction(id: string) {
  const { sb, userId } = await me();
  await sb.from("sns_posts").update({ status: "draft", scheduled_at: null, updated_at: now() }).eq("id", id).eq("user_id", userId).eq("status", "approved");
  refresh();
}

// ── 画像 ─────────────────────

export async function regenerateOpsImageAction(id: string, key: string, prompt?: string) {
  const { sb, userId } = await me();
  const post = await loadOwned(sb, userId, id);
  const t = post.media.find((m) => m.key === key);
  if (!t) throw new Error("画像が見つかりません");
  const regen = (t.regen ?? 0) + 1;
  if (regen > 5) throw new Error("この画像は作り直しの上限（5回）に達しました");
  const media = post.media.map((m) => (m.key === key ? { ...m, prompt: prompt?.trim() ? prompt.trim().slice(0, 600) : m.prompt, path: null, hasText: false, error: null, regen } : m));
  await sb.from("sns_posts").update({ media, media_ids: {}, updated_at: now() }).eq("id", id);
  const admin = createAdminClient();
  const r = await fillImages(defaultImageDeps(admin, SNS_MEDIA_BUCKET), `${userId}/${id}`, media.map((m) => ({ ...m, aspect: post.platform === "meta" ? "4:5" : "16:9" })), async (next) => {
    await sb.from("sns_posts").update({ media: next.map(stripAspect), updated_at: now() }).eq("id", id);
  });
  refresh();
  if (r.failed) throw new Error("画像を作れませんでした。説明を変えてもう一度お試しください");
}

/** 案に画像を足す：AI で作る（説明から） */
export async function addOpsImageAction(id: string, prompt: string, alt: string) {
  const { sb, userId } = await me();
  const post = await loadOwned(sb, userId, id);
  if (post.media.length >= (post.platform === "x" ? 4 : 10)) throw new Error(`画像は${post.platform === "x" ? 4 : 10}枚までです`);
  const media: OpsMedia[] = [...post.media, { key: `img${Date.now()}`, type: "image", path: null, prompt: prompt.slice(0, 600), alt: alt.slice(0, 80) }];
  await sb.from("sns_posts").update({ media, updated_at: now() }).eq("id", id);
  await stepImages(sb, createAdminClient(), userId, { postId: id, deadline: Date.now() + 200_000, platform: post.platform, aspect: post.platform === "meta" ? "4:5" : "16:9" });
  refresh();
}

/** 手持ちの画像を使う：Storage へ直接アップロードするための署名つき URL を返す（本文の大きさの上限を避ける） */
export async function createOpsUploadAction(id: string, mime: string): Promise<{ path: string; token: string }> {
  const { sb, userId } = await me();
  await loadOwned(sb, userId, id);
  if (!/^image\/(png|jpeg|webp|gif)$/.test(mime)) throw new Error("画像（PNG・JPEG・WebP・GIF）を選んでください");
  const ext = mime.split("/")[1].replace("jpeg", "jpg");
  const path = `${userId}/${id}/upload-${Date.now()}.${ext}`;
  const { data, error } = await createAdminClient().storage.from(SNS_MEDIA_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new Error(`アップロードの準備ができませんでした：${error?.message ?? ""}`);
  return { path, token: data.token };
}

export async function attachOpsUploadAction(id: string, path: string, alt: string) {
  const { sb, userId } = await me();
  const post = await loadOwned(sb, userId, id);
  if (!path.startsWith(`${userId}/${id}/upload-`)) throw new Error("この画像は使えません");
  if (post.media.length >= (post.platform === "x" ? 4 : 10)) throw new Error(`画像は${post.platform === "x" ? 4 : 10}枚までです`);
  const { data } = await createAdminClient().storage.from(SNS_MEDIA_BUCKET).list(`${userId}/${id}`, { search: path.split("/").pop() });
  if (!data?.length) throw new Error("アップロードした画像が見つかりません");
  const media: OpsMedia[] = [...post.media, { key: `up${Date.now()}`, type: "image", path, prompt: "", alt: alt.slice(0, 80) }];
  await sb.from("sns_posts").update({ media, updated_at: now() }).eq("id", id);
  refresh();
}

export async function removeOpsMediaAction(id: string, key: string) {
  const { sb, userId } = await me();
  const post = await loadOwned(sb, userId, id);
  if (post.status === "published") throw new Error("送信済みです");
  await sb.from("sns_posts").update({ media: post.media.filter((m) => m.key !== key), updated_at: now() }).eq("id", id);
  refresh();
}
