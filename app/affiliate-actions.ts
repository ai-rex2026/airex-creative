"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { askJson, hasAnthropic } from "@/lib/anthropic";
import { fetchKeywordIdeas, fetchSearchVolume, hasDataForSeo } from "@/lib/affiliate/dataforseo";
import { htmlToText, normalizeDomain, safeUrl } from "@/lib/affiliate/domain";
import { isFreshRunning, listEnrichable, runCollectJob, runEnrichEntry, type CollectAutoResult, type EnrichResult, type EnrichableEntry } from "@/lib/affiliate/collect";
import { meterTo } from "@/lib/affiliate/usage";

/**
 * アフィリエイト運用の Server Action（airex-recruiting の調査フェーズを移植）。
 * 本番では Server Action が throw した Error の文面は画面に届かないため、失敗は値で返す。
 * 持ち主は user_id = ログイン中のユーザー（RLS でも守る）。
 */

export type Fail = { ok: false; error: string };
const failOf = (e: unknown, fallback: string): Fail => ({ ok: false, error: e instanceof Error && e.message ? e.message : fallback });

async function ctx(): Promise<{ sb: SupabaseClient; userId: string }> {
  const sb = (await createClient()) as unknown as SupabaseClient;
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user || user.is_anonymous) throw new Error("ログインが必要です");
  return { sb, userId: user.id };
}

const refresh = (campaignId?: string) => {
  revalidatePath("/affiliate");
  if (campaignId) revalidatePath(`/affiliate/${campaignId}`);
};

/* ============ 案件ドラフト（商品LPのURL / テキスト → 案件・KWの提案） ============ */

export type CampaignDraft = {
  client_name: string;
  campaign_name: string;
  product_name: string;
  selling_points: string;
  conversion_point: string;
  keywords: { keyword: string; priority: number; search_volume?: number | null }[];
};

export async function proposeCampaignAction(input: { url: string; text: string }): Promise<{ ok: true; draft: CampaignDraft; inputUrl: string; note?: string } | Fail> {
  try {
    const { sb, userId } = await ctx();
    const inputUrl = safeUrl(input.url.trim());
    const inputText = input.text.trim();
    if (!inputUrl && !inputText) return { ok: false, error: "商品LPのURL、または商品説明のテキストのどちらかを入力してください。" };
    if (!hasAnthropic()) return { ok: false, error: "ANTHROPIC_API_KEY が未設定のため、AI分析を実行できません。" };

    let pageText = "";
    let note: string | undefined;
    if (inputUrl) {
      try {
        const res = await fetch(inputUrl, {
          signal: AbortSignal.timeout(10_000),
          headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36", accept: "text/html,application/xhtml+xml" },
        });
        pageText = htmlToText(await res.text());
        if (!pageText) note = "LPの本文を取得できませんでした（入力テキストのみで分析）。";
      } catch {
        note = "LPの取得に失敗しました（タイムアウト等）。入力テキストのみで分析しています。";
      }
    }
    const material = [inputUrl ? `商品LPのURL: ${inputUrl}` : "", pageText ? `LPから抽出した本文（先頭のみ）:\n${pageText}` : "", inputText ? `担当者からの商品情報・メモ:\n${inputText.slice(0, 8000)}` : ""].filter(Boolean).join("\n\n");

    const out = await askJson<Partial<CampaignDraft>>(
      `あなたは日本のアフィリエイト広告代理店のプランナーです。商材情報から、広告リクルーティング（ランキング/比較メディアへの掲載打診）用の案件ドラフトを作ります。
- client_name: 運営会社名（分からなければ商材名から推定。不明なら空文字）
- campaign_name: 「〇〇（商材名） 掲載獲得」のような簡潔な案件名
- product_name: 商材・サービス名
- selling_points: 訴求ポイント・信用点（箇条書きを「／」区切りの1行に）。LPに書かれている事実だけを使い、書かれていない実績や数字は作らない
- conversion_point: 想定される成果地点（例: 無料相談申込、資料請求、購入。読み取れなければ妥当な推定）
- keywords: 見込み客が検索しそうな日本語キーワードを15〜25個。検索結果に「ランキング／比較／おすすめ」記事が並びやすい語を優先し、「〇〇 おすすめ」「〇〇 比較」「〇〇 ランキング」型を必ず含める。priority は 1（最優先）〜3。`,
      `以下の商材について案件ドラフトを作成してください。

${material}

出力形式（STRICT JSON のみ）:
{"client_name":"...","campaign_name":"...","product_name":"...","selling_points":"...","conversion_point":"...","keywords":[{"keyword":"...","priority":1}]}`,
      { meter: meterTo(sb, { userId, kind: "campaign_draft" }) }
    );
    if (!out || !out.product_name || !Array.isArray(out.keywords)) return { ok: false, error: "AIの分析結果を解析できませんでした。もう一度お試しください。" };

    const draft: CampaignDraft = {
      client_name: String(out.client_name || ""),
      campaign_name: String(out.campaign_name || `${out.product_name} 掲載獲得`),
      product_name: String(out.product_name || ""),
      selling_points: String(out.selling_points || ""),
      conversion_point: String(out.conversion_point || ""),
      keywords: (out.keywords || [])
        .map((k) => ({ keyword: String(k?.keyword || "").trim(), priority: [1, 2, 3].includes(Number(k?.priority)) ? Number(k?.priority) : 3 }))
        .filter((k) => k.keyword),
    };
    if (!draft.keywords.length) return { ok: false, error: "キーワードを提案できませんでした。テキストを追加してもう一度お試しください。" };

    // 提案の時点で検索ボリュームを見せて、どのKWを収集対象にするかを選べるようにする
    if (hasDataForSeo()) {
      const vol = await fetchSearchVolume(draft.keywords.map((k) => k.keyword));
      if (vol.ok) {
        const byKw = new Map(vol.volumes.map((v) => [v.keyword.toLowerCase(), v.search_volume]));
        draft.keywords = draft.keywords.map((k) => ({ ...k, search_volume: byKw.get(k.keyword.toLowerCase()) ?? null })).sort((a, b) => (b.search_volume ?? -1) - (a.search_volume ?? -1));
      }
    }
    return { ok: true, draft, inputUrl, note };
  } catch (e) {
    return failOf(e, "案件の提案に失敗しました");
  }
}

