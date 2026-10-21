"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { openToken, sealToken } from "@/lib/ads/crypto";
import { fetchPageMetrics, hasGoogleApp } from "@/lib/google";
import { jstPeriodKey } from "@/lib/meo-ops/daily";
import { AIO_CHECK_COLUMNS, AIO_PROJECT_COLUMNS, rowToCheck, rowToProject } from "@/lib/aio/store";
import { ARTICLE_COLUMNS, CHANNEL_COLUMNS, METRIC_COLUMNS, rowToArticle, rowToChannel, rowToMetric } from "@/lib/aio/content-store";
import { analyzeStyle, buildStrategy, collectArticles, measure, noteUser } from "@/lib/aio/style";
import { draftArticle, guardArticle, type ArticleBrief } from "@/lib/aio/article";
import { defaultImageDeps, downloadImage, fillImages } from "@/lib/aio/images";
import { discoverWpApi, wpSavePost, wpUploadImage, wpVerify, type WpConn } from "@/lib/aio/wordpress";
import { sendToWordPress, type WpMedia } from "@/lib/aio/publish";
import { parseNoteMetrics, reviewContent, type NoteRow } from "@/lib/aio/review";
import { assertPublicUrl } from "@/lib/aio/net";
import { ARTICLE_MONTHLY_LIMIT, isWpKind, type AioArticleImage, type AioChannelKind, type AioSatellite } from "@/lib/aio/content-types";
import type { AioPlanItem, AioProject } from "@/lib/aio/types";

/**
 * AIO の「運用」（記事づくり・WordPress 公開・note・効果と改善）の Server Action。
 * 記事・媒体・数字は本人のセッション（RLS）で読み書きし、WordPress の接続（秘密）と画像の保存だけ service role を使う。
 *
 * 外部の AI・WordPress を呼ぶ処理は、工程ごとにその場で保存し、やり直しでは済んだ工程を飛ばす（AGENTS.md）。
 * 公開は「承認して公開」ボタンからだけ（自動では公開しない）。
 */

type Sb = Awaited<ReturnType<typeof createClient>>;

async function me() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) throw new Error("ログインが必要です");
  if (user.is_anonymous) throw new Error("AIO を使うには、先に無料登録してください");
  return { sb, user };
}

async function owned(id: string): Promise<{ sb: Sb; userId: string; project: AioProject }> {
  const { sb, user } = await me();
  const { data } = await sb.from("aio_projects").select(AIO_PROJECT_COLUMNS).eq("id", id).eq("owner_id", user.id).maybeSingle();
  if (!data) throw new Error("この対象を操作する権限がありません");
  return { sb, userId: user.id, project: rowToProject(data as Record<string, unknown>) };
}

async function ownedArticle(articleId: string) {
  const { sb, user } = await me();
  const { data } = await sb.from("aio_articles").select(`${ARTICLE_COLUMNS}, project_id, wp_media`).eq("id", articleId).maybeSingle();
  if (!data) throw new Error("記事が見つかりません");
  const projectId = String((data as Record<string, unknown>).project_id);
  const { data: p } = await sb.from("aio_projects").select(AIO_PROJECT_COLUMNS).eq("id", projectId).eq("owner_id", user.id).maybeSingle();
  if (!p) throw new Error("この記事を操作する権限がありません");
  return {
    sb,
    userId: user.id,
    project: rowToProject(p as Record<string, unknown>),
    article: rowToArticle(data as Record<string, unknown>),
    wpMedia: ((data as Record<string, unknown>).wp_media as WpMedia) ?? {},
  };
}

