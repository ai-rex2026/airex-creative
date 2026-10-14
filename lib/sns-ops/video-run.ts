import type { SupabaseClient } from "@supabase/supabase-js";
import { defaultImageDeps, fillImages, type ImageDeps } from "../aio/images";
import { getSnsCredentials } from "../social-connect/tokens";
import { MATERIAL_COLUMNS, MEDIA_BUCKET, rowToMaterial } from "./materials";
import { rowToPatternReport } from "./ops-store";
import { loadSettings } from "./store";
import { synthesize, type Wav } from "./tts";
import { chapterScenes, chapterTimestamps, outlineLong, scriptShort } from "./video-brain";
import { FORMAT_SPEC, sceneReady, sceneSeconds, type SnsVideo, type VideoFormat, type VideoPlatform, type VideoScene } from "./video-types";
import { igContainerStatus, igCreateContainer, igPermalink, igPublish } from "./ig";
import { tiktokCreatorInfo, tiktokInit, tiktokStatus, tiktokUpload } from "./tiktok-post";
import { ytPutVideo, ytStartUpload } from "./youtube-api";

/**
 * 動画の工程：台本（ショートは1回・長尺は章ごと）→ 場面の画像（素材が無い場面だけ AI で）→ ナレーション（場面ごと）→
 * ブラウザで書き出し（画面側）→ 人が承認 → 媒体へ送る。
 * どの工程も、1つ終わるごとにその場で保存し、やり直しでは済んだもの（台本の章・画像・音声・送信の途中経過）を飛ばす。
 */

export const VIDEO_COLUMNS =
  "id, platform, format, theme, title, description, hashtags, outline, scenes, voice, pattern, reason, guard, status, video_path, duration_sec, publish_state, external_id, published_url, privacy, error_message, metrics, created_at";

const strs = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);

export function rowToVideo(r: Record<string, unknown>): SnsVideo {
  return {
    id: String(r.id),
    platform: String(r.platform) as VideoPlatform,
    format: r.format === "long" ? "long" : "short",
    theme: String(r.theme ?? ""),
    title: String(r.title ?? ""),
    description: String(r.description ?? ""),
    hashtags: strs(r.hashtags),
    outline: Array.isArray(r.outline) ? (r.outline as SnsVideo["outline"]) : null,
    scenes: Array.isArray(r.scenes) ? (r.scenes as VideoScene[]) : [],
    voice: String(r.voice ?? "Kore"),
    pattern: String(r.pattern ?? ""),
    reason: String(r.reason ?? ""),
    guard: (r.guard as SnsVideo["guard"]) ?? null,
    status: (String(r.status) as SnsVideo["status"]) ?? "draft",
    videoPath: (r.video_path as string | null) ?? null,
    durationSec: r.duration_sec === null || r.duration_sec === undefined ? null : Number(r.duration_sec),
    publishState: (r.publish_state as Record<string, unknown>) ?? {},
    externalId: (r.external_id as string | null) ?? null,
    publishedUrl: (r.published_url as string | null) ?? null,
    privacy: (r.privacy as string | null) ?? null,
    errorMessage: (r.error_message as string | null) ?? null,
    metrics: (r.metrics as SnsVideo["metrics"]) ?? null,
    createdAt: String(r.created_at),
  };
}

const now = () => new Date().toISOString();

async function loadVideo(sb: SupabaseClient, userId: string, id: string): Promise<SnsVideo> {
  const { data } = await sb.from("sns_videos").select(VIDEO_COLUMNS).eq("id", id).eq("user_id", userId).maybeSingle();
  if (!data) throw new Error("動画が見つかりません");
  return rowToVideo(data as Record<string, unknown>);
}

async function materialsFor(sb: SupabaseClient, userId: string) {
  const { data } = await sb.from("sns_materials").select(MATERIAL_COLUMNS).eq("user_id", userId).order("created_at", { ascending: false }).limit(200);
  return ((data ?? []) as Record<string, unknown>[]).map(rowToMaterial);
}

