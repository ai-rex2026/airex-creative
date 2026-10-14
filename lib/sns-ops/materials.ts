import type { SupabaseClient } from "@supabase/supabase-js";
import { gbpAccessToken } from "../gbp/oauth";
import { listMedia } from "../gbp/api";
import { getSnsCredentials } from "../social-connect/tokens";
import { igOwnMedia } from "./ig";
import { xOwnMedia } from "./x-api";
import type { Material } from "./video-types";

/**
 * 動画・投稿に使う素材（写真・動画・事実のメモ）。
 * 取り込み元：自社のビジネスプロフィール（Google マップに自社が載せた写真）・自分の X の投稿の画像/動画・
 * 自分の Instagram の投稿・手持ちのファイル・事実のメモ。第三者が Google マップに投稿した写真は使わない。
 * 1件取り込むごとに保存し、同じものは二度取り込まない（origin_id）。
 */

export const MEDIA_BUCKET = "sns-media";
export const MATERIAL_COLUMNS = "id, kind, source, path, title, body, meta, created_at";

export function rowToMaterial(r: Record<string, unknown>): Material {
  return {
    id: String(r.id),
    kind: (["image", "video", "text"].includes(String(r.kind)) ? r.kind : "image") as Material["kind"],
    source: String(r.source) as Material["source"],
    path: (r.path as string | null) ?? null,
    title: String(r.title ?? ""),
    body: String(r.body ?? ""),
    meta: (r.meta as Record<string, unknown>) ?? {},
    createdAt: String(r.created_at),
  };
}

/** 取り込んでよい置き場（API が返した各社の配信元だけ。任意の URL は取りに行かない） */
const ALLOWED = [/\.googleusercontent\.com$/, /^pbs\.twimg\.com$/, /^video\.twimg\.com$/, /\.cdninstagram\.com$/, /\.fbcdn\.net$/];

export async function fetchMediaBytes(url: string, f: typeof fetch = fetch): Promise<{ bytes: Buffer; mime: string }> {
  const u = new URL(url);
  if (u.protocol !== "https:" || !ALLOWED.some((re) => re.test(u.hostname))) throw new Error("この置き場の画像は取り込めません");
  const res = await f(u.toString(), { signal: AbortSignal.timeout(60_000), redirect: "follow" });
  if (!res.ok) throw new Error(`素材を取得できませんでした（HTTP ${res.status}）`);
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > 300 * 1024 * 1024) throw new Error("素材が大きすぎます（300MBまで）");
  return { bytes: Buffer.from(await res.arrayBuffer()), mime: (res.headers.get("content-type") ?? "image/jpeg").split(";")[0] };
}

type ImportItem = { originId: string; kind: "image" | "video"; url: string; title: string; body: string; meta?: Record<string, unknown> };

export type ImportDeps = { fetchBytes: typeof fetchMediaBytes; upload: (path: string, file: { bytes: Buffer; mime: string }) => Promise<void> };

export function defaultImportDeps(admin: SupabaseClient): ImportDeps {
  return {
    fetchBytes: fetchMediaBytes,
    upload: async (path, file) => {
      const { error } = await admin.storage.from(MEDIA_BUCKET).upload(path, file.bytes, { contentType: file.mime, upsert: true });
      if (error) throw new Error(`素材を保存できませんでした：${error.message}`);
    },
  };
}