export type RunnableJob = { job_id: string; keyword_id: string; keyword: string };

export async function createCampaignAction(payload: {
  client_name: string;
  campaign_name: string;
  product_name: string;
  selling_points: string;
  conversion_point: string;
  lp_url: string;
  keywords: { keyword: string; priority: number }[];
}): Promise<{ ok: true; campaignId: string } | Fail> {
  try {
    const { sb, userId } = await ctx();
    const seen = new Set<string>();
    const keywords = (payload.keywords || [])
      .map((k) => ({ keyword: String(k.keyword || "").trim(), priority: [1, 2, 3].includes(Number(k.priority)) ? Number(k.priority) : 3 }))
      .filter((k) => k.keyword && !seen.has(k.keyword.toLowerCase()) && !!seen.add(k.keyword.toLowerCase()));
    if (!keywords.length) return { ok: false, error: "キーワードを1つ以上選択してください。" };

    const { data: camp, error } = await sb
      .from("aff_campaigns")
      .insert({
        user_id: userId,
        client_name: String(payload.client_name || "").trim(),
        name: String(payload.campaign_name || "無題の案件"),
        product_name: String(payload.product_name || ""),
        lp_url: safeUrl(String(payload.lp_url || "")),
        conversion_point: String(payload.conversion_point || ""),
        selling_points: String(payload.selling_points || ""),
      })
      .select("id")
      .single();
    if (error || !camp) return { ok: false, error: `案件の作成に失敗しました：${error?.message ?? "不明なエラー"}` };

    const added = await insertKeywords(sb, userId, camp.id, keywords);
    if (!added.ok) return added;
    refresh(camp.id);
    return { ok: true, campaignId: camp.id };
  } catch (e) {
    return failOf(e, "案件を作れませんでした");
  }
}

