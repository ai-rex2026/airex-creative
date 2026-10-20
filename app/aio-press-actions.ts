"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { jstDateKey, jstPeriodKey } from "@/lib/meo-ops/daily";
import { AIO_PROJECT_COLUMNS, rowToProject } from "@/lib/aio/store";
import { defaultImageDeps, fillImages } from "@/lib/aio/images";
import { cleanVideos, contactText, draftPressRelease, guardPress, placeVideos } from "@/lib/aio/press";
import { PRESS_COLUMNS, rowToPress } from "@/lib/aio/press-store";
import { PRESS_KINDS, PRESS_MONTHLY_LIMIT, type PressBrief, type PressContent, type PressImage } from "@/lib/aio/press-types";
import { h2List } from "@/lib/aio/md";
import type { AioProject } from "@/lib/aio/types";

/**
 * AIO「PR TIMES」の Server Action。入稿内容を作る・直す・画像を作る／アップロードする・消す。
 * PR TIMES への入稿は人が管理画面で行う（自動では送らない）。
 * 本番では Server Action が throw した Error の文面は画面に届かないため、失敗は値で返す。
 */

type Sb = Awaited<ReturnType<typeof createClient>>;
export type PressFail = { ok: false; error: string };
const failOf = (e: unknown, fallback: string): PressFail => ({ ok: false, error: e instanceof Error && e.message ? e.message : fallback });
const now = () => new Date().toISOString();
const refresh = (id: string) => revalidatePath(`/aio/${id}`);

async function ownedProject(projectId: string): Promise<{ sb: Sb; project: AioProject }> {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) throw new Error("ログインが必要です");
  if (user.is_anonymous) throw new Error("AIO を使うには、先に無料登録してください");
  const { data } = await sb.from("aio_projects").select(AIO_PROJECT_COLUMNS).eq("id", projectId).eq("owner_id", user.id).maybeSingle();
  if (!data) throw new Error("この対象を操作する権限がありません");
  return { sb, project: rowToProject(data as Record<string, unknown>) };
}

async function ownedPress(id: string) {
  const sb = await createClient();
  const { data } = await sb.from("aio_press_releases").select(`${PRESS_COLUMNS}, project_id`).eq("id", id).maybeSingle();
  if (!data) throw new Error("プレスリリースが見つかりません");
  const { sb: sb2, project } = await ownedProject(String((data as Record<string, unknown>).project_id));
  return { sb: sb2, project, press: rowToPress(data as Record<string, unknown>) };
}

function cleanBrief(b: PressBrief): PressBrief {
  const kind = PRESS_KINDS.some((k) => k.kind === b.kind) ? b.kind : "other";
  const t = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
  return {
    kind,
    announcement: t(b.announcement, 1500),
    facts: t(b.facts, 3000),
    releaseDate: /^\d{4}-\d{2}-\d{2}$/.test(String(b.releaseDate ?? "")) ? String(b.releaseDate) : "",
    contact: {
      company: t(b.contact?.company, 80),
      department: t(b.contact?.department, 80),
      person: t(b.contact?.person, 60),
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(b.contact?.email ?? "").trim()) ? String(b.contact.email).trim().slice(0, 120) : "",
      tel: t(b.contact?.tel, 30),
    },
    videos: cleanVideos(Array.isArray(b.videos) ? b.videos : []),
    note: t(b.note, 800),
  };
}

// ── 作る ─────────────────────
/** 入稿内容を1本作って保存する（画像は次の finishPressReleaseAction で作る）。本文と表現チェックまでをここで行う */
export async function createPressReleaseAction(projectId: string, input: PressBrief): Promise<{ ok: true; id: string } | PressFail> {
  try {
    const { sb, project } = await ownedProject(projectId);
    const brief = cleanBrief(input);
    if (brief.announcement.length < 10) throw new Error("発表したい内容を、もう少し具体的に入れてください（10文字以上）");
    if (input.contact?.email?.trim() && !brief.contact.email) throw new Error("問い合わせ先のメールアドレスの形が正しくありません");

    // 月の上限（外部の AI を呼ぶ回数の歯止め）
    const [y, m] = jstPeriodKey().split("-").map(Number);
    const since = new Date(Date.UTC(y, m - 1, 1) - 9 * 3600e3).toISOString();
    const { count } = await sb.from("aio_press_releases").select("id", { count: "exact", head: true }).eq("project_id", projectId).gte("created_at", since);
    if ((count ?? 0) >= PRESS_MONTHLY_LIMIT) throw new Error(`今月作れるプレスリリースの上限（${PRESS_MONTHLY_LIMIT}本）に達しました。翌月までお待ちください`);

    const d = await draftPressRelease(project, brief, jstDateKey());
    const guard = await guardPress(d.content, project.industry).catch(() => null);
    const { data, error } = await sb
      .from("aio_press_releases")
      .insert({ project_id: projectId, title: d.content.title, status: "draft", brief, content: d.content, images: d.images, guard })
      .select("id")
      .single();
    if (error || !data) throw new Error(`保存できませんでした：${error?.message ?? ""}`);
    refresh(projectId);
    return { ok: true, id: data.id as string };
  } catch (e) {
    return failOf(e, "プレスリリースを作れませんでした");
  }
}

