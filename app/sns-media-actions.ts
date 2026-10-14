"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkGuard } from "@/lib/guardrail";
import { defaultImageDeps, makeOne } from "@/lib/aio/images";
import { loadSettings } from "@/lib/sns-ops/store";
import { MEDIA_BUCKET, defaultImportDeps, gbpItems, igItems, importItems, xItems } from "@/lib/sns-ops/materials";
import { igDms, igPostIdeas, loadMediaConfig, mediaCollect, mediaComments, mediaOwn, mediaPatterns, videoIdeas, type MediaOpsConfig } from "@/lib/sns-ops/media-run";
import type { MediaPlatform } from "@/lib/sns-ops/media-brain";
import { VIDEO_COLUMNS, createVideoDraft, defaultPrepareDeps, defaultVideoPublishDeps, prepareVideo, publishVideo, rowToVideo, type PrepareProgress } from "@/lib/sns-ops/video-run";
import { VOICES } from "@/lib/sns-ops/video-types";
import type { VideoFormat, VideoPlatform, VideoScene } from "@/lib/sns-ops/video-types";

/**
 * Instagram・TikTok・YouTube の運用と、動画づくりの Server Action。
 * 送るのは人が承認したものだけ（AGENTS.md）。動画の書き出しは画面（ブラウザ）で行い、ここでは
 * 台本・画像・ナレーションの準備と、書き出した動画の受け取り・承認・送信を扱う。
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

const PLATFORMS: MediaPlatform[] = ["instagram", "tiktok", "youtube"];
const asPlatform = (p: string): MediaPlatform => {
  if (!PLATFORMS.includes(p as MediaPlatform)) throw new Error("未対応の媒体です");
  return p as MediaPlatform;
};
const refresh = () => revalidatePath("/sns", "layout");
const now = () => new Date().toISOString();

// ── 設定・工程 ─────────────────────

export async function saveMediaOpsAction(platformRaw: string, input: { enabled: boolean; config: MediaOpsConfig }) {
  const platform = asPlatform(platformRaw);
  const { sb, userId } = await me();
  const config: MediaOpsConfig = {
    benchHandles: [...new Set(input.config.benchHandles.map((h) => h.trim()).filter(Boolean))].slice(0, 10),
    dailyIdeas: Math.max(0, Math.min(3, Math.round(input.config.dailyIdeas))),
    voice: VOICES.some((v) => v.id === input.config.voice) ? input.config.voice : "Kore",
    longMinutes: Math.max(10, Math.min(20, Math.round(input.config.longMinutes))),
    rules: input.config.rules.slice(0, 1000),
  };
  const { error } = await sb.from("sns_ops_settings").upsert({ user_id: userId, platform, enabled: input.enabled, config, updated_at: now() }, { onConflict: "user_id,platform" });
  if (error) throw new Error(`保存できませんでした：${error.message}`);
  refresh();
}

export async function runMediaStepAction(platformRaw: string, step: "collect" | "own" | "patterns" | "posts" | "videos" | "comments" | "dms", opt: { count?: number; theme?: string; format?: VideoFormat } = {}): Promise<string> {
  const platform = asPlatform(platformRaw);
  const { sb, userId } = await me();
  const admin = createAdminClient();
  let msg: string;
  if (step === "collect") msg = await mediaCollect(sb, admin, userId, platform);
  else if (step === "own") msg = await mediaOwn(sb, userId, platform);
  else if (step === "patterns") msg = await mediaPatterns(sb, userId, platform);
  else if (step === "posts") {
    if (platform !== "instagram") throw new Error("フィード投稿は Instagram だけです");
    msg = await igPostIdeas(sb, admin, userId, Math.max(1, Math.min(5, opt.count ?? 2)), opt.theme);
  } else if (step === "videos") msg = await videoIdeas(sb, userId, platform, Math.max(1, Math.min(3, opt.count ?? 1)), { theme: opt.theme, format: opt.format });
  else if (step === "comments") {
    if (platform === "tiktok") throw new Error("TikTok のコメントへの返信は、TikTok の API では扱えません");
    msg = await mediaComments(sb, userId, platform);
  } else {
    if (platform !== "instagram") throw new Error("DM は Instagram だけです");
    msg = await igDms(sb, userId);
  }
  refresh();
  return msg;
}

// ── 素材 ─────────────────────

export async function importMaterialsAction(source: "gbp" | "x" | "instagram"): Promise<string> {
  const { sb, userId } = await me();
  const items = source === "gbp" ? await gbpItems(sb, userId) : source === "x" ? await xItems(userId) : await igItems(userId);
  const r = await importItems(sb, userId, source, items, defaultImportDeps(createAdminClient()), Date.now() + 230_000);
  refresh();
  return `${r.added}件を取り込みました${r.skipped ? `（取り込み済み${r.skipped}件）` : ""}${r.failed ? `（${r.failed}件は取り込めませんでした）` : ""}${items.length - r.added - r.skipped - r.failed > 0 ? "。残りはもう一度押すと続きを取り込みます" : ""}`;
}

/** 手持ちの写真・動画・書き出した動画のアップロード先（Storage に直接送る。大きいファイルは再開できる方式） */
async function signedUpload(path: string) {
  const { data, error } = await createAdminClient().storage.from(MEDIA_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new Error(`アップロードの準備ができませんでした：${error?.message ?? ""}`);
  return { path, token: data.token };
}

export async function createMaterialUploadAction(mime: string): Promise<{ path: string; token: string }> {
  const { userId } = await me();
  const m = /^(image\/(png|jpeg|webp)|video\/(mp4|quicktime))$/.exec(mime);
  if (!m) throw new Error("写真（PNG・JPEG・WebP）か動画（MP4・MOV）を選んでください");
  const ext = mime.split("/")[1].replace("jpeg", "jpg").replace("quicktime", "mov");
  return signedUpload(`${userId}/materials/upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`);
}

export async function attachMaterialAction(path: string, input: { kind: "image" | "video"; title: string; body: string; durationSec?: number | null }) {
  const { sb, userId } = await me();
  if (!path.startsWith(`${userId}/materials/upload-`)) throw new Error("この素材は使えません");
  const { error } = await sb.from("sns_materials").insert({ user_id: userId, kind: input.kind, source: "upload", path, title: input.title.slice(0, 200), body: input.body.slice(0, 2000), meta: input.durationSec ? { durationSec: input.durationSec } : {}, origin_id: path });
  if (error) throw new Error(`保存できませんでした：${error.message}`);
  refresh();
}

/** 事実・数字・話したいことのメモ（台本の根拠にする） */
export async function addTextMaterialAction(title: string, body: string) {
  const { sb, userId } = await me();
  if (!body.trim()) throw new Error("中身を入れてください");
  const { error } = await sb.from("sns_materials").insert({ user_id: userId, kind: "text", source: "note", title: title.trim().slice(0, 200), body: body.trim().slice(0, 4000) });
  if (error) throw new Error(`保存できませんでした：${error.message}`);
  refresh();
}

/** AI で素材の写真を作る（文字は描かせない） */
export async function aiMaterialAction(prompt: string, aspect: "9:16" | "16:9" | "4:5" | "1:1") {
  const { sb, userId } = await me();
  if (!prompt.trim()) throw new Error("どんな写真か入れてください");
  const r = await makeOne(defaultImageDeps(createAdminClient(), MEDIA_BUCKET), `${userId}/materials`, { key: `ai-${Date.now()}`, prompt: prompt.slice(0, 600), path: null, aspect });
  if (!("path" in r)) throw new Error("文字の入らない画像を作れませんでした。説明を変えてください");
  const { error } = await sb.from("sns_materials").insert({ user_id: userId, kind: "image", source: "ai", path: r.path, title: "AI で作った写真", body: prompt.slice(0, 600) });
  if (error) throw new Error(`保存できませんでした：${error.message}`);
  refresh();
}

export async function updateMaterialAction(id: string, title: string, body: string) {
  const { sb, userId } = await me();
  await sb.from("sns_materials").update({ title: title.slice(0, 200), body: body.slice(0, 4000) }).eq("id", id).eq("user_id", userId);
  refresh();
}

export async function deleteMaterialAction(id: string) {
  const { sb, userId } = await me();
  const { data } = await sb.from("sns_materials").select("path").eq("id", id).eq("user_id", userId).maybeSingle();
  await sb.from("sns_materials").delete().eq("id", id).eq("user_id", userId);
  if (data?.path) await createAdminClient().storage.from(MEDIA_BUCKET).remove([String(data.path)]).catch(() => undefined);
  refresh();
}

// ── 動画 ─────────────────────

async function loadVideo(sb: Awaited<ReturnType<typeof createClient>>, userId: string, id: string) {
  const { data } = await sb.from("sns_videos").select(VIDEO_COLUMNS).eq("id", id).eq("user_id", userId).maybeSingle();
  if (!data) throw new Error("動画が見つかりません");
  return rowToVideo(data as Record<string, unknown>);
}

export async function createVideoAction(platformRaw: string, input: { format: VideoFormat; theme: string; voice: string; minutes?: number }): Promise<string> {
  const platform = asPlatform(platformRaw) as VideoPlatform;
  const { sb, userId } = await me();
  if (platform !== "youtube" && input.format === "long") throw new Error("長尺の動画は YouTube だけです");
  const id = await createVideoDraft(sb, userId, { platform, format: input.format, theme: input.theme.slice(0, 300), voice: input.voice, minutes: input.minutes });
  refresh();
  return id;
}

/** 書き出しの準備（台本の残りの章・画像・ナレーション）を進める。画面は ready になるまで繰り返し呼ぶ */
export async function prepareVideoAction(id: string): Promise<PrepareProgress> {
  const { sb, userId } = await me();
  const r = await prepareVideo(sb, userId, id, defaultPrepareDeps(createAdminClient()), Date.now() + 250_000);
  refresh();
  return r;
}

/** 台本を直す。ナレーションを変えた場面は音声を作り直す。直したら表現チェックをやり直す */
export async function updateVideoAction(id: string, patch: { title: string; description: string; hashtags: string[]; scenes: Pick<VideoScene, "key" | "narration" | "caption" | "materialId" | "imagePrompt">[] }) {
  const { sb, userId } = await me();
  const v = await loadVideo(sb, userId, id);
  if (["approved", "published"].includes(v.status)) throw new Error("承認済み・送信済みの動画は直せません（承認を取り消してから直してください）");
  const byKey = new Map(patch.scenes.map((s) => [s.key, s]));
  const scenes = v.scenes
    .filter((s) => byKey.has(s.key))
    .map((s) => {
      const p = byKey.get(s.key)!;
      const narration = p.narration.trim().slice(0, 600);
      const changedVoice = narration !== s.narration;
      const changedVisual = p.materialId !== s.materialId || (p.imagePrompt ?? null) !== (s.imagePrompt ?? null);
      return {
        ...s,
        narration,
        caption: p.caption.trim().slice(0, 40),
        materialId: p.materialId,
        imagePrompt: p.materialId ? null : (p.imagePrompt ?? s.imagePrompt),
        audioPath: changedVoice ? null : s.audioPath,
        audioSec: changedVoice ? null : s.audioSec,
        imagePath: changedVisual ? null : s.imagePath,
        hasText: changedVisual ? false : s.hasText,
      };
    });
  const brand = await loadSettings(sb, userId);
  const texts = [patch.title, patch.description, ...scenes.map((s) => `${s.caption}\n${s.narration}`)];
  const chunks: string[][] = [];
  for (let i = 0; i < texts.length; i += 12) chunks.push(texts.slice(i, i + 12));
  const settled = await Promise.allSettled(chunks.map((c) => checkGuard(c, brand.industry)));
  const hits = settled.flatMap((r) => (r.status === "fulfilled" ? r.value.hits : []));
  const level = settled.some((r) => r.status === "fulfilled" && r.value.level === "red") ? "red" : settled.some((r) => r.status === "rejected") || hits.some((h) => h.severity !== "low") ? "yellow" : "green";
  const needsPrep = scenes.some((s) => !s.audioPath || (!s.materialId && !s.imagePath));
  const { error } = await sb
    .from("sns_videos")
    .update({ title: patch.title.slice(0, 100), description: patch.description.slice(0, 5000), hashtags: patch.hashtags.map((h) => h.replace(/^#/, "").trim()).filter(Boolean).slice(0, 15), scenes, guard: { level, hits }, status: needsPrep ? "draft" : v.status === "rendered" ? "ready" : v.status, video_path: null, updated_at: now() })
    .eq("id", id);
  if (error) throw new Error(`保存できませんでした：${error.message}`);
  refresh();
  return level;
}

/** 書き出した mp4 のアップロード先 */
export async function createVideoUploadAction(id: string): Promise<{ path: string; token: string; endpoint: string; bucket: string }> {
  const { sb, userId } = await me();
  const v = await loadVideo(sb, userId, id);
  if (!["ready", "rendered"].includes(v.status)) throw new Error("書き出しの準備ができていません");
  const up = await signedUpload(`${userId}/videos/${id}/render-${Date.now()}.mp4`);
  const base = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  const host = base.hostname.endsWith(".supabase.co") ? base.hostname.replace(/\.supabase\.co$/, ".storage.supabase.co") : base.hostname;
  return { ...up, endpoint: `https://${host}/storage/v1/upload/resumable`, bucket: MEDIA_BUCKET };
}

export async function attachRenderedVideoAction(id: string, path: string, durationSec: number) {
  const { sb, userId } = await me();
  if (!path.startsWith(`${userId}/videos/${id}/render-`)) throw new Error("この動画は使えません");
  const dir = path.slice(0, path.lastIndexOf("/"));
  const { data } = await createAdminClient().storage.from(MEDIA_BUCKET).list(dir, { search: path.split("/").pop() });
  if (!data?.length) throw new Error("書き出した動画が見つかりません。もう一度書き出してください");
  await sb.from("sns_videos").update({ video_path: path, duration_sec: Math.round(durationSec * 10) / 10, status: "rendered", updated_at: now() }).eq("id", id).eq("user_id", userId);
  refresh();
}

/** 承認して送る（公開範囲は人が選ぶ）。媒体側の処理が長いときは processing を返し、30分おきの自動で続きを送る */
export async function approveVideoAction(id: string, input: { privacy: string; sendNow: boolean }): Promise<{ state: "published" | "processing" | "approved"; url?: string | null }> {
  const { sb, userId } = await me();
  const v = await loadVideo(sb, userId, id);
  if (v.status !== "rendered" && v.status !== "approved") throw new Error("書き出した動画を確認してから承認してください");
  if (v.guard?.level === "red") throw new Error("表現チェックで「要修正」が残っています。台本を直してから承認してください");
  await sb.from("sns_videos").update({ status: "approved", privacy: input.privacy.slice(0, 40), approved_at: now(), approved_by: userId, error_message: null, publish_state: { ...v.publishState, errors: 0 }, updated_at: now() }).eq("id", id);
  if (!input.sendNow) {
    refresh();
    return { state: "approved" };
  }
  try {
    const r = await publishVideo(sb, userId, id, defaultVideoPublishDeps(createAdminClient()), Date.now() + 250_000);
    refresh();
    return r;
  } catch (e) {
    await sb.from("sns_videos").update({ error_message: (e instanceof Error ? e.message : String(e)).slice(0, 400) }).eq("id", id);
    refresh();
    throw e;
  }
}

export async function unapproveVideoAction(id: string) {
  const { sb, userId } = await me();
  await sb.from("sns_videos").update({ status: "rendered", updated_at: now() }).eq("id", id).eq("user_id", userId).eq("status", "approved");
  refresh();
}

export async function skipVideoAction(id: string) {
  const { sb, userId } = await me();
  await sb.from("sns_videos").update({ status: "skipped", updated_at: now() }).eq("id", id).eq("user_id", userId).neq("status", "published");
  refresh();
}

export async function changeVideoVoiceAction(id: string, voice: string) {
  const { sb, userId } = await me();
  const v = await loadVideo(sb, userId, id);
  if (!VOICES.some((x) => x.id === voice)) throw new Error("声を選んでください");
  if (["approved", "published"].includes(v.status)) throw new Error("承認済み・送信済みの動画は変えられません");
  // 声を変えたら、全場面のナレーションを作り直す
  await sb.from("sns_videos").update({ voice, scenes: v.scenes.map((s) => ({ ...s, audioPath: null, audioSec: null })), status: "draft", video_path: null, updated_at: now() }).eq("id", id);
  refresh();
}

export async function loadMediaConfigAction(platformRaw: string) {
  const { sb, userId } = await me();
  return loadMediaConfig(sb, userId, asPlatform(platformRaw));
}