/** キーワードを登録する（重複は無視）。検索ボリュームは登録時に一度引いておく */
async function insertKeywords(sb: SupabaseClient, userId: string, campaignId: string, list: { keyword: string; priority?: number }[]): Promise<{ ok: true; added: number } | Fail> {
  const { data: existing } = await sb.from("aff_keywords").select("keyword").eq("campaign_id", campaignId);
  const known = new Set((existing ?? []).map((k) => String(k.keyword).toLowerCase()));
  const fresh: { keyword: string; priority: number }[] = [];
  for (const k of list) {
    const kw = k.keyword.trim();
    if (!kw || known.has(kw.toLowerCase())) continue;
    known.add(kw.toLowerCase());
    fresh.push({ keyword: kw, priority: k.priority ?? 3 });
  }
  if (!fresh.length) return { ok: true, added: 0 };

  const volumeByKw = new Map<string, { search_volume: number | null; cpc: number | null; competition: string }>();
  if (hasDataForSeo()) {
    const vol = await fetchSearchVolume(fresh.map((k) => k.keyword));
    if (vol.ok) for (const v of vol.volumes) volumeByKw.set(v.keyword.toLowerCase(), v);
  }
  const at = volumeByKw.size ? new Date().toISOString() : null;
  const { error } = await sb.from("aff_keywords").insert(
    fresh.map((k) => {
      const v = volumeByKw.get(k.keyword.toLowerCase());
      return { user_id: userId, campaign_id: campaignId, keyword: k.keyword, priority: k.priority, search_volume: v?.search_volume ?? null, cpc: v?.cpc ?? null, competition: v?.competition ?? "", volume_updated_at: v ? at : null };
    })
  );
  if (error) return { ok: false, error: `キーワードの登録に失敗しました：${error.message}` };
  return { ok: true, added: fresh.length };
}

export async function lookupKeywordVolumesAction(keywords: string[]): Promise<Record<string, number | null>> {
  try {
    await ctx();
    if (!hasDataForSeo() || !keywords.length) return {};
    const res = await fetchSearchVolume(keywords);
    if (!res.ok) return {};
    const out: Record<string, number | null> = {};
    for (const v of res.volumes) out[v.keyword.toLowerCase()] = v.search_volume;
    return out;
  } catch {
    return {};
  }
}

/* ============ 案件の更新・削除 ============ */

export type CampaignFields = {
  name: string;
  clientName: string;
  productName: string;
  lpUrl: string;
  unitPrice: string;
  conversionPoint: string;
  approvalTerms: string;
  sellingPoints: string;
  genre: string;
  referenceUrl: string;
  draftUrl: string;
  brief: string;
};

export async function updateCampaignAction(id: string, f: CampaignFields): Promise<{ ok: true } | Fail> {
  try {
    const { sb } = await ctx();
    const { error } = await sb
      .from("aff_campaigns")
      .update({
        name: f.name.trim() || "無題の案件",
        client_name: f.clientName.trim(),
        product_name: f.productName.trim(),
        lp_url: safeUrl(f.lpUrl),
        unit_price: f.unitPrice,
        conversion_point: f.conversionPoint,
        approval_terms: f.approvalTerms,
        selling_points: f.sellingPoints,
        genre: f.genre,
        reference_url: safeUrl(f.referenceUrl),
        draft_url: safeUrl(f.draftUrl),
        brief: f.brief,
      })
      .eq("id", id);
    if (error) return { ok: false, error: `保存できませんでした：${error.message}` };
    refresh(id);
    return { ok: true };
  } catch (e) {
    return failOf(e, "保存できませんでした");
  }
}

export async function deleteCampaignAction(id: string): Promise<{ ok: true } | Fail> {
  try {
    const { sb } = await ctx();
    const { error } = await sb.from("aff_campaigns").delete().eq("id", id);
    if (error) return { ok: false, error: `削除できませんでした：${error.message}` };
    refresh();
    return { ok: true };
  } catch (e) {
    return failOf(e, "削除できませんでした");
  }
}

/* ============ キーワード ============ */

