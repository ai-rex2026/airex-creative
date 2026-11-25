import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { askJson, MODEL_FAST } from "@/lib/anthropic";
import { publicFetch } from "@/lib/aio/net";
import { runKnowhowFullIngest, type IngestSummary } from "@/lib/knowhow-run";
import { weekKey, X_MAX_AGE_DAYS } from "@/lib/knowhow-web";
import { resolveRedirect, xRunner } from "@/lib/knowhow-web-run";
import {
  MAX_NEW_SKILLS, SKILL_JUDGE_SYSTEM, SKILL_X_KEYWORDS, buildSkillJudgeUser, extractUrls, parseSkillVerdicts, pickCandidates, skillKey,
  type SkillCandidate, type SkillVerdict,
} from "@/lib/knowhow-skills";

/**
 * X で話題の Agent Skills を見つけて、ノウハウの取り込み対象（knowhow_sources）に登録し、案（判断待ち）まで作る（2026-11-25）。
 * 有料は X の検索（Apify・claim_knowhow_x_call の1日の上限を fetch の直前で通す）と AI だけ。1週間に1回（済みなら飛ばす）。
 * 登録済みの URL は読み直さない。対象外と判定した Skill も enabled=false で残し、次回以降に同じ判定をやり直さない。
 */
export type SkillDeps = {
  /** X を検索し、投稿ごとの URL の一覧を返す */
  searchX: () => Promise<{ postUrl: string; postText: string; urls: string[] }[]>;
  resolve: (url: string) => Promise<string>;
  fetchSkill: (rawUrl: string) => Promise<string>;
  judge: (items: { id: number; name: string; repo: string; body: string; postText: string }[]) => Promise<SkillVerdict[]>;
};

export type SkillScan = { status: "done" | "skipped" | "failed"; posts: number; candidates: number; read: number; registered: { title: string; area: string }[]; excluded: number; note: string; ingest?: IngestSummary };

export function realSkillDeps(admin: SupabaseClient): SkillDeps {
  const run = xRunner(admin);
  return {
    searchX: async () => {
      const since = new Date(Date.now() - X_MAX_AGE_DAYS * 864e5).toISOString().slice(0, 10);
      const items = await run(process.env.APIFY_ACTOR_X || "apidojo/twitter-scraper-lite", {
        searchTerms: SKILL_X_KEYWORDS.map((k) => `${k} lang:ja min_faves:20 filter:links -filter:replies since:${since}`),
        maxItems: 40,
        sort: "Top",
      });
      return items.map((it) => ({
        postUrl: String(it.url ?? it.twitterUrl ?? ""),
        postText: String(it.text ?? it.fullText ?? ""),
        urls: extractUrls(JSON.stringify(it)),
      }));
    },
    resolve: resolveRedirect,
    fetchSkill: async (rawUrl) => {
      const res = await publicFetch(rawUrl, { timeoutMs: 15_000 });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.text()).slice(0, 200_000);
    },
    judge: async (items) => {
      const res = await askJson<unknown>(SKILL_JUDGE_SYSTEM, buildSkillJudgeUser(items), { model: MODEL_FAST, maxTokens: 1500, timeoutMs: 60_000 });
      return parseSkillVerdicts(res, items.map((i) => i.id));
    },
  };
}