const KINDS: AioChannelKind[] = ["site", "note", "satellite"];
const asKind = (k: string): AioChannelKind => {
  if (!KINDS.includes(k as AioChannelKind)) throw new Error("未対応の媒体です");
  return k as AioChannelKind;
};
// 自社サイト記事・サテライトサイト・内部対策は SEO運用（/seo）、note・PR TIMES は AIO（/aio）に出す（2026-10-21）
const refresh = (id: string) => {
  revalidatePath(`/aio/${id}`);
  revalidatePath(`/seo/${id}`);
};
/** WordPress の接続の表。サテライトサイトは自社サイトとは別のサイトなので、別の表に持つ */
const wpTable = (kind: AioChannelKind) => (kind === "satellite" ? "aio_wp_satellite_connections" : "aio_wp_connections");
const wpKind = (k: string | undefined): AioChannelKind => (k === "satellite" ? "satellite" : "site");

/**
 * 本番では、Server Action が throw した Error の文面は画面に届かず「An error occurred in the Server Components render」
 * に置き換わる。失敗の理由を人に見せたい操作は、throw せず値で返す。
 */
export type ActionFail = { ok: false; error: string };
const failOf = (e: unknown, fallback: string): ActionFail => ({ ok: false, error: e instanceof Error && e.message ? e.message : fallback });
const now = () => new Date().toISOString();

async function loadChannel(sb: Sb, projectId: string, kind: AioChannelKind) {
  const { data } = await sb.from("aio_channels").select(CHANNEL_COLUMNS).eq("project_id", projectId).eq("kind", kind).maybeSingle();
  return data ? rowToChannel(data as Record<string, unknown>) : null;
}

async function upsertChannel(sb: Sb, projectId: string, kind: AioChannelKind, patch: Record<string, unknown>) {
  const { error } = await sb.from("aio_channels").upsert({ project_id: projectId, kind, ...patch, updated_at: now() }, { onConflict: "project_id,kind" });
  if (error) throw new Error(`保存できませんでした：${error.message}`);
}

// ── 媒体の設定・既存記事の分析・立ち上げ ─────────────────────

/** コラム一覧／note のアカウントの URL を登録する（無いときは hasSource=false で立ち上げ支援へ） */
export async function setAioChannelSourceAction(projectId: string, kindRaw: string, input: { sourceUrl: string; hasSource: boolean }) {
  const kind = asKind(kindRaw);
  const { sb } = await owned(projectId);
  let url: string | null = null;
  if (input.hasSource) {
    url = assertPublicUrl(input.sourceUrl).toString();
    if (kind === "note" && !noteUser(url)) throw new Error("note のアカウントURL（https://note.com/アカウント名）を入れてください");
  }
  await upsertChannel(sb, projectId, kind, { source_url: url, has_source: input.hasSource });
  refresh(projectId);
}

/** 既存記事を読んでトンマナを分析する。読んだ記事（samples）を先に保存し、分析結果をあとから保存する */
export async function analyzeAioChannelAction(projectId: string, kindRaw: string): Promise<{ articles: number; notes: string[]; isWordPress: boolean }> {
  const kind = asKind(kindRaw);
  const { sb, project } = await owned(projectId);
  const ch = await loadChannel(sb, projectId, kind);
  if (!ch?.sourceUrl) throw new Error(kind === "note" ? "note のアカウントURLを先に入れてください" : "コラム（記事一覧）のURLを先に入れてください");
  const got = await collectArticles(kind, ch.sourceUrl);
  const { samples } = measure(got.articles);
  await upsertChannel(sb, projectId, kind, { samples });
  const style = await analyzeStyle(kind, project, got.articles);
  await upsertChannel(sb, projectId, kind, { style, analyzed_at: now() });
  refresh(projectId);
  return { articles: got.articles.length, notes: got.notes, isWordPress: !!got.wpApiRoot };
}

/** コラム／アカウントが無いときの立ち上げ手順と方針 */
export async function buildAioStrategyAction(projectId: string, kindRaw: string) {
  const kind = asKind(kindRaw);
  const { sb, project } = await owned(projectId);
  const strategy = await buildStrategy(kind, project);
  await upsertChannel(sb, projectId, kind, { strategy });
  refresh(projectId);
}