export async function addKeywordsAction(campaignId: string, text: string): Promise<{ ok: true; added: number } | Fail> {
  try {
    const { sb, userId } = await ctx();
    const list = text.split(/[\n、,，]+/).map((s) => ({ keyword: s.trim() })).filter((k) => k.keyword);
    const r = await insertKeywords(sb, userId, campaignId, list);
    refresh(campaignId);
    return r;
  } catch (e) {
    return failOf(e, "追加できませんでした");
  }
}

export async function deleteKeywordAction(campaignId: string, id: string): Promise<{ ok: true } | Fail> {
  try {
    const { sb } = await ctx();
    const { error } = await sb.from("aff_keywords").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };
    refresh(campaignId);
    return { ok: true };
  } catch (e) {
    return failOf(e, "削除できませんでした");
  }
}

/** 登録済みKWの検索ボリュームをまとめて取り直す */
export async function refreshVolumesAction(campaignId: string): Promise<{ ok: true; updated: number } | Fail> {
  try {
    const { sb } = await ctx();
    if (!hasDataForSeo()) return { ok: false, error: "DataForSEO の認証情報（DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD）が未設定です。" };
    const { data: kws } = await sb.from("aff_keywords").select("id, keyword").eq("campaign_id", campaignId);
    if (!kws?.length) return { ok: true, updated: 0 };
    const res = await fetchSearchVolume(kws.map((k) => k.keyword as string));
    if (!res.ok) return res;
    const byKw = new Map(res.volumes.map((v) => [v.keyword.toLowerCase(), v]));
    const at = new Date().toISOString();
    let updated = 0;
    for (const k of kws) {
      const v = byKw.get(String(k.keyword).toLowerCase());
      if (!v) continue;
      await sb.from("aff_keywords").update({ search_volume: v.search_volume, cpc: v.cpc, competition: v.competition, volume_updated_at: at }).eq("id", k.id);
      updated++;
    }
    refresh(campaignId);
    return { ok: true, updated };
  } catch (e) {
    return failOf(e, "取り直せませんでした");
  }
}

/**
 * KW候補を出す。登録はせず aff_kw_suggestions に「候補」として積み、採用は人が選ぶ。
 * 候補は2系統：AI が商材から考えた語＋DataForSEO の関連キーワード（実ボリューム付き）。
 */
export async function suggestKeywordsAction(campaignId: string): Promise<{ ok: true; count: number } | Fail> {
  try {
    const { sb, userId } = await ctx();
    const { data: camp } = await sb.from("aff_campaigns").select("*").eq("id", campaignId).single();
    if (!camp) return { ok: false, error: "案件が見つかりません" };
    const { data: kws } = await sb.from("aff_keywords").select("keyword").eq("campaign_id", campaignId);
    const registered = new Set((kws ?? []).map((k) => String(k.keyword).toLowerCase()));
    const candidates = new Map<string, { keyword: string; source: string; reason: string }>();

    if (hasAnthropic()) {
      try {
        const out = await askJson<{ keywords?: { keyword: string; reason?: string }[] }>(
          "あなたは日本のアフィリエイト広告の運用者です。指定された商材について、ランキング/比較メディアが上位表示されやすい検索キーワードを提案します。",
          `商材: ${camp.product_name || camp.name}
ジャンル: ${camp.genre || "—"}
LP: ${camp.lp_url}
成果地点: ${camp.conversion_point}
訴求: ${camp.selling_points}
すでに登録済みのKW（重複させない）: ${(kws ?? []).map((k) => k.keyword).join(" / ") || "なし"}

この商材の掲載を狙うべき検索キーワードを日本語で30個提案してください。
「おすすめ」「比較」「ランキング」「口コミ」など比較記事が上位に来る語に加えて、地域名・悩み・価格帯などの掛け合わせも含めること。
{"keywords":[{"keyword":"...","reason":"狙う理由を15字程度で"}]} の形式で出力してください。`,
          { meter: meterTo(sb, { userId, campaignId, kind: "kw_suggest" }) }
        );
        for (const k of out?.keywords ?? []) {
          const kw = String(k?.keyword || "").trim();
          if (!kw || registered.has(kw.toLowerCase())) continue;
          candidates.set(kw.toLowerCase(), { keyword: kw, source: "ai", reason: String(k?.reason || "") });
        }
      } catch {
        // AI が使えなくても DataForSEO 側の候補は出す
      }
    }
    if (hasDataForSeo()) {
      const seeds = (kws ?? []).map((k) => k.keyword as string).slice(0, 20);
      if (seeds.length) {
        const ideas = await fetchKeywordIdeas(seeds, 60);
        if (ideas.ok) {
          for (const idea of ideas.ideas) {
            const key = idea.keyword.toLowerCase();
            if (registered.has(key)) continue;
            candidates.set(key, { keyword: idea.keyword, source: "dataforseo", reason: "関連キーワード" });
          }
        }
      }
    }
    if (!candidates.size) return { ok: false, error: "候補を出せませんでした（AIも検索APIも使えない状態です）" };

    const list = [...candidates.values()];
    const volumes = new Map<string, { search_volume: number | null; cpc: number | null; competition: string }>();
    if (hasDataForSeo()) {
      const vol = await fetchSearchVolume(list.map((c) => c.keyword));
      if (vol.ok) for (const v of vol.volumes) volumes.set(v.keyword.toLowerCase(), v);
    }
    await sb.from("aff_kw_suggestions").upsert(
      list.map((c) => {
        const v = volumes.get(c.keyword.toLowerCase());
        return { user_id: userId, campaign_id: campaignId, keyword: c.keyword, search_volume: v?.search_volume ?? null, cpc: v?.cpc ?? null, competition: v?.competition ?? "", source: c.source, reason: c.reason, status: "suggested" };
      }),
      { onConflict: "campaign_id,keyword", ignoreDuplicates: true }
    );
    refresh(campaignId);
    return { ok: true, count: list.length };
  } catch (e) {
    return failOf(e, "候補を出せませんでした");
  }
}

