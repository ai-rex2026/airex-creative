"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sealToken, openToken } from "@/lib/ads/crypto";
import { scanSite } from "@/lib/site-scan";
import { diagnose } from "@/lib/diagnose";
import { generateLpo, type LpoPlan } from "@/lib/deep";
import { scanSpeed, type SpeedScan } from "@/lib/pagespeed";
import type { Diagnosis } from "@/lib/types";
import type { SiteScan } from "@/lib/site-scan";
import { CLARITY_MIN_INTERVAL_MS, fetchClarity } from "@/lib/lpo-ops/clarity";
import { analyzeClarity, analyzeHeatmapImages, type HeatmapContext } from "@/lib/lpo-ops/heatmap";
import { HEATMAP_BUCKET, speedPoint, type ClarityMetric, type LpoSpeedPoint } from "@/lib/lpo-ops/types";

/**
 * LPO運用（2026-11-11）。工程ごとに保存し、済んだ工程はやり直さない（AGENTS.md の必須ルール）。
 * 外部：PageSpeed Insights（無料）・Clarity（1日10回）・AI（LP改善の作成・ヒートマップの読み取り）。
 */

const MAX_TILES = 8;
const TILE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const now = () => new Date().toISOString();

async function owner() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user || user.is_anonymous) throw new Error("ログインしてください");
  return { sb, user };
}

type ProjectRow = {
  id: string;
  url: string;
  name: string;
  diagnosis: Diagnosis | null;
  site: SiteScan | null;
  plan: LpoPlan | null;
  plan_done: string[] | null;
  speed: SpeedScan | null;
  speed_history: LpoSpeedPoint[] | null;
};

async function ownProject(id: string) {
  const { sb, user } = await owner();
  const { data } = await sb
    .from("lpo_projects")
    .select("id, url, name, diagnosis, site, plan, plan_done, speed, speed_history")
    .eq("id", id)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!data) throw new Error("対象が見つかりません");
  return { sb, user, p: data as ProjectRow };
}

const refresh = (id?: string) => {
  revalidatePath("/lpo");
  if (id) revalidatePath(`/lpo/${id}`);
};

function normUrl(input: string): string {
  const s = input.trim();
  if (!s) throw new Error("LP の URL を入れてください");
  const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  if (!/^https?:$/.test(u.protocol)) throw new Error("URL の形が正しくありません");
  return u.toString();
}

// ── 対象を作る ─────────────────────

