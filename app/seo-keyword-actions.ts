"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { askJson } from "@/lib/anthropic";
import { withAi } from "@/lib/ai-context";
import { hasGemini } from "@/lib/gemini";
import { fetchGscQueries, hasGoogleApp } from "@/lib/google";
import { AIO_PROJECT_COLUMNS, rowToProject } from "@/lib/aio/store";
import { CHANNEL_COLUMNS, rowToChannel } from "@/lib/aio/content-store";
import { defaultTarget, gscCandidates, kindOf, mergeGsc, normKeyword, rowToKeyword, VOLUME_BANDS, type KwKind, type KwPriority, type KwStatus, type KwTarget, type SeoKeyword } from "@/lib/seo/keywords";
import type { KeywordPlan } from "@/lib/deep";
import type { SeoArticleSet } from "@/lib/seoArticles";

/**
 * SEO運用の対策キーワード（seo_keywords）の Server Action（2026-10-21 新設）。
 * - 取り込み（全体レポート・SEO記事設計）と Search Console の反映は AI を呼ばない
 * - 月間検索数の推定だけ AI を1回呼ぶ（まだ推定していない語だけ。Gemini があれば Gemini）
 */

export type ActionFail = { ok: false; error: string };
const failOf = (e: unknown, fallback: string): ActionFail => ({ ok: false, error: e instanceof Error && e.message ? e.message : fallback });
const now = () => new Date().toISOString();
const refresh = (id: string) => revalidatePath(`/seo/${id}`);

async function owned(projectId: string) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user || user.is_anonymous) throw new Error("ログイン（無料登録）が必要です");
  const { data } = await sb.from("aio_projects").select(AIO_PROJECT_COLUMNS).eq("id", projectId).eq("owner_id", user.id).maybeSingle();
  if (!data) throw new Error("この対象を操作する権限がありません");
  return { sb, userId: user.id, project: rowToProject(data as Record<string, unknown>) };
}
type Sb = Awaited<ReturnType<typeof owned>>["sb"];

