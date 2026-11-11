"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { diagnose } from "@/lib/diagnose";
import { generateCopies } from "@/lib/copy";
import { checkGuard } from "@/lib/guardrail";
import { detectText } from "@/lib/aio/images";
import type { BannerCopy, Diagnosis } from "@/lib/types";
import { falDownload, falPoll, falSubmit, hasFal, outputUrl } from "@/lib/banner-studio/fal";
import { imagePrompt, planPatterns, reframePrompt, videoPrompt } from "@/lib/banner-studio/patterns";
import {
  BANNER_BUCKET,
  FAL_ASPECTS,
  FAL_EDIT_MODEL,
  FAL_IMAGE_MODEL,
  FAL_PRICE,
  FAL_VIDEO_MODEL,
  MONTHLY_LIMIT,
  type BannerMaterial,
  type BannerPattern,
} from "@/lib/banner-studio/types";

/**
 * 広告運用 ＞ バナー制作（2026-11-11）。
 * 工程ごとに保存し、済んだ工程はやり直さない（AGENTS.md の必須ルール）。fal は送った時点で行を保存し、
 * 画面からの問い合わせ（pollBannerAction）で1件ずつ仕上げる。有料の呼び出しは月の上限（MONTHLY_LIMIT）を先に確かめる。
 */

const MAX_MATERIALS = 6;
const UPLOAD_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const now = () => new Date().toISOString();

async function owner() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user || user.is_anonymous) throw new Error("ログインしてください");
  return { sb, user };
}

type Row = {
  id: string;
  name: string;
  url: string;
  description: string;
  diagnosis: Diagnosis | null;
  copies: BannerCopy[] | null;
  materials: BannerMaterial[] | null;
  patterns: BannerPattern[] | null;
};

async function ownProject(id: string) {
  const { sb, user } = await owner();
  const { data } = await sb
    .from("banner_projects")
    .select("id, name, url, description, diagnosis, copies, materials, patterns")
    .eq("id", id)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!data) throw new Error("見つかりません");
  return { sb, user, p: data as Row };
}

const refresh = (id?: string) => {
  revalidatePath("/ads/banners");
  if (id) revalidatePath(`/ads/banners/${id}`);
};

function normUrl(input: string): string {
  const s = input.trim();
  if (!s) return "";
  const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  return u.toString();
}

// ── 入力 ─────────────────────