/** 仕上げ：表現チェック（まだなら）と、まだ無い画像を作る。何度押しても、済んだ分はやり直さない */
export async function finishPressReleaseAction(id: string): Promise<{ ok: true; made: number; failed: number; imageErrors: string[] } | PressFail> {
  try {
    const { sb, project, press } = await ownedPress(id);
    if (!press.guard) {
      const guard = await guardPress(press.content, project.industry);
      await sb.from("aio_press_releases").update({ guard, updated_at: now() }).eq("id", id);
    }
    const r = await fillImages(defaultImageDeps(createAdminClient()), `${project.id}/press-${id}`, press.images, async (images) => {
      await sb.from("aio_press_releases").update({ images, updated_at: now() }).eq("id", id);
    });
    const { data: fresh } = await sb.from("aio_press_releases").select("images").eq("id", id).maybeSingle();
    const imageErrors = ((fresh?.images ?? []) as PressImage[]).filter((i) => !i.path && i.error).map((i) => i.error as string);
    refresh(project.id);
    return { ok: true, ...r, imageErrors: [...new Set(imageErrors)] };
  } catch (e) {
    return failOf(e, "仕上げられませんでした");
  }
}

// ── 画像 ─────────────────────
/** 画像を1枚作り直す（説明を変えてもよい）。上限は、できあがった画像の作り直しだけ数える */
export async function regeneratePressImageAction(id: string, key: string, prompt?: string): Promise<{ ok: true } | PressFail> {
  try {
    const { sb, project, press } = await ownedPress(id);
    const target = press.images.find((i) => i.key === key);
    if (!target) throw new Error("画像が見つかりません");
    const prev = (target as PressImage & { regen?: number }).regen ?? 0;
    const regen = target.path ? prev + 1 : prev;
    if (regen > 5) throw new Error("この画像は作り直しの上限（5回）に達しました");
    const images = press.images.map((i) => (i.key === key ? { ...i, source: "ai" as const, prompt: prompt?.trim() ? prompt.trim().slice(0, 800) : i.prompt, path: null, hasText: false, error: null, regen } : i));
    await sb.from("aio_press_releases").update({ images, updated_at: now() }).eq("id", id);
    const r = await fillImages(defaultImageDeps(createAdminClient()), `${project.id}/press-${id}`, images, async (next) => {
      await sb.from("aio_press_releases").update({ images: next, updated_at: now() }).eq("id", id);
    });
    refresh(project.id);
    if (r.failed) {
      const { data: fresh } = await sb.from("aio_press_releases").select("images").eq("id", id).maybeSingle();
      const why = ((fresh?.images ?? []) as PressImage[]).find((i) => i.key === key)?.error;
      throw new Error(why ? `画像を作れませんでした：${why}` : "画像を作れませんでした。説明を変えてもう一度お試しください");
    }
    return { ok: true };
  } catch (e) {
    return failOf(e, "画像を作れませんでした");
  }
}

const UPLOAD_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** 自分で用意した画像を、その枠に差し替える（ブラウザで縮小してから送る） */
export async function uploadPressImageAction(id: string, key: string, form: FormData): Promise<{ ok: true } | PressFail> {
  try {
    const { sb, project, press } = await ownedPress(id);
    const target = press.images.find((i) => i.key === key);
    if (!target) throw new Error("画像の枠が見つかりません");
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("画像を選んでください");
    const ext = UPLOAD_TYPES[file.type];
    if (!ext) throw new Error("画像は JPEG・PNG・WebP のいずれかにしてください");
    if (file.size > 4_500_000) throw new Error("画像が大きすぎます（5MB以下にしてください）");
    if (file.size < 1024) throw new Error("画像が小さすぎます");
    const path = `${project.id}/press-${id}/${key}-${Date.now()}.${ext}`;
    const { error } = await createAdminClient().storage.from("aio-images").upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: true });
    if (error) throw new Error(`画像を保存できませんでした：${error.message}`);
    const images = press.images.map((i) => (i.key === key ? { ...i, source: "upload" as const, path, hasText: false, error: null } : i));
    await sb.from("aio_press_releases").update({ images, updated_at: now() }).eq("id", id);
    refresh(project.id);
    return { ok: true };
  } catch (e) {
    return failOf(e, "画像をアップロードできませんでした");
  }
}