/** 候補から選んだKWを実際の収集対象に採用する */
export async function adoptSuggestionsAction(campaignId: string, ids: string[]): Promise<{ ok: true; added: number } | Fail> {
  try {
    const { sb, userId } = await ctx();
    if (!ids.length) return { ok: true, added: 0 };
    const { data: rows } = await sb.from("aff_kw_suggestions").select("id, keyword").eq("campaign_id", campaignId).in("id", ids);
    if (!rows?.length) return { ok: true, added: 0 };
    const r = await insertKeywords(sb, userId, campaignId, rows.map((x) => ({ keyword: String(x.keyword) })));
    if (!r.ok) return r;
    await sb.from("aff_kw_suggestions").update({ status: "adopted" }).in("id", ids);
    refresh(campaignId);
    return r;
  } catch (e) {
    return failOf(e, "採用できませんでした");
  }
}

export async function dismissSuggestionsAction(campaignId: string, ids: string[]): Promise<{ ok: true } | Fail> {
  try {
    const { sb } = await ctx();
    if (ids.length) await sb.from("aff_kw_suggestions").update({ status: "dismissed" }).in("id", ids);
    refresh(campaignId);
    return { ok: true };
  } catch (e) {
    return failOf(e, "伏せられませんでした");
  }
}

/* ============ 収集（1キーワードずつ） ============ */

export async function collectKeywordAction(jobId: string): Promise<CollectAutoResult> {
  try {
    const { sb, userId } = await ctx();
    return await runCollectJob(sb, userId, jobId);
  } catch (e) {
    return failOf(e, "収集に失敗しました");
  }
}

/**
 * 案件の収集ジョブをまとめて用意する。
 * resume: 未実行（pending／ジョブなし）・失敗（error）・中断（stale running）だけ
 * all   : 加えて、完了済みキーワードにも新しいジョブを作って全KWを再収集する（定点観測）
 * 実行そのものはクライアントが collectKeywordAction を1件ずつ呼ぶ。
 */