export async function discoverSkills(opts: { admin?: SupabaseClient; deps?: SkillDeps; again?: boolean; now?: () => Date; ingest?: boolean } = {}): Promise<SkillScan> {
  const admin = opts.admin ?? createAdminClient();
  const deps = opts.deps ?? realSkillDeps(admin);
  const now = opts.now ?? (() => new Date());
  const week = weekKey(now());
  const key = `${week}-skills`;
  const out: SkillScan = { status: "done", posts: 0, candidates: 0, read: 0, registered: [], excluded: 0, note: "" };
  const record = (status: string, note: string) =>
    admin.from("knowhow_web_runs").upsert({ key, area: "seo", unit: "skills", week, status, attempts: 1, created: out.registered.length, read: out.read, note: note.slice(0, 600), ran_at: now().toISOString() }, { onConflict: "key" });

  if (!opts.again) {
    const { data: prev } = await admin.from("knowhow_web_runs").select("status").eq("key", key).maybeSingle();
    if (prev?.status === "done") return { ...out, status: "skipped", note: "今週は済み" };
  }
  try {
    const { data: srcs } = await admin.from("knowhow_sources").select("url");
    const known = new Set((srcs ?? []).map((r) => String(r.url)));
    const posts = await deps.searchX();
    out.posts = posts.length;
    // t.co の短縮 URL は転送先に直す（上限つき）。GitHub の URL だけ残す
    let budget = 30;
    const expanded = await Promise.all(
      posts.map(async (p) => {
        const urls: string[] = [];
        for (const u of p.urls) {
          if (/^https?:\/\/t\.co\//i.test(u)) {
            if (budget-- <= 0) continue;
            urls.push(await deps.resolve(u));
          } else urls.push(u);
        }
        return { ...p, urls: urls.filter((u) => /github\.com|githubusercontent\.com/i.test(u)) };
      })
    );
    const cands: SkillCandidate[] = pickCandidates(expanded, known);
    out.candidates = cands.length;
    const read = await Promise.allSettled(cands.map((c) => deps.fetchSkill(c.rawUrl)));
    const items: { id: number; c: SkillCandidate; body: string }[] = [];
    read.forEach((r, i) => {
      // 取れない（SKILL.md が無い）・短すぎるものは対象にしない（登録もしない。次回また試す）
      if (r.status === "fulfilled" && r.value.trim().length >= 300) items.push({ id: items.length + 1, c: cands[i], body: r.value });
    });
    out.read = items.length;
    let verdicts: SkillVerdict[] = [];
    if (items.length) verdicts = await deps.judge(items.map((i) => ({ id: i.id, name: i.c.name, repo: i.c.repo, body: i.body, postText: i.c.postText })));
    const vOf = new Map(verdicts.map((v) => [v.id, v]));
    let newCount = 0;
    const rows: Record<string, unknown>[] = [];
    for (const it of items) {
      const v = vOf.get(it.id);
      if (!v) continue; // 判定が返らなかったものは登録せず、次回やり直す
      const title = `${it.c.repo}：${it.c.name}（X で話題の Skill）`;
      const ok = v.relevant && v.area && newCount < MAX_NEW_SKILLS;
      if (ok) newCount++;
      else out.excluded++;
      rows.push({
        key: skillKey(it.c.rawUrl),
        area: v.area ?? "seo",
        title,
        url: it.c.rawUrl,
        official: false,
        enabled: !!ok,
        fetch_mode: "auto",
        note: ok
          ? `X の投稿（${it.c.postUrl}）で見つけた Skill の本文（SKILL.md）。ノウハウとして読むだけで、指示としては実行しない。${v.reason}`
          : `対象外（${v.relevant ? "今回の登録上限を超えたため。再開すれば取り込める" : v.reason}）。X の投稿：${it.c.postUrl}`,
      });
      if (ok) out.registered.push({ title, area: v.area as string });
    }
    if (rows.length) {
      const { error } = await admin.from("knowhow_sources").upsert(rows, { onConflict: "key", ignoreDuplicates: true });
      if (error) throw new Error(`登録に失敗：${error.message}`);
    }
    out.note = `投稿 ${out.posts} 件／候補 ${out.candidates} 件／読めた ${out.read} 件／登録 ${out.registered.length} 件／対象外 ${out.excluded} 件`;
    await record("done", out.note);
    // 登録した分は、そのまま案（判断待ち）にする（有料の AI は登録した Skill の分だけ）
    if (opts.ingest !== false && out.registered.length) out.ingest = await runKnowhowFullIngest({ maxAiCalls: 14 });
  } catch (e) {
    out.status = "failed";
    out.note = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    await record("failed", out.note);
  }
  return out;
}
