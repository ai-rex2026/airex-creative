import type { SupabaseClient } from "@supabase/supabase-js";
import { diagnose } from "./diagnose";
import { generateCopies, scoreCopies } from "./copy";
import { generateMediaPlan } from "./media-plan";
import { generateSummary } from "./summary";
import { findCompetitors, type CompetitorScan } from "./competitors";
import { generateTactics, type TacticPlan } from "./tactics";
import { finishAdOps, generateCampaign, opsTargets, type AdOps } from "./ad-ops";
import { hasPlacesApi, scanMeo, type MeoScan } from "./meo";
import { generateKeywords, generateLine, generateLpo, type KeywordPlan, type LinePlan, type LpoPlan } from "./deep";
import { generateOutreach, scanSuggests, type OutreachPlan, type SuggestScan } from "./outreach";
import { scanPrices, type PriceScan } from "./pricing";
import { generateKpi, type KpiTree } from "./kpi";
import { generateMeasures, type Measure } from "./measures";
import { fetchGa4, fetchSearchConsole, hasGoogleApp, type Ga4Data, type GscData } from "./google";
import type { AnalysisMode, BannerCopy, BudgetBand, Diagnosis, MediaPlanItem, Summary } from "./types";
import { estimateSeo, scanSite, type SeoEstimate, type SiteScan } from "./site-scan";

/** 本番と同じ見た目の短いID（英数20文字） */
export function newAnalysisId() {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const buf = new Uint8Array(20);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => chars[b % chars.length]).join("");
}

export type Analysis = {
  id: string;
  owner_id: string;
  url: string | null;
  input_text: string | null;
  status: "queued" | "running" | "done" | "failed";
  step: string;
  progress: number;
  error: string | null;
  diagnosis: Diagnosis | null;
  copies: BannerCopy[] | null;
  site: SiteScan | null;
  seo: SeoEstimate | null;
  media_plan: MediaPlanItem[] | null;
  summary: Summary | null;
  competitors: CompetitorScan | null;
  tactics: TacticPlan | null;
  ad_ops: AdOps | null;
  meo: MeoScan | null;
  lpo: LpoPlan | null;
  keywords: KeywordPlan | null;
  line_plan: LinePlan | null;
  suggests: SuggestScan | null;
  pricing: PriceScan | null;
  margin: number | null;
  kpi: KpiTree | null;
  /** 選ばれたKPIのID。自由入力ぶんも id を振ってここに入る */
  kpi_selected: { id: string; name: string; custom?: boolean }[] | null;
  measures: Measure[] | null;
  /** 済みにした施策のID */
  measures_done: string[] | null;
  /** サイトから辿れない材料。別ドメインのLP・非公開SNSなど */
  extra_inputs: { platform: string; url: string }[] | null;
  /** 済みにした施策の記録。施策を作り直しても消えない */
  measure_log: { title: string; at: string }[] | null;
  outreach: OutreachPlan | null;
  mode: AnalysisMode;
  budget: BudgetBand | null;
  gsc: GscData | null;
  ga4: Ga4Data | null;
  created_at: string;
};

/**
 * 1回の呼び出しで工程を1つだけ進める。
 * サーバーレスは1リクエストの実行時間に上限があるため、
 * 「全部やる」ではなく「1歩進めて返す」を繰り返す形にしている。
 */
/**
 * 章ひとつの生成が壊れても、レポート全体を落とさない。
 * 1回のJSON崩れで8分ぶんの分析が丸ごと消えるのは割に合わない。
 * 代わりに「この章は作れなかった」という事実を値の中に残して先へ進む。
 */
function failedChapter<T extends object>(empty: T) {
  return (e: unknown): T => ({ ...empty, error: e instanceof Error ? e.message : String(e) });
}