export async function startCollectionAction(campaignId: string, mode: "resume" | "all" = "resume"): Promise<{ ok: true; jobs: RunnableJob[] } | Fail> {
  try {
    const { sb, userId } = await ctx();
    const { data: kws } = await sb.from("aff_keywords").select("id, keyword").eq("campaign_id", campaignId).order("created_at");
    if (!kws?.length) return { ok: false, error: "この案件にはキーワードがありません。" };

    const { data: jobs } = await sb.from("aff_jobs").select("id, keyword_id, status, started_at, created_at").eq("campaign_id", campaignId).order("created_at", { ascending: false });
    const latest = new Map<string, { id: string; status: string; started_at: string | null }>();
    for (const j of jobs ?? []) if (!latest.has(j.keyword_id as string)) latest.set(j.keyword_id as string, j as { id: string; status: string; started_at: string | null });

    const runnable: RunnableJob[] = [];
    const toCreate: { id: string; keyword: string }[] = [];
    for (const k of kws as { id: string; keyword: string }[]) {
      const j = latest.get(k.id);
      if (!j) toCreate.push(k);
      else if (j.status === "pending" || j.status === "error") runnable.push({ job_id: j.id, keyword_id: k.id, keyword: k.keyword });
      else if (j.status === "running") {
        if (!isFreshRunning(j)) runnable.push({ job_id: j.id, keyword_id: k.id, keyword: k.keyword });
      } else if (j.status === "done" && mode === "all") toCreate.push(k);
    }
    if (toCreate.length) {
      const { data: created } = await sb
        .from("aff_jobs")
        .insert(toCreate.map((k) => ({ user_id: userId, campaign_id: campaignId, keyword_id: k.id, status: "pending", source: "dataforseo" })))
        .select("id, keyword_id");
      const name = new Map(toCreate.map((k) => [k.id, k.keyword]));
      for (const j of created ?? []) runnable.push({ job_id: j.id as string, keyword_id: j.keyword_id as string, keyword: name.get(j.keyword_id as string) ?? "" });
    }
    const order = new Map((kws as { id: string }[]).map((k, i) => [k.id, i]));
    runnable.sort((a, b) => (order.get(a.keyword_id) ?? 0) - (order.get(b.keyword_id) ?? 0));
    refresh(campaignId);
    return { ok: true, jobs: runnable };
  } catch (e) {
    return failOf(e, "収集の準備に失敗しました");
  }
}

/** キーワード1件に実行可能なジョブを用意する（既存の pending/error/stale running があればそれを返す） */
export async function createJobAction(campaignId: string, keywordId: string): Promise<{ ok: true; job: RunnableJob } | Fail> {
  try {
    const { sb, userId } = await ctx();
    const { data: kw } = await sb.from("aff_keywords").select("id, keyword").eq("id", keywordId).maybeSingle();
    if (!kw) return { ok: false, error: "キーワードが見つかりません。" };
    const { data: jobs } = await sb.from("aff_jobs").select("id, status, started_at").eq("keyword_id", keywordId).order("created_at", { ascending: false }).limit(1);
    const j = jobs?.[0] as { id: string; status: string; started_at: string | null } | undefined;
    if (j) {
      if (isFreshRunning(j)) return { ok: false, error: "実行中です。しばらく待ってから画面を更新してください。" };
      if (j.status === "pending" || j.status === "error" || j.status === "running") return { ok: true, job: { job_id: j.id, keyword_id: kw.id as string, keyword: kw.keyword as string } };
    }
    const { data: newJob } = await sb.from("aff_jobs").insert({ user_id: userId, campaign_id: campaignId, keyword_id: keywordId, status: "pending", source: "dataforseo" }).select("id").single();
    if (!newJob) return { ok: false, error: "収集ジョブの作成に失敗しました。" };
    refresh(campaignId);
    return { ok: true, job: { job_id: newJob.id as string, keyword_id: kw.id as string, keyword: kw.keyword as string } };
  } catch (e) {
    return failOf(e, "ジョブを作れませんでした");
  }
}

/* ============ 記事本文の読取（掲載枠の抽出） ============ */

export async function enrichEntryAction(entryId: string, force = false): Promise<EnrichResult> {
  try {
    const { sb, userId } = await ctx();
    return await runEnrichEntry(sb, userId, entryId, { force });
  } catch (e) {
    return failOf(e, "本文を読み取れませんでした");
  }
}

export async function listEnrichableAction(snapshotId: string): Promise<{ ok: true; entries: EnrichableEntry[] } | Fail> {
  try {
    const { sb } = await ctx();
    return await listEnrichable(sb, snapshotId);
  } catch (e) {
    return failOf(e, "読取対象を取得できませんでした");
  }
}