/** サテライトサイトの設定（メディア名・テーマ・運営者・扱う商品）を保存する */
export async function setAioSatelliteAction(projectId: string, input: AioSatellite): Promise<{ ok: true } | ActionFail> {
  try {
    const { sb } = await owned(projectId);
    const t = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
    const items = (Array.isArray(input.items) ? input.items : [])
      .map((i) => ({ name: t(i.name, 80), url: t(i.url, 400), facts: t(i.facts, 1200), own: !!i.own }))
      .filter((i) => i.name)
      .slice(0, 20);
    for (const i of items) if (i.url) assertPublicUrl(i.url);
    const satellite: AioSatellite = { mediaName: t(input.mediaName, 80), theme: t(input.theme, 300), operator: t(input.operator, 120), relation: t(input.relation, 80), items };
    await upsertChannel(sb, projectId, "satellite", { satellite });
    refresh(projectId);
    return { ok: true };
  } catch (e) {
    return failOf(e, "保存できませんでした");
  }
}

// ── 記事 ─────────────────────

/**
 * 記事を1本書いて保存する（画像は次の finishAioArticleAction で作る）。
 * 書き終えたあとに時間が残っていれば、法令チェックもこの場で通す
 */
export async function createAioArticleAction(
  projectId: string,
  kindRaw: string,
  brief: ArticleBrief | null,
  plan?: { planId: string; itemId: string }
): Promise<{ ok: true; id: string } | ActionFail> {
  try {
    return { ok: true, id: await createAioArticle(projectId, kindRaw, brief, plan) };
  } catch (e) {
    return failOf(e, "記事を作れませんでした");
  }
}