export async function createBannerProjectAction(input: { name: string; url: string; description: string }): Promise<{ id: string }> {
  const { sb, user } = await owner();
  const url = normUrl(input.url);
  const description = input.description.trim().slice(0, 3000);
  if (!url && description.length < 10) throw new Error("URL か、商品・サービスの説明（10文字以上）を入れてください");
  const { data, error } = await sb
    .from("banner_projects")
    .insert({ owner_id: user.id, name: input.name.trim().slice(0, 60) || url.replace(/^https?:\/\//, "").slice(0, 60) || description.slice(0, 20), url, description })
    .select("id")
    .single();
  if (error || !data) throw new Error("登録できませんでした");
  refresh();
  return { id: String(data.id) };
}

/** 入力を直す。中身が変わったら、AI の結果（診断・コピー・パターン）を作り直す対象にする（絵は消さない） */
export async function updateBannerInputAction(id: string, input: { name: string; url: string; description: string }): Promise<void> {
  const { sb, p } = await ownProject(id);
  const url = normUrl(input.url);
  const description = input.description.trim().slice(0, 3000);
  const changed = url !== p.url || description !== p.description;
  await sb
    .from("banner_projects")
    .update({
      name: input.name.trim().slice(0, 60) || p.name,
      url,
      description,
      ...(changed ? { diagnosis: null, copies: [], patterns: [] } : {}),
      updated_at: now(),
    })
    .eq("id", id);
  refresh(id);
}

export async function uploadMaterialAction(id: string, form: FormData): Promise<void> {
  const { sb, user, p } = await ownProject(id);
  const materials = p.materials ?? [];
  if (materials.length >= MAX_MATERIALS) throw new Error(`素材は${MAX_MATERIALS}点までです`);
  const file = form.get("file");
  if (!(file instanceof File)) throw new Error("画像を選んでください");
  const ext = UPLOAD_TYPES[file.type];
  if (!ext) throw new Error("画像は JPEG・PNG・WebP のいずれかにしてください");
  if (file.size > 4_500_000) throw new Error("画像が大きすぎます");
  const kind = ["product", "logo", "photo"].includes(String(form.get("kind"))) ? (String(form.get("kind")) as BannerMaterial["kind"]) : "product";
  const path = `${user.id}/${id}/materials/${Date.now()}.${ext}`;
  const { error } = await createAdminClient().storage.from(BANNER_BUCKET).upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: true });
  if (error) throw new Error(`画像を保存できませんでした：${error.message}`);
  const name = String(form.get("name") ?? file.name ?? "").slice(0, 60);
  // 素材が変わると絵のパターン（素材を使うか）も変わるので、パターンは作り直す対象にする
  await sb.from("banner_projects").update({ materials: [...materials, { path, kind, name }], patterns: [], updated_at: now() }).eq("id", id);
  refresh(id);
}

export async function deleteMaterialAction(id: string, path: string): Promise<void> {
  const { sb, p } = await ownProject(id);
  const materials = (p.materials ?? []).filter((m) => m.path !== path);
  await createAdminClient().storage.from(BANNER_BUCKET).remove([path]).catch(() => undefined);
  await sb.from("banner_projects").update({ materials, patterns: [], updated_at: now() }).eq("id", id);
  refresh(id);
}

// ── AI：診断 → コピー（法令チェックと同時）→ 絵のパターン ─────────────────────

export async function prepareBannerAction(id: string): Promise<{ ok: boolean; error?: string }> {
  const { sb, p } = await ownProject(id);
  try {
    let d = p.diagnosis;
    if (!d) {
      d = await diagnose({ url: p.url || undefined, text: p.description || undefined });
      await sb.from("banner_projects").update({ diagnosis: d, error: null, updated_at: now() }).eq("id", id);
    }
    if (!(p.copies ?? []).length) {
      const copies = await generateCopies(d, 2);
      if (!copies.length) throw new Error("コピーを作れませんでした");
      await sb.from("banner_projects").update({ copies, updated_at: now() }).eq("id", id);
    }
    if (!(p.patterns ?? []).length) {
      const patterns = await planPatterns(d, p.description, p.materials ?? []);
      await sb.from("banner_projects").update({ patterns, updated_at: now() }).eq("id", id);
    }
    refresh(id);
    return { ok: true };
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    await sb.from("banner_projects").update({ error: msg, updated_at: now() }).eq("id", id);
    refresh(id);
    return { ok: false, error: msg };
  }
}

export async function regenerateCopiesAction(id: string): Promise<void> {
  const { sb, p } = await ownProject(id);
  if (!p.diagnosis) throw new Error("先に「コピーと絵のパターンを作る」を押してください");
  const copies = await generateCopies(p.diagnosis, 2);
  if (!copies.length) throw new Error("コピーを作れませんでした");
  await sb.from("banner_projects").update({ copies, updated_at: now() }).eq("id", id);
  refresh(id);
}

export async function regeneratePatternsAction(id: string): Promise<void> {
  const { sb, p } = await ownProject(id);
  if (!p.diagnosis) throw new Error("先に「コピーと絵のパターンを作る」を押してください");
  const patterns = await planPatterns(p.diagnosis, p.description, p.materials ?? []);
  await sb.from("banner_projects").update({ patterns, updated_at: now() }).eq("id", id);
  refresh(id);
}

/** コピーを直す。直した文言はその場で法令チェックに通す */
export async function editCopyAction(id: string, index: number, patch: Pick<BannerCopy, "headline" | "ribbonTop" | "ribbonBottom" | "body" | "cta">): Promise<BannerCopy> {
  const { sb, p } = await ownProject(id);
  const copies = [...(p.copies ?? [])];
  const cur = copies[index];
  if (!cur || !p.diagnosis) throw new Error("コピーが見つかりません");
  const next: BannerCopy = {
    ...cur,
    headline: [String(patch.headline?.[0] ?? "").slice(0, 30), String(patch.headline?.[1] ?? "").slice(0, 30)],
    ribbonTop: String(patch.ribbonTop ?? "").slice(0, 30),
    ribbonBottom: String(patch.ribbonBottom ?? "").slice(0, 20),
    body: String(patch.body ?? "").slice(0, 140),
    cta: String(patch.cta ?? "").slice(0, 20),
  };
  const texts = [next.headline.join(""), next.subhead, next.ribbonTop, next.ribbonBottom, next.body, next.cta].filter(Boolean) as string[];
  next.guard = await checkGuard(texts, p.diagnosis.industry);
  copies[index] = next;
  await sb.from("banner_projects").update({ copies, updated_at: now() }).eq("id", id);
  refresh(id);
  return next;
}

// ── fal：絵・サイズ違い・動画 ─────────────────────

/** 今月（日本時間）の使用数 */
async function usage(sb: Awaited<ReturnType<typeof createClient>>, ownerId: string) {
  const jst = new Date(Date.now() + 9 * 3600_000);
  const start = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), 1) - 9 * 3600_000).toISOString();
  const { data } = await sb.from("banner_visuals").select("kind").eq("owner_id", ownerId).gte("created_at", start);
  const rows = data ?? [];
  return { images: rows.filter((r) => r.kind !== "video").length, videos: rows.filter((r) => r.kind === "video").length };
}