const host = (u: string) => {
  try {
    return new URL(/^https?:\/\//.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

async function loadKeywords(sb: Sb, projectId: string): Promise<SeoKeyword[]> {
  const { data, error } = await sb.from("seo_keywords").select("*").eq("project_id", projectId).limit(500);
  if (error) throw new Error(`対策キーワードを読めませんでした：${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map(rowToKeyword);
}

async function satelliteChannel(sb: Sb, projectId: string) {
  const { data } = await sb.from("aio_channels").select(CHANNEL_COLUMNS).eq("project_id", projectId).eq("kind", "satellite").maybeSingle();
  return data ? rowToChannel(data as Record<string, unknown>) : null;
}

/** 同じドメインの全体レポート（いちばん新しい完成済み）から、対策キーワードと SEO記事設計の狙う語を取り込む */
export async function importReportKeywordsAction(projectId: string): Promise<{ ok: true; added: number; from: string | null } | ActionFail> {
  try {
    const { sb, userId, project } = await owned(projectId);
    if (!project.url) throw new Error("対象の URL が未設定です");
    const h = host(project.url);
    const { data: reps } = await sb.from("analyses").select("id, url, keywords, seo_articles, created_at").eq("owner_id", userId).eq("status", "done").order("created_at", { ascending: false }).limit(30);
    const rep = ((reps ?? []) as { id: string; url: string | null; keywords: KeywordPlan | null; seo_articles: SeoArticleSet | null; created_at: string }[]).find((r) => r.url && host(r.url) === h);
    if (!rep) return { ok: true, added: 0, from: null };
    const have = new Set((await loadKeywords(sb, projectId)).map((k) => normKeyword(k.keyword)));
    const sat = !!(await satelliteChannel(sb, projectId))?.satellite;
    const rows: Record<string, unknown>[] = [];
    const push = (keyword: string, r: Partial<Record<string, unknown>>) => {
      const kw = keyword.trim().slice(0, 120);
      const n = normKeyword(kw);
      if (!kw || have.has(n)) return;
      have.add(n);
      const kind = kindOf(r.kind);
      rows.push({ project_id: projectId, keyword: kw, keyword_norm: n, kind, target: defaultTarget(kw, kind, sat), status: "todo", ...r });
    };
    for (const k of rep.keywords?.rows ?? []) {
      const pr = k.priority === "最高" || k.priority === "高" || k.priority === "中" ? k.priority : "中";
      push(k.keyword, {
        kind: kindOf(k.kind),
        priority: pr,
        difficulty: k.difficulty ?? null,
        volume: k.volume && (VOLUME_BANDS as readonly string[]).includes(k.volume) ? k.volume : null,
        volume_source: k.volume ? "report" : null,
        action: String(k.action ?? "").slice(0, 300),
        source: "report",
      });
    }
    for (const a of rep.seo_articles?.articles ?? []) {
      if (a.targetKeyword) push(a.targetKeyword, { priority: "高", action: `SEO記事設計の記事案：${a.title}`.slice(0, 300), source: "article_plan" });
    }
    if (rows.length) {
      const { error } = await sb.from("seo_keywords").insert(rows);
      if (error) throw new Error(`保存できませんでした：${error.message}`);
    }
    refresh(projectId);
    return { ok: true, added: rows.length, from: rep.created_at };
  } catch (e) {
    return failOf(e, "取り込めませんでした");
  }
}

/**
 * Search Console の直近28日を反映する（自社サイトとサテライトサイトのそれぞれ）。
 * 対策キーワードに当たった語は推移を積み、表示はあるのに11位以下の語を候補として足す
 */
export async function syncKeywordGscAction(projectId: string): Promise<{ ok: true; matched: number; added: number; notes: string[] } | ActionFail> {
  try {
    const { sb, userId, project } = await owned(projectId);
    if (!hasGoogleApp()) throw new Error("Google 連携がこのサーバーで有効になっていません");
    const { data: conn } = await sb.from("google_connections").select("refresh_token").eq("user_id", userId).maybeSingle();
    if (!conn?.refresh_token) throw new Error("Google（Search Console）と連携していません。設定画面から連携してください");
    const sat = await satelliteChannel(sb, projectId);
    const sites: { target: "own" | "satellite"; url: string }[] = [];
    if (project.url) sites.push({ target: "own", url: project.url });
    if (sat?.sourceUrl) sites.push({ target: "satellite", url: sat.sourceUrl });
    if (!sites.length) throw new Error("対象の URL が未設定です");

    const notes: string[] = [];
    const got = await Promise.allSettled(sites.map((s) => fetchGscQueries(String(conn.refresh_token), s.url)));
    const list = await loadKeywords(sb, projectId);
    let matched = 0;
    const candidates: Record<string, unknown>[] = [];
    const have = new Set(list.map((k) => normKeyword(k.keyword)));
    for (let i = 0; i < sites.length; i++) {
      const g = got[i];
      const label = sites[i].target === "own" ? "自社サイト" : "サテライトサイト";
      if (g.status === "rejected") {
        notes.push(`${label}：${g.reason instanceof Error ? g.reason.message : "取得できませんでした"}`);
        continue;
      }
      // 何を見て候補を決めたかを返す（Search Console の画面と数字が合わないときに突き合わせるため）
      const rows = g.value.rows;
      const imp = rows.filter((r) => r.impressions >= 20);
      const low = imp.filter((r) => r.position > 10);
      const dup = low.filter((r) => have.has(normKeyword(r.query))).length;
      notes.push(`${label}：${g.value.site}・${g.value.from}〜${g.value.to}（28日）の${rows.length}語のうち、表示20回以上 ${imp.length}語・そのうち11位以下 ${low.length}語・すでに一覧にある語 ${dup}語`);
      const byQuery = new Map(rows.map((r) => [normKeyword(r.query), r]));
      // その語の書く先のサイトの数字を当てる（既存ページを直す語は自社サイト）
      const mine = list.filter((k) => (sites[i].target === "satellite" ? k.target === "satellite" : k.target !== "satellite"));
      for (const k of mine) {
        const r = byQuery.get(normKeyword(k.keyword));
        if (!r) continue;
        matched++;
        const gsc = mergeGsc(k.gsc, { to: g.value.to, impressions: r.impressions, clicks: r.clicks, position: r.position });
        // 1件ずつその場で保存する（途中で失敗しても、保存できた分は残る）
        await sb.from("seo_keywords").update({ gsc, updated_at: now() }).eq("id", k.id);
      }
      for (const c of gscCandidates(g.value.rows, have)) {
        have.add(normKeyword(c.query));
        candidates.push({
          project_id: projectId,
          keyword: c.query.slice(0, 120),
          keyword_norm: normKeyword(c.query),
          kind: "一般",
          priority: "中",
          target: sites[i].target === "satellite" ? "satellite" : "site",
          status: "todo",
          source: "gsc",
          action: `${label}で表示${c.impressions}回・平均${c.position}位（${g.value.from}〜${g.value.to}）`,
          gsc: [{ to: g.value.to, impressions: c.impressions, clicks: c.clicks, position: c.position }],
        });
      }
    }
    if (candidates.length) {
      const { error } = await sb.from("seo_keywords").insert(candidates);
      if (error) notes.push(`候補を保存できませんでした：${error.message}`);
    }
    refresh(projectId);
    return { ok: true, matched, added: candidates.length, notes };
  } catch (e) {
    return failOf(e, "Search Console の数字を反映できませんでした");
  }
}

const VOLUME_SYSTEM = `あなたはSEOの実務者です。日本のGoogle検索での月間検索数を**推定**します。実測のデータは持っていない前提で、規模感の見当を付けます。
- volume は次の5段階から1つを選ぶ。ピンポイントの数字は書かない：${VOLUME_BANDS.map((b) => `「${b}」`).join("")}
- 指名検索は企業規模・知名度から、地域語は地域の人口規模から、一般語は業種の市場規模から見積もる
- n は変えずにそのまま返す
出力: {"items":[{"n":0,"volume":"100〜1,000"}]}`;

/** まだ推定していない語だけ、月間検索数を AI で推定する（1回の呼び出しで最大40語） */
export async function estimateKeywordVolumesAction(projectId: string): Promise<{ ok: true; estimated: number } | ActionFail> {
  try {
    const { sb, project } = await owned(projectId);
    const todo = (await loadKeywords(sb, projectId)).filter((k) => !k.volume && k.status !== "skip").slice(0, 40);
    if (!todo.length) return { ok: true, estimated: 0 };
    const user = [
      `事業者: ${project.name}`,
      `商材・探し方: ${project.area ? `${project.area}で` : ""}${project.category}`,
      project.notes ? `事業内容: ${project.notes.slice(0, 600)}` : "",
      "キーワード:",
      ...todo.map((k, n) => `${n}. ${k.keyword}（${k.kind}）`),
    ]
      .filter(Boolean)
      .join("\n");
    const call = () => askJson<{ items?: { n?: number; volume?: string }[] }>(VOLUME_SYSTEM, user, { maxTokens: 2500, timeoutMs: 90_000 });
    const res = hasGemini() ? (await withAi("gemini", call)).result : await call();
    const byN = new Map((res.items ?? []).map((x) => [Number(x.n), String(x.volume ?? "")]));
    let estimated = 0;
    for (let n = 0; n < todo.length; n++) {
      const v = byN.get(n);
      if (!v || !(VOLUME_BANDS as readonly string[]).includes(v)) continue;
      await sb.from("seo_keywords").update({ volume: v, volume_source: "ai", updated_at: now() }).eq("id", todo[n].id);
      estimated++;
    }
    refresh(projectId);
    return { ok: true, estimated };
  } catch (e) {
    return failOf(e, "推定できませんでした");
  }
}

export async function addKeywordAction(projectId: string, input: { keyword: string; kind: KwKind; priority: KwPriority; target: KwTarget }): Promise<{ ok: true } | ActionFail> {
  try {
    const { sb } = await owned(projectId);
    const kw = input.keyword.trim().slice(0, 120);
    if (!kw) throw new Error("キーワードを入れてください");
    const { error } = await sb.from("seo_keywords").insert({
      project_id: projectId,
      keyword: kw,
      keyword_norm: normKeyword(kw),
      kind: kindOf(input.kind),
      priority: ["最高", "高", "中", "低"].includes(input.priority) ? input.priority : "中",
      target: ["site", "satellite", "existing"].includes(input.target) ? input.target : "site",
      status: "todo",
      source: "manual",
    });
    if (error) throw new Error(error.code === "23505" ? "同じキーワードがすでにあります" : `保存できませんでした：${error.message}`);
    refresh(projectId);
    return { ok: true };
  } catch (e) {
    return failOf(e, "追加できませんでした");
  }
}

export async function updateKeywordAction(
  projectId: string,
  id: string,
  patch: Partial<{ status: KwStatus; target: KwTarget; priority: KwPriority; targetUrl: string; note: string }>
): Promise<{ ok: true } | ActionFail> {
  try {
    const { sb } = await owned(projectId);
    const row: Record<string, unknown> = { updated_at: now() };
    if (patch.status && ["todo", "writing", "published", "skip"].includes(patch.status)) row.status = patch.status;
    if (patch.target && ["site", "satellite", "existing"].includes(patch.target)) row.target = patch.target;
    if (patch.priority && ["最高", "高", "中", "低"].includes(patch.priority)) row.priority = patch.priority;
    if (typeof patch.targetUrl === "string") row.target_url = patch.targetUrl.trim().slice(0, 600) || null;
    if (typeof patch.note === "string") row.note = patch.note.slice(0, 1000);
    const { error } = await sb.from("seo_keywords").update(row).eq("id", id).eq("project_id", projectId);
    if (error) throw new Error(`保存できませんでした：${error.message}`);
    refresh(projectId);
    return { ok: true };
  } catch (e) {
    return failOf(e, "保存できませんでした");
  }
}

export async function deleteKeywordAction(projectId: string, id: string): Promise<{ ok: true } | ActionFail> {
  try {
    const { sb } = await owned(projectId);
    await sb.from("seo_keywords").delete().eq("id", id).eq("project_id", projectId);
    refresh(projectId);
    return { ok: true };
  } catch (e) {
    return failOf(e, "削除できませんでした");
  }
}