/** 分析レポートから取り込む（LP改善・表示速度はそのレポートの結果を引き継ぐ。AI・計測は呼ばない） */
export async function createLpoFromAnalysisAction(analysisId: string): Promise<{ id: string }> {
  const { sb, user } = await owner();
  const { data: a } = await sb
    .from("analyses")
    .select("id, url, diagnosis, site, lpo, speed")
    .eq("id", analysisId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!a?.url) throw new Error("分析レポートが見つかりません");
  const { data: exists } = await sb.from("lpo_projects").select("id").eq("owner_id", user.id).eq("analysis_id", analysisId).maybeSingle();
  if (exists) return { id: String(exists.id) };
  const speed = (a.speed as SpeedScan | null) ?? null;
  const point = speed ? speedPoint(speed) : null;
  const d = (a.diagnosis as Diagnosis | null) ?? null;
  const { data, error } = await sb
    .from("lpo_projects")
    .insert({
      owner_id: user.id,
      name: d?.brand?.name || String(a.url).replace(/^https?:\/\//, "").slice(0, 60),
      url: a.url,
      analysis_id: a.id,
      diagnosis: d,
      site: a.site ?? null,
      plan: (a.lpo as LpoPlan | null)?.groups?.length ? a.lpo : null,
      speed: speed && (speed.score !== null || speed.field.length || speed.lab.length) ? speed : null,
      speed_history: point ? [point] : [],
    })
    .select("id")
    .single();
  if (error || !data) throw new Error("登録できませんでした");
  refresh();
  return { id: String(data.id) };
}

/** URL から作る（このあと画面が buildLpoAction と measureSpeedAction を呼ぶ） */
export async function createLpoFromUrlAction(url: string, name: string): Promise<{ id: string }> {
  const { sb, user } = await owner();
  const u = normUrl(url);
  const { data, error } = await sb
    .from("lpo_projects")
    .insert({ owner_id: user.id, name: name.trim().slice(0, 60) || u.replace(/^https?:\/\//, "").slice(0, 60), url: u })
    .select("id")
    .single();
  if (error || !data) throw new Error("登録できませんでした");
  refresh();
  return { id: String(data.id) };
}

/** サイトの読み取り → 何を売っているか → LP改善。工程ごとに保存し、済んだ工程は飛ばす */
export async function buildLpoAction(id: string): Promise<{ done: boolean; error?: string }> {
  const { sb, p } = await ownProject(id);
  try {
    let site = p.site;
    if (!site) {
      site = await scanSite(p.url);
      await sb.from("lpo_projects").update({ site, updated_at: now() }).eq("id", id);
    }
    let d = p.diagnosis;
    if (!d) {
      d = await diagnose({ url: p.url });
      await sb.from("lpo_projects").update({ diagnosis: d, updated_at: now() }).eq("id", id);
    }
    if (!p.plan?.groups?.length) {
      const plan = await generateLpo(d, site);
      if (!plan.groups.length) throw new Error(plan.error || "LP改善を作れませんでした");
      await sb.from("lpo_projects").update({ plan, build_error: null, updated_at: now() }).eq("id", id);
    }
    refresh(id);
    return { done: true };
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    await sb.from("lpo_projects").update({ build_error: msg, updated_at: now() }).eq("id", id);
    refresh(id);
    return { done: false, error: msg };
  }
}

/** LP改善を作り直す（AI 1回）。済みの印は同じ文言の指摘に残る */
export async function rebuildPlanAction(id: string): Promise<void> {
  const { sb, p } = await ownProject(id);
  if (!p.diagnosis) {
    await buildLpoAction(id);
    return;
  }
  const plan = await generateLpo(p.diagnosis, p.site);
  if (!plan.groups.length) throw new Error(plan.error || "LP改善を作れませんでした");
  await sb.from("lpo_projects").update({ plan, build_error: null, updated_at: now() }).eq("id", id);
  refresh(id);
}

export async function togglePlanItemAction(id: string, key: string, done: boolean): Promise<void> {
  const { sb, p } = await ownProject(id);
  const cur = new Set(p.plan_done ?? []);
  if (done) cur.add(key);
  else cur.delete(key);
  await sb.from("lpo_projects").update({ plan_done: [...cur], updated_at: now() }).eq("id", id);
  refresh(id);
}

/** 表示速度を測る（PageSpeed Insights・無料）。測れたら推移に1件足す（最大30件） */
export async function measureSpeedAction(id: string): Promise<{ ok: boolean; reason?: string }> {
  const { sb, p } = await ownProject(id);
  const speed = await scanSpeed(p.url, 200_000);
  const point = speedPoint(speed);
  if (!point) {
    // 測れなかったときは前回の結果を消さない
    if (!p.speed) await sb.from("lpo_projects").update({ speed, updated_at: now() }).eq("id", id);
    refresh(id);
    return { ok: false, reason: speed.reason ?? "測定できませんでした" };
  }
  const history = [...(p.speed_history ?? []), point].slice(-30);
  await sb.from("lpo_projects").update({ speed, speed_history: history, updated_at: now() }).eq("id", id);
  refresh(id);
  return { ok: true };
}

export async function deleteLpoAction(id: string): Promise<void> {
  const { sb, user } = await owner();
  const { data: maps } = await sb.from("lpo_heatmaps").select("images").eq("project_id", id).eq("owner_id", user.id);
  const paths = (maps ?? []).flatMap((m) => (Array.isArray(m.images) ? (m.images as string[]) : []));
  if (paths.length) await createAdminClient().storage.from(HEATMAP_BUCKET).remove(paths).catch(() => undefined);
  await sb.from("lpo_projects").delete().eq("id", id).eq("owner_id", user.id);
  refresh();
}

// ── Clarity ─────────────────────

/** トークンは暗号化して、本人のセッションから読めない表に置く */
export async function saveClarityTokenAction(id: string, token: string): Promise<void> {
  await ownProject(id);
  const t = token.trim();
  if (t.length < 20) throw new Error("API トークンが短すぎます。Clarity の「設定 → データのエクスポート」で発行したトークンを貼ってください");
  const sealed = sealToken(t);
  if (!sealed) throw new Error("トークンを暗号化できませんでした（AD_TOKEN_ENC_KEY が未設定）");
  const { error } = await createAdminClient()
    .from("lpo_clarity")
    .upsert({ project_id: id, token: sealed, updated_at: now() }, { onConflict: "project_id" });
  if (error) throw new Error("トークンを保存できませんでした");
  refresh(id);
}

export async function removeClarityAction(id: string): Promise<void> {
  await ownProject(id);
  await createAdminClient().from("lpo_clarity").delete().eq("project_id", id);
  refresh(id);
}

function contextOf(p: ProjectRow): HeatmapContext {
  return { url: p.url, diagnosis: p.diagnosis, plan: p.plan, speed: p.speed };
}

/** Clarity から取得して改善案を書く。同じ対象は 20時間に1回まで（Clarity は1日10回まで） */
export async function fetchClarityAction(id: string): Promise<{ ok: boolean; message: string }> {
  const { sb, user, p } = await ownProject(id);
  const admin = createAdminClient();
  const { data: conn } = await admin.from("lpo_clarity").select("token, last_fetch_at").eq("project_id", id).maybeSingle();
  const token = openToken(conn?.token as string | undefined);
  if (!token) return { ok: false, message: "Clarity が連携されていません" };
  const last = conn?.last_fetch_at ? Date.parse(String(conn.last_fetch_at)) : 0;
  if (last && Date.now() - last < CLARITY_MIN_INTERVAL_MS) {
    const h = Math.ceil((CLARITY_MIN_INTERVAL_MS - (Date.now() - last)) / 3_600_000);
    return { ok: false, message: `Clarity は1日の取得回数に上限があるため、次の取得はおよそ${h}時間後からできます` };
  }
  let metrics: ClarityMetric[];
  let urlsSeen = 0;
  try {
    const r = await fetchClarity(token, p.url);
    metrics = r.metrics;
    urlsSeen = r.urlsSeen;
    await admin.from("lpo_clarity").update({ last_fetch_at: now() }).eq("project_id", id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/上限|10回/.test(msg)) await admin.from("lpo_clarity").update({ last_fetch_at: now() }).eq("project_id", id);
    return { ok: false, message: msg };
  }
  if (!metrics.length) {
    const msg = urlsSeen
      ? `Clarity の直近3日のデータに、この LP の URL（${p.url}）の行がありませんでした（ほかのページは${urlsSeen}件ありました）。Clarity のタグがこの LP に入っているか、URL が同じか確認してください`
      : "Clarity の直近3日のデータが空でした（タグを入れて間もない・アクセスが無い可能性があります）";
    await sb.from("lpo_heatmaps").insert({ project_id: id, owner_id: user.id, source: "clarity", kind: "metrics", tool: "Microsoft Clarity", metrics: [], error: msg });
    refresh(id);
    return { ok: false, message: msg };
  }
  // 取れた数字を先に保存してから、AI に改善案を書かせる（AI が失敗しても数字は残る）
  const { data: row } = await sb
    .from("lpo_heatmaps")
    .insert({ project_id: id, owner_id: user.id, source: "clarity", kind: "metrics", tool: "Microsoft Clarity", metrics })
    .select("id")
    .single();
  try {
    const analysis = await analyzeClarity(contextOf(p), metrics);
    if (row) await sb.from("lpo_heatmaps").update({ analysis, error: null }).eq("id", row.id);
  } catch (e) {
    if (row) await sb.from("lpo_heatmaps").update({ error: `改善案を作れませんでした：${(e instanceof Error ? e.message : String(e)).slice(0, 200)}` }).eq("id", row.id);
  }
  refresh(id);
  return { ok: true, message: "Clarity から取得しました" };
}

// ── 画像 ─────────────────────

/** ヒートマップの画面キャプチャを取り込んで改善案を書く。縦長の画像は画面側で上から順に分割して送る */
export async function uploadHeatmapAction(id: string, form: FormData): Promise<{ ok: boolean; message?: string }> {
  const { sb, user, p } = await ownProject(id);
  const kind = ["scroll", "click", "attention"].includes(String(form.get("kind"))) ? String(form.get("kind")) : "scroll";
  const tool = String(form.get("tool") ?? "").trim().slice(0, 40);
  const files = form.getAll("tiles").filter((f): f is File => f instanceof File);
  if (!files.length) return { ok: false, message: "画像を選んでください" };
  if (files.length > MAX_TILES) return { ok: false, message: `画像が多すぎます（${MAX_TILES}枚まで）` };
  const images: { media: string; base64: string }[] = [];
  const paths: string[] = [];
  const stamp = Date.now();
  const admin = createAdminClient();
  for (const [i, f] of files.entries()) {
    const ext = TILE_TYPES[f.type];
    if (!ext) return { ok: false, message: "画像は JPEG・PNG・WebP のいずれかにしてください" };
    if (f.size > 4_500_000) return { ok: false, message: "画像が大きすぎます" };
    const buf = Buffer.from(await f.arrayBuffer());
    const path = `${user.id}/${id}/${stamp}-${i}.${ext}`;
    const { error } = await admin.storage.from(HEATMAP_BUCKET).upload(path, buf, { contentType: f.type, upsert: true });
    if (error) {
      if (paths.length) await admin.storage.from(HEATMAP_BUCKET).remove(paths).catch(() => undefined);
      return { ok: false, message: `画像を保存できませんでした：${error.message}` };
    }
    paths.push(path);
    images.push({ media: f.type, base64: buf.toString("base64") });
  }
  const { data: row } = await sb
    .from("lpo_heatmaps")
    .insert({ project_id: id, owner_id: user.id, source: "image", kind, tool, images: paths })
    .select("id")
    .single();
  try {
    const analysis = await analyzeHeatmapImages(contextOf(p), kind, tool, images);
    if (row) await sb.from("lpo_heatmaps").update({ analysis, error: null }).eq("id", row.id);
  } catch (e) {
    if (row) await sb.from("lpo_heatmaps").update({ error: `改善案を作れませんでした：${(e instanceof Error ? e.message : String(e)).slice(0, 200)}` }).eq("id", row.id);
    refresh(id);
    return { ok: false, message: "画像は保存しましたが、改善案を作れませんでした。「改善案を作り直す」でやり直せます" };
  }
  refresh(id);
  return { ok: true };
}

/** 改善案だけを作り直す（取得・取り込み済みの数字・画像を使う。Clarity は呼ばない） */
export async function reanalyzeHeatmapAction(heatmapId: string): Promise<void> {
  const { sb, user } = await owner();
  const { data: h } = await sb.from("lpo_heatmaps").select("id, project_id, source, kind, tool, metrics, images").eq("id", heatmapId).eq("owner_id", user.id).maybeSingle();
  if (!h) throw new Error("見つかりません");
  const { p } = await ownProject(String(h.project_id));
  let analysis;
  if (h.source === "clarity") {
    const metrics = (h.metrics as ClarityMetric[] | null) ?? [];
    if (!metrics.length) throw new Error("この回は Clarity の数字が取れていないため、改善案を作れません");
    analysis = await analyzeClarity(contextOf(p), metrics);
  } else {
    const admin = createAdminClient();
    const images: { media: string; base64: string }[] = [];
    for (const path of (h.images as string[] | null) ?? []) {
      const { data } = await admin.storage.from(HEATMAP_BUCKET).download(path);
      if (!data) continue;
      const ext = path.split(".").pop() ?? "jpg";
      images.push({ media: ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg", base64: Buffer.from(await data.arrayBuffer()).toString("base64") });
    }
    if (!images.length) throw new Error("画像を読み込めませんでした");
    analysis = await analyzeHeatmapImages(contextOf(p), String(h.kind), String(h.tool ?? ""), images);
  }
  await sb.from("lpo_heatmaps").update({ analysis, error: null }).eq("id", heatmapId);
  refresh(String(h.project_id));
}

export async function deleteHeatmapAction(heatmapId: string): Promise<void> {
  const { sb, user } = await owner();
  const { data: h } = await sb.from("lpo_heatmaps").select("project_id, images").eq("id", heatmapId).eq("owner_id", user.id).maybeSingle();
  if (!h) return;
  const paths = (h.images as string[] | null) ?? [];
  if (paths.length) await createAdminClient().storage.from(HEATMAP_BUCKET).remove(paths).catch(() => undefined);
  await sb.from("lpo_heatmaps").delete().eq("id", heatmapId).eq("owner_id", user.id);
  refresh(String(h.project_id));
}