/* ============ メディア台帳 ============ */

export async function updateMediaAction(id: string, f: { name: string; operator: string; category: string; aspType: string; aspName: string; note: string }): Promise<{ ok: true } | Fail> {
  try {
    const { sb } = await ctx();
    const aspType = ["direct", "asp", "unknown"].includes(f.aspType) ? f.aspType : "unknown";
    const { error } = await sb.from("aff_media").update({ name: f.name, operator: f.operator, category: f.category, asp_type: aspType, asp_name: f.aspName, note: f.note }).eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath(`/affiliate/media/${id}`);
    revalidatePath("/affiliate/media");
    revalidatePath("/affiliate/[id]", "page");
    return { ok: true };
  } catch (e) {
    return failOf(e, "保存できませんでした");
  }
}

/** 営業お断りの印。付けるとこのメディアの候補は「対象外」になる（外した候補は自動では戻さない） */
export async function setNoSolicitationAction(id: string, on: boolean, reason: string): Promise<{ ok: true } | Fail> {
  try {
    const { sb } = await ctx();
    const { error } = await sb.from("aff_media").update({ no_solicitation: on, no_solicitation_reason: on ? reason : "" }).eq("id", id);
    if (error) return { ok: false, error: error.message };
    if (on) await sb.from("aff_targets").update({ status: "excluded", status_reason: "営業お断り" }).eq("media_id", id).eq("status", "collected");
    revalidatePath(`/affiliate/media/${id}`);
    revalidatePath("/affiliate/media");
    revalidatePath("/affiliate/[id]", "page");
    return { ok: true };
  } catch (e) {
    return failOf(e, "更新できませんでした");
  }
}

/** 同じメディアが別ドメインで登録されたときの統合。fromId の記事と候補を intoId に付け替えて fromId を消す */
export async function mergeMediaAction(fromId: string, intoId: string): Promise<{ ok: true } | Fail> {
  try {
    const { sb } = await ctx();
    if (!fromId || !intoId || fromId === intoId) return { ok: false, error: "統合先を選んでください" };
    await sb.from("aff_entries").update({ media_id: intoId }).eq("media_id", fromId);
    const { data: fromTargets } = await sb.from("aff_targets").select("id, campaign_id").eq("media_id", fromId);
    for (const t of fromTargets ?? []) {
      const { data: clash } = await sb.from("aff_targets").select("id").eq("campaign_id", t.campaign_id).eq("media_id", intoId).maybeSingle();
      if (clash) await sb.from("aff_targets").delete().eq("id", t.id);
      else await sb.from("aff_targets").update({ media_id: intoId }).eq("id", t.id);
    }
    await sb.from("aff_media").delete().eq("id", fromId);
    revalidatePath("/affiliate/media");
    revalidatePath("/affiliate/[id]", "page");
    return { ok: true };
  } catch (e) {
    return failOf(e, "統合できませんでした");
  }
}

export async function addAspAction(domain: string, aspName: string): Promise<{ ok: true } | Fail> {
  try {
    const { sb, userId } = await ctx();
    const d = normalizeDomain(domain);
    if (!d || !aspName.trim()) return { ok: false, error: "ドメインとASP名を入れてください" };
    const { error } = await sb.from("aff_asp_master").upsert({ user_id: userId, domain: d, asp_name: aspName.trim() }, { onConflict: "user_id,domain" });
    if (error) return { ok: false, error: error.message };
    revalidatePath("/affiliate/media");
    revalidatePath("/affiliate/[id]", "page");
    return { ok: true };
  } catch (e) {
    return failOf(e, "追加できませんでした");
  }
}

export async function deleteAspAction(id: string): Promise<{ ok: true } | Fail> {
  try {
    const { sb } = await ctx();
    await sb.from("aff_asp_master").delete().eq("id", id);
    revalidatePath("/affiliate/media");
    revalidatePath("/affiliate/[id]", "page");
    return { ok: true };
  } catch (e) {
    return failOf(e, "削除できませんでした");
  }
}