export async function bannerUsageAction(): Promise<{ images: number; videos: number; limit: typeof MONTHLY_LIMIT; falReady: boolean }> {
  const { sb, user } = await owner();
  return { ...(await usage(sb, user.id)), limit: MONTHLY_LIMIT, falReady: hasFal() };
}

async function signed(path: string): Promise<string> {
  const { data, error } = await createAdminClient().storage.from(BANNER_BUCKET).createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) throw new Error("素材の URL を作れませんでした");
  return data.signedUrl;
}

/** fal に送って、行を保存する（送れなかったときもエラーの行を残し、画面に理由を出す） */
async function submitVisual(
  sb: Awaited<ReturnType<typeof createClient>>,
  base: { project_id: string; owner_id: string; kind: string; pattern: string; parent_id: string | null; aspect: string },
  model: string,
  input: Record<string, unknown>,
  cost: number
) {
  try {
    const t = await falSubmit(model, input);
    await sb.from("banner_visuals").insert({ ...base, model, request_id: t.requestId, status_url: t.statusUrl, response_url: t.responseUrl, status: "queued", cost_usd: cost });
  } catch (e) {
    await sb.from("banner_visuals").insert({ ...base, model, status: "error", error: (e instanceof Error ? e.message : String(e)).slice(0, 300) });
  }
}

/** 基本パターンの絵（1:1）を作る。作り済み・作成中のパターンは送らない */
export async function generateBasesAction(id: string, keys?: string[]): Promise<{ sent: number }> {
  const { sb, user, p } = await ownProject(id);
  if (!hasFal()) throw new Error("fal の API キー（FAL_KEY）が未設定のため、絵を作れません");
  const patterns = (p.patterns ?? []).filter((x) => !keys?.length || keys.includes(x.key));
  if (!patterns.length) throw new Error("先に「コピーと絵のパターンを作る」を押してください");
  const { data: existing } = await sb.from("banner_visuals").select("pattern, status").eq("project_id", id).eq("kind", "base").neq("status", "error");
  const has = new Set((existing ?? []).map((r) => r.pattern));
  const todo = patterns.filter((x) => !has.has(x.key));
  if (!todo.length) return { sent: 0 };
  const u = await usage(sb, user.id);
  if (u.images + todo.length > MONTHLY_LIMIT.images) throw new Error(`今月の画像の上限（${MONTHLY_LIMIT.images}枚）を超えます`);
  const mats = (p.materials ?? []).filter((m) => m.kind !== "logo").slice(0, 3);
  const matUrls = mats.length ? await Promise.all(mats.map((m) => signed(m.path))) : [];
  for (const pt of todo) {
    const useMat = pt.useMaterials && matUrls.length > 0;
    await submitVisual(
      sb,
      { project_id: id, owner_id: user.id, kind: "base", pattern: pt.key, parent_id: null, aspect: "1:1" },
      useMat ? FAL_EDIT_MODEL : FAL_IMAGE_MODEL,
      useMat
        ? { prompt: imagePrompt(pt), image_urls: matUrls, num_images: 1, aspect_ratio: "1:1", output_format: "png" }
        : { prompt: imagePrompt(pt), num_images: 1, aspect_ratio: "1:1", output_format: "png" },
      FAL_PRICE.image
    );
  }
  refresh(id);
  return { sent: todo.length };
}