async function createAioArticle(
  projectId: string,
  kindRaw: string,
  brief: ArticleBrief | null,
  plan?: { planId: string; itemId: string }
): Promise<string> {
  const started = Date.now();
  const kind = asKind(kindRaw);
  const { sb, project } = await owned(projectId);

  // 月の上限（外部の AI を呼ぶ回数の歯止め）
  const month = jstPeriodKey();
  const [y, m] = month.split("-").map(Number);
  const since = new Date(Date.UTC(y, m - 1, 1) - 9 * 3600e3).toISOString();
  const { count } = await sb.from("aio_articles").select("id", { count: "exact", head: true }).eq("project_id", projectId).gte("created_at", since);
  if ((count ?? 0) >= ARTICLE_MONTHLY_LIMIT) throw new Error(`今月作れる記事の上限（${ARTICLE_MONTHLY_LIMIT}本）に達しました。翌月までお待ちください`);

  const [ch, { data: recent }, { data: latestRow }, { data: mets }] = await Promise.all([
    loadChannel(sb, projectId, kind),
    sb.from("aio_articles").select("title").eq("project_id", projectId).eq("channel", kind).order("created_at", { ascending: false }).limit(20),
    sb.from("aio_checks").select(AIO_CHECK_COLUMNS).eq("project_id", projectId).eq("status", "completed").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    sb.from("aio_article_metrics").select("queries").eq("project_id", projectId).eq("channel", kind).order("created_at", { ascending: false }).limit(30),
  ]);
  const queries = ((mets ?? []) as { queries: unknown }[])
    .flatMap((r) => (Array.isArray(r.queries) ? (r.queries as { query: string; clicks: number; impressions: number; position: number }[]) : []))
    .sort((a, b) => b.impressions - a.impressions)
    .filter((q, i, a) => a.findIndex((x) => x.query === q.query) === i)
    .slice(0, 20);

  const clean: ArticleBrief | null = brief
    ? { title: brief.title?.trim().slice(0, 160), target: brief.target?.trim().slice(0, 160), outline: brief.outline?.trim().slice(0, 1200), note: brief.note?.trim().slice(0, 800) }
    : null;
  if (kind === "satellite" && !(ch?.satellite?.items ?? []).length) throw new Error("サテライトサイトの「扱う商品・サービス」を先に入れてください（記事に書いてよい事実の出どころになります）");
  const d = await draftArticle(kind, project, ch, {
    brief: clean,
    recentTitles: ((recent ?? []) as { title: string }[]).map((r) => r.title),
    latestCheck: latestRow ? rowToCheck(latestRow as Record<string, unknown>) : null,
    queries,
  });
  const { data, error } = await sb
    .from("aio_articles")
    .insert({
      project_id: projectId,
      channel: kind,
      title: d.title,
      slug: d.slug,
      meta_description: d.metaDescription,
      keywords: d.keywords,
      target: d.target,
      body_md: d.bodyMd,
      hashtags: d.hashtags,
      images: d.images,
      status: "draft",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`記事を保存できませんでした：${error?.message ?? ""}`);
  const articleId = data.id as string;

  if (plan) {
    const { data: p } = await sb.from("aio_content_plans").select("items").eq("id", plan.planId).eq("project_id", projectId).maybeSingle();
    const items = Array.isArray(p?.items) ? (p!.items as AioPlanItem[]) : [];
    const next = items.map((i) => (i.id === plan.itemId ? { ...i, status: "drafted" as const, draftId: articleId } : i));
    await sb.from("aio_content_plans").update({ items: next, updated_at: now() }).eq("id", plan.planId).eq("project_id", projectId);
  }

  // 法令チェック：時間が残っていればこの場で（残っていなければ、続けて呼ぶ finishAioArticleAction が必ず通す）
  if (Date.now() - started < 190_000) {
    try {
      const guard = await guardArticle(d, project.industry);
      await sb.from("aio_articles").update({ guard, updated_at: now() }).eq("id", articleId);
    } catch {
      /* finish で通す */
    }
  }
  refresh(projectId);
  return articleId;
}

/** 記事の仕上げ：法令チェック（まだなら）と、まだ無い画像を作る。何度押しても、済んだ分はやり直さない */
export async function finishAioArticleAction(articleId: string): Promise<{ ok: true; made: number; failed: number; guard: string | null; imageErrors: string[] } | ActionFail> {
  try {
    return await finishAioArticle(articleId);
  } catch (e) {
    return failOf(e, "仕上げられませんでした");
  }
}

async function finishAioArticle(articleId: string) {
  const { sb, project, article } = await ownedArticle(articleId);
  let level: string | null = article.guard?.level ?? null;
  if (!article.guard) {
    const guard = await guardArticle(article, project.industry);
    await sb.from("aio_articles").update({ guard, updated_at: now() }).eq("id", articleId);
    level = guard.level;
  }
  const admin = createAdminClient();
  const r = await fillImages(defaultImageDeps(admin), `${project.id}/${articleId}`, article.images, async (images) => {
    await sb.from("aio_articles").update({ images, updated_at: now() }).eq("id", articleId);
  });
  refresh(project.id);
  // 作れなかった画像の理由（画面に出す。保存された最新の状態から拾う）
  const { data: fresh } = await sb.from("aio_articles").select("images").eq("id", articleId).maybeSingle();
  const imageErrors = ((fresh?.images ?? []) as AioArticleImage[]).filter((i) => !i.path && i.error).map((i) => i.error as string);
  return { ok: true as const, ...r, guard: level, imageErrors: [...new Set(imageErrors)] };
}

/** 画像を1枚作り直す（説明を変えてもよい）。WordPress に送り済みなら、次に送るときに新しい画像を送り直す */
export async function regenerateAioImageAction(articleId: string, key: string, prompt?: string): Promise<{ ok: true } | ActionFail> {
  try {
    await regenerateAioImage(articleId, key, prompt);
    return { ok: true };
  } catch (e) {
    return failOf(e, "画像を作れませんでした");
  }
}

async function regenerateAioImage(articleId: string, key: string, prompt?: string) {
  const { sb, project, article, wpMedia } = await ownedArticle(articleId);
  const target = article.images.find((i) => i.key === key);
  if (!target) throw new Error("画像が見つかりません");
  // 上限は「できあがった画像を作り直した回数」。まだ作れていない画像の再試行は数えない（失敗が続いても使い切らない）
  const prev = (target as AioArticleImage & { regen?: number }).regen ?? 0;
  const regen = target.path ? prev + 1 : prev;
  if (regen > 5) throw new Error("この画像は作り直しの上限（5回）に達しました");
  const images = article.images.map((i) => (i.key === key ? { ...i, prompt: prompt?.trim() ? prompt.trim().slice(0, 800) : i.prompt, path: null, hasText: false, error: null, regen } : i));
  const media = { ...wpMedia };
  delete media[key];
  await sb.from("aio_articles").update({ images, wp_media: media, updated_at: now() }).eq("id", articleId);
  const admin = createAdminClient();
  const r = await fillImages(defaultImageDeps(admin), `${project.id}/${articleId}`, images, async (next) => {
    await sb.from("aio_articles").update({ images: next, updated_at: now() }).eq("id", articleId);
  });
  refresh(project.id);
  if (r.failed) {
    const { data: fresh } = await sb.from("aio_articles").select("images").eq("id", articleId).maybeSingle();
    const why = ((fresh?.images ?? []) as AioArticleImage[]).find((i) => i.key === key)?.error;
    throw new Error(why ? `画像を作れませんでした：${why}` : "画像を作れませんでした。説明を変えてもう一度お試しください");
  }
}

/** 人が直した本文を保存する。保存と同時に法令チェックをやり直す */
export async function updateAioArticleAction(articleId: string, patch: { title: string; metaDescription: string; slug: string; bodyMd: string; hashtags: string[] }) {
  const { sb, project } = await ownedArticle(articleId);
  const next = {
    title: patch.title.trim().slice(0, 160),
    metaDescription: patch.metaDescription.trim().slice(0, 200),
    bodyMd: patch.bodyMd.trim(),
  };
  if (!next.title || next.bodyMd.length < 200) throw new Error("タイトルと本文を入れてください");
  const guard = await guardArticle(next, project.industry);
  const slug = patch.slug.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  const { error } = await sb
    .from("aio_articles")
    .update({ title: next.title, meta_description: next.metaDescription, body_md: next.bodyMd, slug, hashtags: patch.hashtags.map((h) => h.replace(/^#/, "").trim()).filter(Boolean).slice(0, 8), guard, updated_at: now() })
    .eq("id", articleId);
  if (error) throw new Error(`保存できませんでした：${error.message}`);
  refresh(project.id);
  return guard.level;
}

export async function deleteAioArticleAction(articleId: string) {
  const { sb, project, article } = await ownedArticle(articleId);
  if (article.status === "published" && isWpKind(article.channel)) throw new Error("WordPress で公開済みの記事です。先に WordPress 側で非公開にしてから削除してください");
  await sb.from("aio_articles").delete().eq("id", articleId);
  const paths = article.images.map((i) => i.path).filter((p): p is string => !!p);
  if (paths.length) await createAdminClient().storage.from("aio-images").remove(paths).catch(() => undefined);
  refresh(project.id);
}

/** note は API が無いので、人が投稿したあとに URL を記録する */
export async function markAioNotePostedAction(articleId: string, url: string | null) {
  const { sb, project, article, userId } = await ownedArticle(articleId);
  if (article.channel !== "note") throw new Error("note の記事ではありません");
  if (url) {
    const u = assertPublicUrl(url, { httpsOnly: true });
    if (!/(^|\.)note\.com$/.test(u.hostname)) throw new Error("note の記事のURL（https://note.com/…）を入れてください");
    await sb.from("aio_articles").update({ status: "published", published_url: u.toString(), published_at: now(), approved_by: userId, updated_at: now() }).eq("id", articleId);
  } else {
    await sb.from("aio_articles").update({ status: "draft", published_url: null, published_at: null, updated_at: now() }).eq("id", articleId);
  }
  refresh(project.id);
}

// ── WordPress ─────────────────────

async function wpConn(projectId: string, kind: AioChannelKind = "site"): Promise<{ conn: WpConn; categoryId: number | null }> {
  const admin = createAdminClient();
  const { data } = await admin.from(wpTable(kind)).select("base_url, wp_user, app_password, category_id").eq("project_id", projectId).maybeSingle();
  if (!data) throw new Error("WordPress と連携していません");
  const pass = openToken(String(data.app_password));
  if (!pass) throw new Error("WordPress のパスワードを読めませんでした。連携し直してください");
  return { conn: { apiRoot: String(data.base_url), user: String(data.wp_user), appPassword: pass }, categoryId: (data.category_id as number | null) ?? null };
}

/** WordPress と連携する（REST の入口を探し、ログインと権限を確かめてから保存する） */
export async function connectAioWordPressAction(projectId: string, input: { siteUrl: string; user: string; appPassword: string }, kindRaw?: string) {
  const kind = wpKind(kindRaw);
  const { project } = await owned(projectId);
  if (!process.env.AD_TOKEN_ENC_KEY) throw new Error("サーバーの暗号鍵（AD_TOKEN_ENC_KEY）が未設定のため、パスワードを保存できません。管理者に設定を依頼してください");
  const user = input.user.trim();
  const appPassword = input.appPassword.replace(/\s+/g, "");
  if (!user || appPassword.length < 16) throw new Error("ユーザー名と、アプリケーションパスワード（24文字）を入れてください");
  const site = assertPublicUrl(input.siteUrl, { httpsOnly: true }).toString();
  // サテライトサイトは第三者ドメインで運営する前提。自社サイトと同じドメインなら止める
  if (kind === "satellite" && project.url) {
    const a = new URL(site).hostname.replace(/^www\./, "");
    const b = new URL(project.url).hostname.replace(/^www\./, "");
    if (a === b || a.endsWith(`.${b}`)) throw new Error("サテライトサイトは自社サイトとは別のドメインで運営します。自社サイトの WordPress は「自社サイト記事」のタブで連携してください");
  }
  const { apiRoot, name } = await discoverWpApi(site);
  const conn = { apiRoot, user, appPassword };
  const v = await wpVerify(conn);
  if (!v.me.canPublish || !v.me.canUpload) throw new Error("このユーザーには投稿の公開・画像のアップロードの権限がありません（編集者以上のユーザーで連携してください）");
  const admin = createAdminClient();
  const { error } = await admin.from(wpTable(kind)).upsert(
    { project_id: projectId, base_url: apiRoot, wp_user: user, app_password: sealToken(appPassword), site_name: name.slice(0, 120), verified_at: now(), updated_at: now() },
    { onConflict: "project_id" }
  );
  if (error) throw new Error(`保存できませんでした：${error.message}`);
  refresh(projectId);
  return { siteName: name, userName: v.me.name, categories: v.categories };
}

export async function listAioWpCategoriesAction(projectId: string, kindRaw?: string) {
  await owned(projectId);
  const { conn } = await wpConn(projectId, wpKind(kindRaw));
  return (await wpVerify(conn)).categories;
}

export async function setAioWpCategoryAction(projectId: string, categoryId: number | null, kindRaw?: string) {
  await owned(projectId);
  await createAdminClient().from(wpTable(wpKind(kindRaw))).update({ category_id: categoryId, updated_at: now() }).eq("project_id", projectId);
  refresh(projectId);
}

export async function disconnectAioWordPressAction(projectId: string, kindRaw?: string) {
  await owned(projectId);
  await createAdminClient().from(wpTable(wpKind(kindRaw))).delete().eq("project_id", projectId);
  refresh(projectId);
}

/**
 * WordPress へ送る。mode "draft" は WordPress の下書きとして送る（公開されない）。
 * mode "publish" は人が「承認して公開」を押したときだけ。表現チェックが済んでいて「要修正」が無いことが条件
 */
export async function sendAioArticleToWpAction(articleId: string, mode: "draft" | "publish") {
  const { sb, project, article, wpMedia, userId } = await ownedArticle(articleId);
  if (!isWpKind(article.channel)) throw new Error("WordPress で公開する記事ではありません");
  if (!article.guard) throw new Error("表現チェックがまだです。「仕上げる」を押してからにしてください");
  if (mode === "draft" && article.status === "published") throw new Error("公開済みの記事です。直した内容は「承認して更新」で反映してください");
  if (mode === "publish" && article.guard.level === "red") throw new Error("表現チェックで「要修正」が残っています。本文を直して保存してから公開してください");
  const { conn, categoryId } = await wpConn(project.id, article.channel);
  // サテライトサイトは運営者の表記が無いと公開しない（PR 表記・運営者の明記をコードで入れるため）
  let satellite: { config: AioSatellite; projectUrl: string | null } | null = null;
  if (article.channel === "satellite") {
    const ch = await loadChannel(sb, project.id, "satellite");
    if (!ch?.satellite?.operator?.trim()) throw new Error("サテライトサイトの設定で「運営者の表記」を入れてから送ってください（記事の冒頭に運営者と PR の表記を自動で入れます）");
    satellite = { config: ch.satellite, projectUrl: project.url };
  }
  const admin = createAdminClient();
  try {
    const r = await sendToWordPress(
      { download: (p) => downloadImage(admin, p), upload: wpUploadImage, savePost: wpSavePost },
      conn,
      article,
      wpMedia,
      { status: mode, categoryId, satellite },
      {
        media: async (m) => {
          await sb.from("aio_articles").update({ wp_media: m, updated_at: now() }).eq("id", articleId);
        },
        post: async (p) => {
          const published = p.status === "publish";
          await sb
            .from("aio_articles")
            .update({
              wp_post_id: p.wpPostId,
              ...(published ? { status: "published", published_url: p.link, published_at: article.publishedAt ?? now(), approved_by: userId } : {}),
              error_message: null,
              updated_at: now(),
            })
            .eq("id", articleId);
        },
      }
    );
    refresh(project.id);
    return { link: r.link, status: r.status };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sb.from("aio_articles").update({ error_message: msg.slice(0, 400), updated_at: now() }).eq("id", articleId);
    refresh(project.id);
    throw new Error(msg);
  }
}

// ── 効果（数字）と改善案 ─────────────────────

const normUrl = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "").replace(/[?#].*$/, "").replace(/\/+$/, "");

/** Search Console・GA4 から、コラムの記事ごとの直近28日の数字を取り込む */
export async function fetchAioSiteMetricsAction(projectId: string, kindRaw?: string): Promise<{ pages: number; notes: string[] }> {
  const kind = wpKind(kindRaw);
  const { sb, userId, project } = await owned(projectId);
  if (!hasGoogleApp()) throw new Error("Google 連携がこのサーバーで有効になっていません");
  const { data: conn } = await sb.from("google_connections").select("refresh_token").eq("user_id", userId).maybeSingle();
  if (!conn?.refresh_token) throw new Error("Google（Search Console・GA4）と連携していません。設定画面から連携してください");
  const ch = await loadChannel(sb, projectId, kind);
  // サテライトサイトは対象（自社）の URL では測らない
  const siteUrl = ch?.sourceUrl ?? (kind === "site" ? project.url : null);
  if (!siteUrl) throw new Error(kind === "satellite" ? "サテライトサイトの記事一覧のURLを先に入れてください" : "コラムのURL（または対象のURL）を先に入れてください");
  const pathPrefix = ch?.analytics?.pathPrefix ?? (ch?.sourceUrl ? new URL(ch.sourceUrl).pathname.replace(/\/+$/, "") || "/" : "/");
  const r = await fetchPageMetrics(String(conn.refresh_token), siteUrl, pathPrefix, { gscSite: ch?.analytics?.gscSite, ga4Property: ch?.analytics?.ga4Property });

  const { data: arts } = await sb.from("aio_articles").select("id, published_url").eq("project_id", projectId).eq("channel", kind).not("published_url", "is", null);
  const byUrl = new Map(((arts ?? []) as { id: string; published_url: string }[]).map((a) => [normUrl(a.published_url), a.id]));
  const rows = r.pages
    .filter((p) => (p.impressions ?? 0) > 0 || (p.views ?? 0) > 0)
    .map((p) => ({
      project_id: projectId,
      channel: kind,
      article_id: byUrl.get(normUrl(p.url)) ?? null,
      url: p.url.slice(0, 600),
      title: p.title.slice(0, 300),
      source: p.impressions !== null ? "gsc" : "ga4",
      period_from: r.from,
      period_to: r.to,
      views: p.views,
      clicks: p.clicks,
      impressions: p.impressions,
      position: p.position,
      engagement_sec: p.engagementSec,
      queries: p.queries,
    }));
  if (rows.length) {
    const { error } = await sb.from("aio_article_metrics").insert(rows);
    if (error) throw new Error(`保存できませんでした：${error.message}`);
  }
  await upsertChannel(sb, projectId, kind, { analytics: { gscSite: r.gscSite, ga4Property: r.ga4Property, pathPrefix } });
  refresh(projectId);
  if (!rows.length && r.notes.length) throw new Error(r.notes.join(" / "));
  return { pages: rows.length, notes: r.notes };
}

/** note の数字（手入力・貼り付け・CSV）を取り込む */
export async function addAioNoteMetricsAction(projectId: string, input: { text?: string; rows?: NoteRow[] }): Promise<number> {
  const { sb } = await owned(projectId);
  const parsed = input.rows?.length ? input.rows : parseNoteMetrics(input.text ?? "");
  if (!parsed.length) throw new Error("読み取れる行がありませんでした。「タイトル, ビュー, スキ, コメント」の順で1行に1記事を入れてください");
  const { data: arts } = await sb.from("aio_articles").select("id, title, published_url").eq("project_id", projectId).eq("channel", "note");
  const list = (arts ?? []) as { id: string; title: string; published_url: string | null }[];
  const today = new Date().toISOString().slice(0, 10);
  const rows = parsed.slice(0, 300).map((p) => {
    const hit = list.find((a) => (p.url && a.published_url && normUrl(a.published_url) === normUrl(p.url)) || (p.title && a.title.trim() === p.title.trim()));
    return {
      project_id: projectId,
      channel: "note",
      article_id: hit?.id ?? null,
      url: p.url || hit?.published_url || "",
      title: p.title || hit?.title || "",
      source: input.rows?.length ? "note_manual" : "note_csv",
      period_to: today,
      views: p.views,
      likes: p.likes,
      comments: p.comments,
    };
  });
  const { error } = await sb.from("aio_article_metrics").insert(rows);
  if (error) throw new Error(`保存できませんでした：${error.message}`);
  refresh(projectId);
  return rows.length;
}

/** 数字を読んで、直す記事と次に書く記事を出す */
export async function reviewAioChannelAction(projectId: string, kindRaw: string) {
  const kind = asKind(kindRaw);
  const { sb, project } = await owned(projectId);
  const [ch, { data: mets }, { data: arts }] = await Promise.all([
    loadChannel(sb, projectId, kind),
    sb.from("aio_article_metrics").select(METRIC_COLUMNS).eq("project_id", projectId).eq("channel", kind).order("created_at", { ascending: false }).limit(300),
    sb.from("aio_articles").select(ARTICLE_COLUMNS).eq("project_id", projectId).eq("channel", kind).order("created_at", { ascending: false }).limit(30),
  ]);
  const body = await reviewContent(
    kind,
    project,
    ch,
    ((mets ?? []) as Record<string, unknown>[]).map(rowToMetric),
    ((arts ?? []) as Record<string, unknown>[]).map(rowToArticle)
  );
  const { error } = await sb.from("aio_content_reviews").insert({ project_id: projectId, channel: kind, body });
  if (error) throw new Error(`保存できませんでした：${error.message}`);
  refresh(projectId);
}