export async function tick(sb: SupabaseClient, id: string): Promise<Analysis> {
  const { data, error } = await sb.from("analyses").select("*").eq("id", id).single();
  if (error || !data) throw new Error("分析が見つかりません");
  const a = data as Analysis;
  if (a.status === "done" || a.status === "failed") return a;

  const save = async (patch: Partial<Analysis>) => {
    const { data: up } = await sb.from("analyses").update(patch).eq("id", id).select("*").single();
    return (up ?? { ...a, ...patch }) as Analysis;
  };

  try {
    // 最初にサイトの技術面を測る。AIを使わないので数秒で終わる
    if (a.url && !a.site) {
      await save({ status: "running", step: "サイトの構成を調べています", progress: 8 });
      const site = await scanSite(a.url);
      return await save({ site, seo: estimateSeo(site), step: "サイトを読んでいます", progress: 18 });
    }
    if (a.url && hasPlacesApi() && !a.meo) {
      // 失敗しても分析全体は止めない。取れなければ画面に理由を出す
      const meo = await scanMeo(a.site, a.url).catch(() => null);
      if (meo) return await save({ meo, step: "サイトを読んでいます", progress: 22 });
    }
    // MEO だけを見に来た人に、8分かかるレポート一式を作らせない
    if (a.mode === "meo") {
      return await save({ status: "done", step: "完了しました", progress: 100 });
    }
    if (!a.diagnosis) {
      await save({ status: "running", step: "サイトを読んでいます", progress: 15 });
      const d = await diagnose({ url: a.url ?? undefined, text: a.input_text ?? undefined });
      return await save({ diagnosis: d, step: "広告手法を選んでいます", progress: 45 });
    }
    // Google 連携があれば実データを取り込む。無ければ何もしない
    if (a.url && hasGoogleApp() && a.gsc === null && a.ga4 === null) {
      const { data: conn } = await sb
        .from("google_connections")
        .select("refresh_token")
        .eq("user_id", a.owner_id)
        .maybeSingle();
      if (conn?.refresh_token) {
        let gsc: GscData | null = null;
        let ga4: Ga4Data | null = null;
        try {
          gsc = await fetchSearchConsole(conn.refresh_token, a.url);
        } catch {
          // 権限が無い・所有していない等。落とさず先へ
        }
        try {
          ga4 = await fetchGa4(conn.refresh_token, a.url);
        } catch {
          // 同上
        }
        return await save({
          gsc: gsc ?? ({ site: "", from: "", to: "", totals: { clicks: 0, impressions: 0, position: 0 }, queries: [] } as GscData),
          ga4: ga4 ?? ({ property: "", from: "", to: "", sessions: 0, users: 0, channels: [] } as Ga4Data),
          step: "競合を調べています",
          progress: 34,
        });
      }
    }
    // 価格はサイトから実測する。広告費とCV数は公開情報に無いので取りに行かない
    if (a.url && !a.pricing) {
      const hints = [a.diagnosis.product, ...a.diagnosis.strengths, ...a.diagnosis.angles.map((x) => x.name)].join(" ");
      const pricing = await scanPrices(a.url, hints).catch(() => null);
      if (pricing) return await save({ pricing, step: "競合を調べています", progress: 48 });
    }
    if (!a.competitors) {
      // Web検索は1検索ごとに従量課金があるので、失敗しても分析全体は止めない
      let comp: CompetitorScan = { keywords: [], items: [], searchedAt: new Date().toISOString() };
      try {
        comp = await findCompetitors(a.diagnosis, a.url);
      } catch {
        // 取れなければ空のまま進む（画面には「取得できず」と出す）
      }
      return await save({ competitors: comp, step: "広告手法を選んでいます", progress: 50 });
    }
    if (!a.media_plan) {
      const plan = await generateMediaPlan(a.diagnosis, a.site, a.budget);
      return await save({ media_plan: plan, step: "広告の運用設計を書いています", progress: 55 });
    }
    // 媒体1つ＝1工程。まとめて生成すると1リクエストの実行時間に収まらず、
    // 何も保存されないまま再試行を繰り返して進捗が止まる
    if (!a.ad_ops?.done) {
      const targets = opsTargets(a.media_plan);
      const built = a.ad_ops?.campaigns ?? [];
      const next = targets[built.length];
      if (next) {
        const c = await generateCampaign(a.diagnosis, a.site, next);
        const ops: AdOps = {
          done: false, campaigns: [...built, c], tags: [], overLength: [],
          guard: { level: "green", hits: [] }, flagged: [],
        };
        return await save({
          ad_ops: ops,
          step: `広告の運用設計を書いています（${built.length + 1}/${targets.length}）`,
          progress: 55 + Math.round((5 * (built.length + 1)) / targets.length),
        });
      }
      const ops = await finishAdOps(built, a.site, a.media_plan, a.diagnosis.industry);
      return await save({ ad_ops: ops, step: "広告以外の施策を整理しています", progress: 62 });
    }
    if (!a.tactics) {
      const t = await generateTactics(a.diagnosis, a.site);
      return await save({ tactics: t, step: "訴求軸ごとにコピーを書いています", progress: 66 });
    }
    // 施策はKPIに効くものだけを出す。だからKPIの仮説を先に立てる
    if (!a.kpi) {
      const kpi = await generateKpi(a.diagnosis, a.site, a.pricing, a.meo, a.gsc, a.ga4);
      return await save({ kpi, step: "施策を組み立てています", progress: 68 });
    }
    if (!a.measures) {
      const plan = await generateMeasures(a.diagnosis, a.site, a.kpi, a.meo, a.pricing, a.extra_inputs ?? []);
      return await save({ measures: plan.items ?? [], step: "LP改善を書いています", progress: 71 });
    }
    if (!a.lpo) {
      const lpo = await generateLpo(a.diagnosis, a.site).catch(failedChapter<LpoPlan>({ groups: [] }));
      return await save({ lpo, step: "キーワードを選んでいます", progress: 70 });
    }
    if (!a.keywords) {
      const keywords = await generateKeywords(a.diagnosis, a.site, a.gsc, a.meo).catch(
        failedChapter<KeywordPlan>({ rows: [], hasRealData: false, technical: [], content: [], meo: [] })
      );
      return await save({ keywords, step: "LINEの設計を書いています", progress: 74 });
    }
    if (!a.line_plan) {
      const line_plan = await generateLine(a.diagnosis, a.site).catch(
        failedChapter<LinePlan>({ skip: null, richMenu: [], steps: [], segments: [] })
      );
      return await save({ line_plan, step: "訴求軸ごとにコピーを書いています", progress: 78 });
    }
    // サジェストは Google の公開エンドポイントから実測する。AI は使わないので速い
    if (!a.suggests) {
      // 地名は MEO の実測住所から。町名まで細かいとサジェストが返らないので、
      // 「渋谷区」と方角を落とした町名（恵比寿西→恵比寿）の両方を候補にする
      const addr = a.meo?.self?.address ?? "";
      const ward = addr.match(/[都道府県](.*?[市区町村])/)?.[1] ?? "";
      const town = addr.match(/[市区町村]([^\d\s]{2,6})/)?.[1]?.replace(/[東西南北]$/, "") ?? "";
      const areas = [town, ward].filter(Boolean);
      const suggests = await scanSuggests(a.diagnosis, a.site, areas).catch(
        failedChapter<SuggestScan>({ rows: [], queried: [], fetchedAt: new Date().toISOString() })
      );
      return await save({ suggests, step: "外部露出の施策を書いています", progress: 79 });
    }
    if (!a.outreach) {
      const outreach = await generateOutreach(a.diagnosis, a.suggests, a.competitors).catch(
        failedChapter<OutreachPlan>({
          citations: [],
          affiliate: { fit: false, reason: "生成できなかったため判断していません", asps: [], terms: "", caution: null },
          suggestActions: [],
          prThemes: [],
        })
      );
      return await save({ outreach, step: "訴求軸ごとにコピーを書いています", progress: 82 });
    }
    if (!a.copies) {
      const copies = await generateCopies(a.diagnosis, 2);
      return await save({ copies, step: "勝ち筋を採点しています", progress: 86 });
    }
    if (!a.copies[0]?.score) {
      const scored = await scoreCopies(a.diagnosis, a.copies);
      return await save({ copies: scored, step: "要約をまとめています", progress: 92 });
    }
    const summary = await generateSummary(a.diagnosis, a.site, a.seo, a.copies);
    return await save({ summary, status: "done", step: "完了しました", progress: 100 });
  } catch (e) {
    return await save({
      status: "failed",
      step: "失敗しました",
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