/** 基本パターンの絵を、選んだ縦横比で作り直す（元の絵を保つ編集）。作り済みの縦横比は送らない */
export async function resizeVisualAction(id: string, baseId: string, aspects: string[]): Promise<{ sent: number }> {
  const { sb, user, p } = await ownProject(id);
  if (!hasFal()) throw new Error("fal の API キー（FAL_KEY）が未設定です");
  const { data: base } = await sb.from("banner_visuals").select("id, pattern, aspect, path, status").eq("id", baseId).eq("project_id", id).maybeSingle();
  if (!base || base.status !== "done" || !base.path) throw new Error("元の絵がまだできていません");
  const want = [...new Set(aspects)].filter((a) => (FAL_ASPECTS as readonly string[]).includes(a) && a !== base.aspect);
  const { data: existing } = await sb.from("banner_visuals").select("aspect").eq("parent_id", baseId).eq("kind", "resize").neq("status", "error");
  const has = new Set((existing ?? []).map((r) => r.aspect));
  const todo = want.filter((a) => !has.has(a));
  if (!todo.length) return { sent: 0 };
  const u = await usage(sb, user.id);
  if (u.images + todo.length > MONTHLY_LIMIT.images) throw new Error(`今月の画像の上限（${MONTHLY_LIMIT.images}枚）を超えます`);
  const pt = (p.patterns ?? []).find((x) => x.key === base.pattern) ?? null;
  const src = await signed(String(base.path));
  for (const a of todo) {
    await submitVisual(
      sb,
      { project_id: id, owner_id: user.id, kind: "resize", pattern: String(base.pattern), parent_id: baseId, aspect: a },
      FAL_EDIT_MODEL,
      { prompt: reframePrompt(pt), image_urls: [src], num_images: 1, aspect_ratio: a, output_format: "png" },
      FAL_PRICE.image
    );
  }
  refresh(id);
  return { sent: todo.length };
}

/** 絵を5秒の動画にする（文字なし。文字は画面で重ねて書き出す） */
export async function makeVideoAction(id: string, sourceId: string): Promise<void> {
  const { sb, user, p } = await ownProject(id);
  if (!hasFal()) throw new Error("fal の API キー（FAL_KEY）が未設定です");
  const { data: src } = await sb.from("banner_visuals").select("id, kind, pattern, aspect, path, status").eq("id", sourceId).eq("project_id", id).maybeSingle();
  if (!src || src.kind === "video" || src.status !== "done" || !src.path) throw new Error("元の絵がまだできていません");
  const { data: dup } = await sb.from("banner_visuals").select("id").eq("parent_id", sourceId).eq("kind", "video").eq("status", "queued").maybeSingle();
  if (dup) throw new Error("この絵の動画は作成中です");
  const u = await usage(sb, user.id);
  if (u.videos + 1 > MONTHLY_LIMIT.videos) throw new Error(`今月の動画の上限（${MONTHLY_LIMIT.videos}本）に達しています`);
  const pt = (p.patterns ?? []).find((x) => x.key === src.pattern) ?? null;
  await submitVisual(
    sb,
    { project_id: id, owner_id: user.id, kind: "video", pattern: String(src.pattern), parent_id: sourceId, aspect: String(src.aspect) },
    FAL_VIDEO_MODEL,
    { prompt: videoPrompt(pt), image_url: await signed(String(src.path)), duration: "5", negative_prompt: "text, letters, captions, logo, watermark, blur, distortion, low quality" },
    FAL_PRICE.video5
  );
  refresh(id);
}