/** 取り込み済みを除いて、1件ずつ保存する（1件の失敗で他を止めない） */
export async function importItems(sb: SupabaseClient, userId: string, source: Material["source"], items: ImportItem[], deps: ImportDeps, deadline: number): Promise<{ added: number; skipped: number; failed: number }> {
  if (!items.length) return { added: 0, skipped: 0, failed: 0 };
  const { data } = await sb.from("sns_materials").select("origin_id").eq("user_id", userId).eq("source", source).in("origin_id", items.map((i) => i.originId).slice(0, 300));
  const have = new Set(((data ?? []) as { origin_id: string }[]).map((r) => r.origin_id));
  let added = 0;
  let failed = 0;
  const todo = items.filter((i) => !have.has(i.originId));
  for (const it of todo) {
    if (Date.now() > deadline) break;
    try {
      const file = await deps.fetchBytes(it.url);
      const ext = file.mime.includes("png") ? "png" : file.mime.includes("webp") ? "webp" : file.mime.includes("mp4") ? "mp4" : file.mime.includes("quicktime") ? "mov" : "jpg";
      const path = `${userId}/materials/${source}-${it.originId.replace(/[^A-Za-z0-9_-]/g, "_").slice(-60)}.${ext}`;
      await deps.upload(path, file);
      const { error } = await sb.from("sns_materials").insert({ user_id: userId, kind: it.kind, source, path, title: it.title.slice(0, 200), body: it.body.slice(0, 2000), meta: { ...(it.meta ?? {}), mime: file.mime, bytes: file.bytes.length }, origin_id: it.originId });
      if (error) throw new Error(error.message);
      added++;
    } catch {
      failed++;
    }
  }
  return { added, skipped: items.length - todo.length, failed };
}

/** 自社のビジネスプロフィール（Google マップ）に載せた写真・動画 */
export async function gbpItems(sb: SupabaseClient, userId: string): Promise<ImportItem[]> {
  const token = await gbpAccessToken(userId);
  if (!token) throw new Error("Google ビジネスプロフィールが連携されていません（店舗の設定から連携できます）");
  const { data: stores } = await sb.from("stores").select("name, meo_gbp_location").eq("owner_id", userId).not("meo_gbp_location", "is", null).limit(10);
  if (!stores?.length) throw new Error("ビジネスプロフィールと紐づいた店舗がありません");
  const out: ImportItem[] = [];
  for (const s of stores as { name: string | null; meo_gbp_location: string }[]) {
    const media = await listMedia(token, s.meo_gbp_location).catch(() => []);
    for (const m of media) {
      out.push({
        originId: m.name,
        kind: m.format === "VIDEO" ? "video" : "image",
        // 写真は大きさを指定して取る（=s0 は元の大きさ）
        url: m.format === "PHOTO" ? `${m.url.replace(/=[^/]*$/, "")}=s1600` : m.url,
        title: `${s.name ?? "店舗"}（${CATEGORY[m.category] ?? "写真"}）`,
        body: m.description,
      });
    }
  }
  return out;
}

const CATEGORY: Record<string, string> = { EXTERIOR: "外観", INTERIOR: "店内", PRODUCT: "商品", AT_WORK: "仕事の様子", FOOD_AND_DRINK: "料理・ドリンク", MENU: "メニュー", COMMON_AREA: "共用部", ROOMS: "部屋", TEAMS: "スタッフ", ADDITIONAL: "その他", COVER: "カバー", PROFILE: "ロゴ" };

/** 自分の X の投稿に付けた画像・動画 */
export async function xItems(userId: string): Promise<ImportItem[]> {
  const cred = await getSnsCredentials(userId, "x");
  if (!cred) throw new Error("X が連携されていません");
  const id = String((cred.profile as { id?: string }).id ?? "");
  const media = await xOwnMedia(cred.accessToken, id, 60);
  return media.map((m) => ({ originId: m.key, kind: m.type === "video" ? "video" : "image", url: m.url, title: "X の投稿から", body: m.text.slice(0, 300), meta: { postId: m.postId } }));
}

/** 自分の Instagram の投稿（画像。動画はサムネイル） */
export async function igItems(userId: string): Promise<ImportItem[]> {
  const cred = await getSnsCredentials(userId, "meta");
  if (!cred) throw new Error("Instagram が連携されていません");
  const igId = String((cred.profile as { igBusinessId?: string }).igBusinessId ?? "");
  const media = await igOwnMedia(cred.accessToken, igId, 40);
  return media.filter((m) => m.mediaUrl).map((m) => ({ originId: m.id, kind: "image" as const, url: m.mediaUrl!, title: "Instagram の投稿から", body: m.caption.slice(0, 300), meta: { permalink: m.permalink } }));
}