// ── 直す・消す ─────────────────────
export type PressPatch = {
  title: string;
  subtitle: string;
  lead: string;
  bodyMd: string;
  keywords: string[];
  companyProfile: string;
  contactText: string;
  todo: string[];
  images: { key: string; alt: string; caption: string }[];
};

/** 入稿内容を人が直して保存する。直したら表現チェックをやり直す */
export async function updatePressReleaseAction(id: string, patch: PressPatch): Promise<{ ok: true; level: string } | PressFail> {
  try {
    const { sb, project, press } = await ownedPress(id);
    const t = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
    const c: PressContent = {
      ...press.content,
      title: t(patch.title, 120),
      subtitle: t(patch.subtitle, 160),
      lead: t(patch.lead, 600),
      bodyMd: String(patch.bodyMd ?? "").trim().slice(0, 20000),
      keywords: (patch.keywords ?? []).map((k) => t(k, 30)).filter(Boolean).slice(0, 8),
      companyProfile: t(patch.companyProfile, 1200),
      contactText: t(patch.contactText, 600),
      todo: (patch.todo ?? []).map((x) => t(x, 120)).filter(Boolean).slice(0, 20),
    };
    if (!c.title || c.bodyMd.length < 200) throw new Error("タイトルと本文を入れてください");
    // 見出しの数が減ったら、画像・動画の位置が範囲を外れないよう寄せる
    const h2n = Math.max(h2List(c.bodyMd).length, 1);
    const images = press.images.map((i) => {
      const edit = (patch.images ?? []).find((x) => x.key === i.key);
      return { ...i, alt: edit ? t(edit.alt, 80) : i.alt, caption: edit ? t(edit.caption, 100) : i.caption, afterH2: i.afterH2 === null ? null : Math.min(i.afterH2, h2n - 1) };
    });
    const videos = placeVideos(
      c.videos.map((v) => ({ url: v.url, title: v.title })),
      h2n,
      images.filter((i) => i.afterH2 !== null).map((i) => i.afterH2 as number)
    );
    const next: PressContent = { ...c, videos, titleOptions: c.titleOptions.includes(c.title) ? c.titleOptions : [c.title, ...c.titleOptions].slice(0, 4) };
    const guard = await guardPress(next, project.industry);
    const { error } = await sb.from("aio_press_releases").update({ title: next.title, content: next, images, guard, updated_at: now() }).eq("id", id);
    if (error) throw new Error(`保存できませんでした：${error.message}`);
    refresh(project.id);
    return { ok: true, level: guard.level };
  } catch (e) {
    return failOf(e, "保存できませんでした");
  }
}

/** 連絡先だけ入れ直したとき用（問い合わせ先の文面を作り直す） */
export async function resetPressContactAction(id: string, contact: PressBrief["contact"]): Promise<{ ok: true; text: string } | PressFail> {
  try {
    const { sb, project, press } = await ownedPress(id);
    const brief = cleanBrief({ ...press.brief, contact });
    const text = contactText(brief);
    await sb.from("aio_press_releases").update({ brief, content: { ...press.content, contactText: text }, updated_at: now() }).eq("id", id);
    refresh(project.id);
    return { ok: true, text };
  } catch (e) {
    return failOf(e, "保存できませんでした");
  }
}

/** PR TIMES に入稿したかどうかの印（人が付ける。要修正が残っているものは付けられない） */
export async function markPressSubmittedAction(id: string, submitted: boolean): Promise<{ ok: true } | PressFail> {
  try {
    const { sb, project, press } = await ownedPress(id);
    if (submitted && press.guard?.level === "red") throw new Error("表現チェックで「要修正」が残っています。直してから入稿してください");
    await sb.from("aio_press_releases").update({ status: submitted ? "submitted" : "draft", updated_at: now() }).eq("id", id);
    refresh(project.id);
    return { ok: true };
  } catch (e) {
    return failOf(e, "更新できませんでした");
  }
}

export async function deletePressReleaseAction(id: string): Promise<{ ok: true } | PressFail> {
  try {
    const { sb, project } = await ownedPress(id);
    const { error } = await sb.from("aio_press_releases").delete().eq("id", id);
    if (error) throw new Error("削除できませんでした");
    refresh(project.id);
    return { ok: true };
  } catch (e) {
    return failOf(e, "削除できませんでした");
  }
}