/** 作成中のものを進める（画面から数秒おきに呼ぶ）。1回で最大6件 */
export async function pollBannerAction(id: string): Promise<{ pending: number; changed: number }> {
  const { sb, user, p } = await ownProject(id);
  const { data: rows } = await sb
    .from("banner_visuals")
    .select("id, kind, pattern, request_id, status_url, response_url, created_at")
    .eq("project_id", id)
    .eq("status", "queued")
    .order("created_at")
    .limit(6);
  let changed = 0;
  const admin = createAdminClient();
  const usesMat = new Set((p.patterns ?? []).filter((x) => x.useMaterials).map((x) => x.key));
  for (const r of rows ?? []) {
    // 30分たっても終わらないものは止める（fal 側で失われた依頼が残り続けないように）
    if (Date.now() - Date.parse(String(r.created_at)) > 30 * 60_000) {
      await sb.from("banner_visuals").update({ status: "error", error: "時間内に終わりませんでした。作り直してください" }).eq("id", r.id);
      changed++;
      continue;
    }
    try {
      const res = await falPoll({ requestId: String(r.request_id), statusUrl: String(r.status_url), responseUrl: String(r.response_url) });
      if (res.state === "waiting") continue;
      if (res.state === "error") {
        await sb.from("banner_visuals").update({ status: "error", error: res.message, completed_at: now() }).eq("id", r.id);
        changed++;
        continue;
      }
      const isVideo = r.kind === "video";
      const url = outputUrl(res.output, isVideo ? "video" : "image");
      if (!url) throw new Error("出来上がったファイルが見つかりませんでした");
      const file = await falDownload(url);
      const ext = isVideo ? "mp4" : file.mime.includes("jpeg") ? "jpg" : file.mime.includes("webp") ? "webp" : "png";
      const path = `${user.id}/${id}/${r.kind}-${r.id}.${ext}`;
      const { error } = await admin.storage.from(BANNER_BUCKET).upload(path, file.bytes, { contentType: isVideo ? "video/mp4" : file.mime, upsert: true });
      if (error) throw new Error(`保存できませんでした：${error.message}`);
      // 素材（商品のラベルなど）を使っていない絵だけ、文字が紛れ込んでいないか確かめる（判定できなくても止めない）
      let textWarning: string | null = null;
      if (!isVideo && !usesMat.has(String(r.pattern))) {
        try {
          const t = await detectText({ bytes: file.bytes, mime: file.mime });
          const v = typeof t === "boolean" ? { hasText: t, seen: [] as string[] } : t;
          if (v.hasText) textWarning = `絵に文字が入っているかもしれません${v.seen?.length ? `（${v.seen.slice(0, 3).join("、")}）` : ""}`;
        } catch {
          // 判定に使う AI が使えないときは警告なしで進める
        }
      }
      await sb.from("banner_visuals").update({ status: "done", path, error: null, text_warning: textWarning, completed_at: now() }).eq("id", r.id);
      changed++;
    } catch (e) {
      await sb.from("banner_visuals").update({ status: "error", error: (e instanceof Error ? e.message : String(e)).slice(0, 300), completed_at: now() }).eq("id", r.id);
      changed++;
    }
  }
  const { count } = await sb.from("banner_visuals").select("id", { count: "exact", head: true }).eq("project_id", id).eq("status", "queued");
  if (changed) refresh(id);
  return { pending: count ?? 0, changed };
}

export async function deleteVisualAction(visualId: string): Promise<void> {
  const { sb, user } = await owner();
  const { data: v } = await sb.from("banner_visuals").select("project_id, path").eq("id", visualId).eq("owner_id", user.id).maybeSingle();
  if (!v) return;
  // 子（サイズ違い・動画）のファイルも消す
  const { data: kids } = await sb.from("banner_visuals").select("path").eq("parent_id", visualId);
  const paths = [v.path, ...(kids ?? []).map((k) => k.path)].filter((x): x is string => !!x);
  if (paths.length) await createAdminClient().storage.from(BANNER_BUCKET).remove(paths).catch(() => undefined);
  await sb.from("banner_visuals").delete().eq("id", visualId).eq("owner_id", user.id);
  refresh(String(v.project_id));
}

export async function deleteBannerProjectAction(id: string): Promise<void> {
  const { sb, user, p } = await ownProject(id);
  const { data: vis } = await sb.from("banner_visuals").select("path").eq("project_id", id);
  const paths = [...(p.materials ?? []).map((m) => m.path), ...(vis ?? []).map((v) => v.path)].filter((x): x is string => !!x);
  if (paths.length) await createAdminClient().storage.from(BANNER_BUCKET).remove(paths).catch(() => undefined);
  await sb.from("banner_projects").delete().eq("id", id).eq("owner_id", user.id);
  refresh();
}