/** 動画の案を作る（台本はここで作る。ショートは全部、長尺は章立てまで） */
export async function createVideoDraft(sb: SupabaseClient, userId: string, p: { platform: VideoPlatform; format: VideoFormat; theme: string; voice: string; minutes?: number; auto?: boolean }): Promise<string> {
  const [brand, materials, { data: rep }] = await Promise.all([
    loadSettings(sb, userId),
    materialsFor(sb, userId),
    sb.from("sns_patterns").select("id, body, created_at").eq("user_id", userId).eq("platform", p.platform).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const report = rep ? rowToPatternReport(rep as Record<string, unknown>) : null;
  const base = { user_id: userId, platform: p.platform, format: p.format, theme: p.theme.slice(0, 300), voice: p.voice, source: p.auto ? "ops_auto" : "ops", status: "draft" };
  if (p.format === "short") {
    const s = await scriptShort(p.platform, brand, report, materials, p.theme);
    const { data, error } = await sb.from("sns_videos").insert({ ...base, title: s.title, description: s.description, hashtags: s.hashtags, scenes: s.scenes, pattern: s.pattern, reason: s.reason, guard: s.guard }).select("id").single();
    if (error || !data) throw new Error(`動画の案を保存できませんでした：${error?.message ?? ""}`);
    return data.id as string;
  }
  const o = await outlineLong(brand, report, materials, p.theme, Math.max(10, Math.min(20, p.minutes ?? 12)));
  const { data, error } = await sb.from("sns_videos").insert({ ...base, title: o.title, description: o.description, hashtags: o.hashtags, outline: o.chapters, scenes: [], pattern: o.pattern, reason: o.reason }).select("id").single();
  if (error || !data) throw new Error(`動画の案を保存できませんでした：${error?.message ?? ""}`);
  return data.id as string;
}

export type PrepareDeps = { images: ImageDeps; tts: (text: string, voice: string) => Promise<Wav>; uploadAudio: (path: string, wav: Buffer) => Promise<void> };

export function defaultPrepareDeps(admin: SupabaseClient): PrepareDeps {
  return {
    images: defaultImageDeps(admin, MEDIA_BUCKET),
    tts: (t, v) => synthesize(t, v),
    uploadAudio: async (path, wav) => {
      const { error } = await admin.storage.from(MEDIA_BUCKET).upload(path, wav, { contentType: "audio/wav", upsert: true });
      if (error) throw new Error(`音声を保存できませんでした：${error.message}`);
    },
  };
}

export type PrepareProgress = { chaptersDone: number; chaptersTotal: number; images: [number, number]; voices: [number, number]; ready: boolean; errors: string[] };

/**
 * 書き出しの準備を進める（期限までにできるところまで。何度呼んでも、済んだ章・画像・音声は作らない）。
 * 長尺の章 → 画像 → 音声の順。1つできるごとに保存する
 */
export async function prepareVideo(sb: SupabaseClient, userId: string, videoId: string, deps: PrepareDeps, deadline: number): Promise<PrepareProgress> {
  let v = await loadVideo(sb, userId, videoId);
  const errors: string[] = [];
  let scenes = [...v.scenes];
  const save = async (patch: Record<string, unknown>) => {
    const { error } = await sb.from("sns_videos").update({ ...patch, updated_at: now() }).eq("id", videoId).eq("user_id", userId);
    if (error) throw new Error(`保存できませんでした：${error.message}`);
  };

  // 1) 長尺：まだ書いていない章を1章ずつ
  const outline = v.outline;
  if (v.format === "long" && outline) {
    const [brand, materials] = await Promise.all([loadSettings(sb, userId), materialsFor(sb, userId)]);
    for (let i = 0; i < outline.length; i++) {
      if (scenes.some((s) => s.chapter === i)) continue;
      if (Date.now() > deadline - 160_000) break;
      try {
        const r = await chapterScenes(brand, { title: v.title, chapters: outline }, i, materials, scenes.length + 1, brand.industry);
        scenes = [...scenes.filter((s) => s.chapter < i), ...r.scenes, ...scenes.filter((s) => s.chapter > i)];
        const prev = v.guard?.hits ?? [];
        const level = [v.guard?.level, r.guard.level].includes("red") ? "red" : [v.guard?.level, r.guard.level].includes("yellow") ? "yellow" : "green";
        await save({ scenes, guard: { level, hits: [...prev, ...r.guard.hits].slice(0, 40) } });
        v = { ...v, scenes, guard: { level, hits: [...prev, ...r.guard.hits] } };
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
        break;
      }
    }
  }
  const chaptersTotal = v.format === "long" ? (v.outline?.length ?? 0) : 1;
  const chaptersDone = v.format === "long" ? new Set(scenes.map((s) => s.chapter)).size : 1;
  const allChapters = chaptersDone >= chaptersTotal;

  // 2) 画像（素材を使わない場面だけ。1枚ごとに保存）
  if (allChapters && Date.now() < deadline - 60_000) {
    const aspect = FORMAT_SPEC[v.format].aspect;
    const todo = scenes.filter((s) => !s.materialId && !s.imagePath && s.imagePrompt && !s.hasText).slice(0, v.format === "long" ? 12 : 10);
    if (todo.length) {
      const imgs = todo.map((s) => ({ key: s.key, prompt: s.imagePrompt!, path: null as string | null, aspect, hasText: false, error: null as string | null }));
      await fillImages(deps.images, `${userId}/videos/${videoId}`, imgs, async (next) => {
        const byKey = new Map(next.map((n) => [n.key, n]));
        scenes = scenes.map((s) => {
          const n = byKey.get(s.key);
          return n ? { ...s, imagePath: n.path ?? s.imagePath, hasText: n.hasText, error: n.error ?? null } : s;
        });
        await save({ scenes });
      }).catch((e) => errors.push(e instanceof Error ? e.message : String(e)));
    }
  }

  // 3) ナレーション（場面ごと。3つずつ並行、1つできるごとに保存）
  if (allChapters) {
    const todo = scenes.filter((s) => s.narration.trim() && !s.audioPath);
    let chain: Promise<void> = Promise.resolve();
    for (let i = 0; i < todo.length; i += 3) {
      if (Date.now() > deadline - 30_000) break;
      const batch = todo.slice(i, i + 3);
      const settled = await Promise.allSettled(
        batch.map(async (s) => {
          const wav = await deps.tts(s.narration, v.voice);
          const path = `${userId}/videos/${videoId}/${s.key}-${Date.now()}.wav`;
          await deps.uploadAudio(path, wav.bytes);
          scenes = scenes.map((x) => (x.key === s.key ? { ...x, audioPath: path, audioSec: Math.round(wav.seconds * 100) / 100 } : x));
          const snap = scenes;
          chain = chain.then(() => save({ scenes: snap }));
          await chain;
        })
      );
      for (const r of settled) if (r.status === "rejected") errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
      if (settled.every((r) => r.status === "rejected")) break;
    }
    await chain;
  }

  const ready = allChapters && scenes.length > 0 && scenes.every(sceneReady);
  if (ready && v.status === "draft") {
    // YouTube の説明文に、実際の長さから計算した目次を足す
    let description = v.description;
    if (v.format === "long" && v.outline && !/\n0:00 /.test(description)) {
      description = `${description}\n\n${chapterTimestamps(v.outline, scenes.map((s) => ({ chapter: s.chapter, sec: sceneSeconds(s) })))}`.trim();
    }
    await save({ status: "ready", description });
  }
  return {
    chaptersDone,
    chaptersTotal,
    images: [scenes.filter((s) => s.materialId || s.imagePath).length, scenes.length],
    voices: [scenes.filter((s) => s.audioPath || !s.narration.trim()).length, scenes.length],
    ready,
    errors: [...new Set(errors)].slice(0, 5),
  };
}

// ── 送る（人が承認したあと） ─────────────────────

export type VideoPublishDeps = {
  /** 連携のトークン（テストで差し替える） */
  creds?: typeof getSnsCredentials;
  download: (path: string) => Promise<Buffer>;
  signedUrl: (path: string) => Promise<string>;
  wait: (ms: number) => Promise<void>;
};

export function defaultVideoPublishDeps(admin: SupabaseClient): VideoPublishDeps {
  return {
    download: async (path) => {
      const { data, error } = await admin.storage.from(MEDIA_BUCKET).download(path);
      if (error || !data) throw new Error(`動画を読めませんでした：${error?.message ?? ""}`);
      return Buffer.from(await data.arrayBuffer());
    },
    signedUrl: async (path) => {
      const { data, error } = await admin.storage.from(MEDIA_BUCKET).createSignedUrl(path, 60 * 60 * 6);
      if (error || !data) throw new Error("動画の URL を作れませんでした");
      return data.signedUrl;
    },
    wait: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}

export type PublishOutcome = { state: "published" | "processing"; url?: string | null };

/**
 * 承認済みの動画を送る。途中経過（YouTube のアップロード先・TikTok の publish_id・Instagram のコンテナ）を
 * その都度 publish_state に保存し、やり直しでは続きから進める（同じ動画を二重に投稿しない）
 */
export async function publishVideo(sb: SupabaseClient, userId: string, videoId: string, deps: VideoPublishDeps, deadline: number): Promise<PublishOutcome> {
  const v = await loadVideo(sb, userId, videoId);
  if (v.status === "published") return { state: "published", url: v.publishedUrl };
  if (v.status !== "approved") throw new Error("承認されていない動画は送れません");
  if (!v.videoPath) throw new Error("書き出した動画がありません");
  if (v.guard?.level === "red") throw new Error("表現チェックで「要修正」が残っています");
  const st: Record<string, unknown> = { ...v.publishState };
  const saveState = async (patch: Record<string, unknown>) => {
    Object.assign(st, patch);
    await sb.from("sns_videos").update({ publish_state: st, updated_at: now() }).eq("id", videoId).eq("user_id", userId);
  };
  const done = async (externalId: string, url: string | null) => {
    await sb.from("sns_videos").update({ status: "published", external_id: externalId, published_url: url, published_at: now(), error_message: null, updated_at: now() }).eq("id", videoId).eq("user_id", userId);
    return { state: "published" as const, url };
  };
  const caption = [v.title, v.description, v.hashtags.map((h) => `#${h}`).join(" ")].filter(Boolean).join("\n\n");
  const getCreds = deps.creds ?? getSnsCredentials;

  if (v.platform === "youtube") {
    const cred = await getCreds(userId, "youtube");
    if (!cred) throw new Error("YouTube が連携されていません");
    const bytes = await deps.download(v.videoPath);
    let uploadUrl = st.uploadUrl as string | undefined;
    if (uploadUrl) {
      // 前回のアップロードが終わっていたかを確かめる（終わっていれば動画 ID が返る）
      const r = await fetch(uploadUrl, { method: "PUT", headers: { authorization: `Bearer ${cred.accessToken}`, "content-range": `bytes */${bytes.length}` }, signal: AbortSignal.timeout(30_000) }).catch(() => null);
      if (r && (r.status === 200 || r.status === 201)) {
        const j = (await r.json().catch(() => ({}))) as { id?: string };
        if (j.id) return done(j.id, `https://www.youtube.com/watch?v=${j.id}`);
      }
      if (!r || r.status === 404 || r.status === 410) uploadUrl = undefined;
    }
    if (!uploadUrl) {
      uploadUrl = await ytStartUpload(cred.accessToken, { title: v.title, description: v.description, tags: v.hashtags, privacy: v.privacy || "private", size: bytes.length });
      await saveState({ uploadUrl });
    }
    const id = await ytPutVideo(uploadUrl, cred.accessToken, bytes);
    return done(id, `https://www.youtube.com/watch?v=${id}`);
  }

  if (v.platform === "tiktok") {
    const cred = await getCreds(userId, "tiktok");
    if (!cred) throw new Error("TikTok が連携されていません");
    if (!st.publishId) {
      const info = await tiktokCreatorInfo(cred.accessToken);
      const privacy = v.privacy && info.privacyOptions.includes(v.privacy) ? v.privacy : null;
      if (!privacy) throw new Error(`公開範囲を選んでください（このアカウントで選べるのは：${info.privacyOptions.join("・")}）`);
      const bytes = await deps.download(v.videoPath);
      const init = await tiktokInit(cred.accessToken, { title: caption, privacy, size: bytes.length });
      await saveState({ publishId: init.publishId, uploadUrl: init.uploadUrl });
      await tiktokUpload(init.uploadUrl, bytes);
      await saveState({ uploaded: true });
    } else if (!st.uploaded) {
      const s = await tiktokStatus(cred.accessToken, String(st.publishId));
      if (s.status === "FAILED") {
        await saveState({ publishId: null, uploadUrl: null, uploaded: false });
        throw new Error(`TikTok で失敗しました（${s.reason ?? "理由不明"}）。もう一度送ってください`);
      }
      if (s.status === "PROCESSING_UPLOAD" && st.uploadUrl) {
        await tiktokUpload(String(st.uploadUrl), await deps.download(v.videoPath));
        await saveState({ uploaded: true });
      }
    }
    while (Date.now() < deadline - 10_000) {
      const s = await tiktokStatus(cred.accessToken, String(st.publishId));
      if (s.status === "PUBLISH_COMPLETE") return done(s.postId ?? String(st.publishId), s.postId ? `https://www.tiktok.com/video/${s.postId}` : null);
      if (s.status === "FAILED") {
        await saveState({ publishId: null, uploadUrl: null, uploaded: false });
        throw new Error(`TikTok で失敗しました（${s.reason ?? "理由不明"}）`);
      }
      await deps.wait(5000);
    }
    return { state: "processing" };
  }

  // Instagram リール
  const cred = await getCreds(userId, "meta");
  if (!cred) throw new Error("Instagram が連携されていません");
  const igId = String((cred.profile as { igBusinessId?: string }).igBusinessId ?? "");
  let containerId = st.containerId as string | undefined;
  if (containerId) {
    const s = await igContainerStatus(cred.accessToken, containerId).catch(() => "ERROR" as const);
    if (s === "PUBLISHED" && st.mediaId) return done(String(st.mediaId), (st.permalink as string) ?? null);
    if (s === "ERROR" || s === "EXPIRED") containerId = undefined;
  }
  if (!containerId) {
    containerId = await igCreateContainer(cred.accessToken, igId, { videoUrl: await deps.signedUrl(v.videoPath), caption });
    await saveState({ containerId });
  }
  while (Date.now() < deadline - 15_000) {
    const s = await igContainerStatus(cred.accessToken, containerId);
    if (s === "FINISHED") {
      const mediaId = await igPublish(cred.accessToken, igId, containerId);
      const permalink = await igPermalink(cred.accessToken, mediaId);
      await saveState({ mediaId, permalink });
      return done(mediaId, permalink);
    }
    if (s === "ERROR" || s === "EXPIRED") {
      await saveState({ containerId: null });
      throw new Error("Instagram で動画の処理に失敗しました。もう一度送ってください");
    }
    await deps.wait(5000);
  }
  return { state: "processing" };
}
