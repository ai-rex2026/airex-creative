import type { SupabaseClient } from "@supabase/supabase-js";
import { diagnose } from "./diagnose";
import { generateCopies, scoreCopies } from "./copy";
import { generateMediaPlan } from "./media-plan";
import { generateSummary } from "./summary";
import { findCompetitors, type CompetitorScan } from "./competitors";
import { generateTactics, type TacticPlan } from "./tactics";
import { generateSnsPlan, type SnsPlan } from "./sns-plan";
import { finishAdOps, generateCampaign, opsTargets, planChannel, type AdOps } from "./ad-ops";
import { hasPlacesApi, scanMeo, type MeoScan } from "./meo";
import { generateKeywords, generateLine, generateLpo, type KeywordPlan, type LinePlan, type LpoPlan } from "./deep";
import { generateOutreach, scanSuggests, type OutreachPlan, type SuggestScan } from "./outreach";
import { scanPrices, type PriceScan } from "./pricing";
import { scanSpeed, type SpeedScan } from "./pagespeed";
import { scanSocial, type SocialScan } from "./social";
import { findSocialCompetitors, type SocialCompetitorPlatform, type SocialCompetitorScan } from "./social-competitors";
import { generateSocialInsights, type SocialInsightPlan } from "./social-insights";
import { checkImages, type ImageScan } from "./image-check";
import { generateKpi, type KpiTree } from "./kpi";
import { generateMeasures, type Measure } from "./measures";
import { fetchGa4, fetchSearchConsole, fetchYoutubeAnalytics, hasGoogleApp, type Ga4Data, type GscData, type YoutubeAnalyticsData } from "./google";
import type { AnalysisMode, BannerCopy, BudgetBand, Diagnosis, MediaPlanItem, Summary } from "./types";
import { estimateSeo, scanSite, type SeoEstimate, type SiteScan } from "./site-scan";
import { addUsage, withAi, type AiProvider, type AiUsageTotal } from "./ai-context";
import { hasGemini } from "./gemini";
import { generateSeoArticles, type SeoArticleSet } from "./seoArticles";
import { classifyIndustryVertical, buildPriorityInstruction, type IndustryVertical, type SectionKey } from "./industryMatrix";

/** 本番と同じ見た目の短いID（英数20文字） */
export function newAnalysisId() {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const buf = new Uint8Array(20);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => chars[b % chars.length]).join("");
}

/**
 * 広告主側でWebサイトに載っていない独自素材を使いたい場合のアップロード画像。
 * path は Supabase Storage の banner-uploads バケット内のパス（公開URLではない。
 * 本人の分析にしか紐付いていないことを毎回確認してから配信する）
 */
export type CustomImage = { path: string; uploadedAt: string };

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
  /** SNSオーガニック運用とSNSキャンペーン企画。古い分析には無い */
  sns_plan: SnsPlan | null;
  ad_ops: AdOps | null;
  meo: MeoScan | null;
  lpo: LpoPlan | null;
  keywords: KeywordPlan | null;
  /** SEO記事設計（H2/H3構成の記事案2本）。古い分析には無い */
  seo_articles: SeoArticleSet | null;
  line_plan: LinePlan | null;
  suggests: SuggestScan | null;
  pricing: PriceScan | null;
  speed: SpeedScan | null;
  social: SocialScan | null;
  /**
   * scanSocial（Apify経由でX・TikTok・Instagramを実測する）を試みた回数。
   * 2026-10-03のApifyクレジット急減事故（cronの安全網が同一分析を重複して拾い、
   * scanSocialが何重にも起動された）の再発防止として、tickStepがこの値で
   * Apify呼び出し回数にハードキャップをかける。将来また別の原因で同じ分析が
   * 何度もtickされても、Apifyを叩く回数そのものは増えない
   */
  social_attempt_count: number;
  /** 直近でscanSocialを試みた時刻。障害調査用のメモで、ロジック上は使っていない */
  social_attempted_at: string | null;
  social_competitors: SocialCompetitorScan | null;
  social_insights: SocialInsightPlan | null;
  image_scan: ImageScan | null;
  custom_images: CustomImage[] | null;
  margin: number | null;
  kpi: KpiTree | null;
  /** 選ばれたKPIのID。自由入力ぶんも id を振ってここに入る */
  kpi_selected: { id: string; name: string; custom?: boolean }[] | null;
  measures: Measure[] | null;
  /** 済みにした施策のID */
  measures_done: string[] | null;
  /** サイトから辿れない材料。別ドメインのLP・非公開SNSなど */
  extra_inputs: { platform: string; url: string }[] | null;
  /**
   * 新規分析フォームで利用者が指定したSNSアカウント。LPにリンクが無い・自動検出が
   * 間違っている場合の補完／上書き用（lib/social.ts の normalizeManualSocialInput で正規化済み）。
   * extra_inputs と違い、ここに入れたものは実際にApify/公式APIで実測の対象になる
   * （scanSocial に渡す。lib/social.ts 参照）。古い分析には無い
   */
  social_manual: { platform: string; url: string; handle: string }[] | null;
  /** 済みにした施策の記録。施策を作り直しても消えない */
  measure_log: { title: string; at: string }[] | null;
  outreach: OutreachPlan | null;
  mode: AnalysisMode;
  budget: BudgetBand | null;
  gsc: GscData | null;
  ga4: Ga4Data | null;
  /** YouTube Studio相当の非公開指標。Google連携があり自チャンネルを検出できた場合だけ入る */
  social_yt_analytics: YoutubeAnalyticsData | null;
  /** このレポートを作るAI。未設定なら最初の工程で連携の有無から決める */
  ai_provider: AiProvider | null;
  /** 使ったAIの量と費用（料金表からの計算値） */
  ai_usage: AiUsageTotal | null;
  /** 17業種別・優先度マトリックスでの分類。診断が終わった時点で決定的に判定する。古い分析には無い */
  industry_vertical: IndustryVertical | null;
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

/** 17業種別・優先度マトリックスから、その章向けの指示文を作る。分類が未確定（古い分析）なら何も足さない */
function priorityNoteFor(a: Analysis, section: SectionKey): string | undefined {
  return a.industry_vertical ? buildPriorityInstruction(a.industry_vertical, section) : undefined;
}

/**
 * 費用を優先して、使えるなら常に Gemini で作る。
 * Google連携・Meta連携・GBP連携・広告アカウント選択の有無では切り替えない
 * （以前はこれらがあるとAnthropicに固定していたが、連携済みの利用者でも
 * Geminiを使いたいという要望のため撤廃）。
 * Gemini が使えない環境（APIキー未設定等）でのみ Anthropic にフォールバックする。
 */
export async function chooseProvider(sb: SupabaseClient, ownerId: string): Promise<AiProvider> {
  void sb;
  void ownerId;
  return hasGemini() ? "gemini" : "anthropic";
}

export async function tick(sb: SupabaseClient, id: string): Promise<Analysis> {
  const { data: head } = await sb.from("analyses").select("owner_id, status, ai_provider").eq("id", id).single();
  if (!head || head.status === "done" || head.status === "failed") return tickStep(sb, id);
  let provider = head.ai_provider as AiProvider | null;
  if (!provider) {
    provider = await chooseProvider(sb, head.owner_id as string);
    await sb.from("analyses").update({ ai_provider: provider }).eq("id", id);
  }
  const { result, calls, fellBack } = await withAi(provider, () => tickStep(sb, id));
  if (calls.length) {
    const { data: u } = await sb.from("analyses").select("ai_usage").eq("id", id).single();
    const ai_usage = addUsage((u?.ai_usage as AiUsageTotal | null) ?? null, provider, calls);
    if (fellBack) ai_usage.fell_back = true;
    await sb.from("analyses").update({ ai_usage }).eq("id", id);
    return { ...result, ai_usage };
  }
  return result;
}

/** 自社SNSの readable な媒体を、SNS競合探し（findSocialCompetitors）・分析結果（generateSocialInsights）の対象にする判定に使う */
const SOCIAL_COMPETITOR_PLATFORM_RE: Record<SocialCompetitorPlatform, RegExp> = {
  YouTube: /youtube/i,
  X: /twitter|^x$/i,
  TikTok: /tiktok/i,
  Instagram: /instagram/i,
};

async function tickStep(sb: SupabaseClient, id: string): Promise<Analysis> {
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
    // サイトから辿れた公式SNSに、新規分析フォームで利用者が指定したSNSアカウント（social_manual。
    // LPにリンクが無い・自動検出が間違っている場合の補完／上書き）を足して、実際に見に行く。
    // YouTubeは公式API、X・TikTok・InstagramはApify Actor経由で実測する（lib/social.ts）。
    // 数十秒かかることがある。
    // owner_id は引数として残しているだけで、現在は使っていない。以前はこれを渡すと依頼主が
    // /settings で連携済みの公式SNSアカウント（OAuth）があればそれを最優先で使っていたが、
    // 連携は分析対象のURL（事業）と紐付くとは限らない・取れるデータがApify実測より乏しいという
    // 理由で、依頼主の方針により2026-10時点では使わない（lib/social.ts の readOfficialAccount
    // のコメント参照。将来「運用」機能を作る際に再検討する想定で、関数自体は残してある）
    if (!a.social && ((a.site?.social ?? []).length > 0 || (a.social_manual ?? []).length > 0)) {
      // Apify呼び出し回数のハードキャップ（2026-10-03のクレジット急減事故の再発防止）。
      // cronの重複拾いは別途ロックで塞いだが、それとは独立に「この分析に対して
      // scanSocialを試みるのは最大2回まで」という上限を設け、どんな原因であれ
      // 同一分析へのApify呼び出しが積み重なり続けることを防ぐ
      const MAX_SOCIAL_ATTEMPTS = 2;
      if (a.social_attempt_count >= MAX_SOCIAL_ATTEMPTS) {
        return await save({
          social: { accounts: [], fetchedAt: new Date().toISOString() },
          step: "サイトを読んでいます",
          progress: 20,
        });
      }
      // Apifyを呼ぶ前に試行回数を先に記録する。呼び出し自体が時間切れで中断しても
      // 「試みた」事実は残るので、再開時に同じ回数分だけ重ねて叩かれることはない
      await save({ social_attempt_count: a.social_attempt_count + 1, social_attempted_at: new Date().toISOString() });
      const social = await scanSocial(a.site, a.owner_id, a.social_manual ?? [], a.id);
      return await save({ social, step: "サイトを読んでいます", progress: 20 });
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
      const industry_vertical = classifyIndustryVertical({
        industry: d.industry,
        product: d.product,
        audience: d.audience,
        title: a.site?.title ?? "",
      });
      return await save({ diagnosis: d, industry_vertical, step: "広告手法を選んでいます", progress: 45 });
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
    // Google連携があり、かつ自社SNSにYouTubeチャンネルが検出できている場合だけ、
    // 公開APIでは取れない非公開指標（推定視聴時間・純増登録者数・主な流入経路）を追加で取り込む
    if (a.social && a.social_yt_analytics === null) {
      const hasYoutube = (a.social.accounts ?? []).some((acc) => /youtube/i.test(acc.platform));
      const empty: YoutubeAnalyticsData = {
        from: "", to: "", views: null, estimatedMinutesWatched: null,
        averageViewDurationSec: null, subscribersGained: null, topTrafficSource: null,
      };
      if (hasYoutube && hasGoogleApp()) {
        const { data: conn } = await sb
          .from("google_connections")
          .select("refresh_token")
          .eq("user_id", a.owner_id)
          .maybeSingle();
        if (conn?.refresh_token) {
          let yt: YoutubeAnalyticsData | null = null;
          try {
            yt = await fetchYoutubeAnalytics(conn.refresh_token);
          } catch {
            // 権限が無い・チャンネルが紐づいていない等。落とさず先へ
          }
          return await save({ social_yt_analytics: yt ?? empty, step: "競合を調べています", progress: 35 });
        }
      }
      return await save({ social_yt_analytics: empty, step: "競合を調べています", progress: 35 });
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
      const plan = await generateMediaPlan(a.diagnosis, a.site, a.budget, priorityNoteFor(a, "media_plan"));
      return await save({ media_plan: plan, step: "広告の運用設計を書いています", progress: 55 });
    }
    // 広告運用設計。媒体ごとの「構成（キャンペーン・広告グループの骨組み）」は互いに独立、
    // 構成が決まった後の「キャンペーン1本ずつの中身」も互いに独立なので、
    // それぞれフェーズ内で残りぶんをまとめて並列生成する（1本ずつ待つと媒体数・本数ぶん往復が積み上がるため）。
    // まとめて生成すると1リクエストの実行時間に収まらないおそれがあるフェーズ単位までは保ち、フェーズの中だけ並列化する
    if (!a.ad_ops?.done) {
      // a.diagnosis は直前までのガードで非nullだが、TSはコールバック（.map内）を跨ぐと
      // プロパティアクセスの絞り込みを保持しないため、ローカル変数に写して明示的に渡す
      const diagnosis = a.diagnosis;
      if (!diagnosis) throw new Error("診断結果が見つかりません");
      const targets = opsTargets(a.media_plan);
      const built = a.ad_ops?.campaigns ?? [];
      const structures = a.ad_ops?.plan ?? [];
      const empty = { tags: [], overLength: [], guard: { level: "green" as const, hits: [] }, flagged: [] };

      const missingChannels = targets.filter((t) => !structures.some((s) => s.channel === t.channel));
      if (missingChannels.length > 0) {
        const newStructures = await Promise.all(missingChannels.map((t) => planChannel(diagnosis, a.site, t)));
        const ops: AdOps = { done: false, plan: [...structures, ...newStructures], campaigns: built, ...empty };
        return await save({
          ad_ops: ops,
          step: `広告の運用設計を書いています（${missingChannels.map((t) => t.channel).join("・")}の構成）`,
          progress: 57,
        });
      }

      const skeletons = structures.flatMap((s) => {
        const item = targets.find((t) => t.channel === s.channel);
        return item ? s.campaigns.map((c) => ({ item, c })) : [];
      });
      const missing = skeletons.filter((k) => !built.some((b) => b.channel === k.item.channel && b.name === k.c.name));
      if (missing.length > 0) {
        const newCampaigns = await Promise.all(missing.map((k) => generateCampaign(diagnosis, a.site, k.item, k.c, a.budget)));
        const ops: AdOps = { done: false, plan: structures, campaigns: [...built, ...newCampaigns], ...empty };
        return await save({
          ad_ops: ops,
          step: `広告の運用設計を書いています（広告文 ${newCampaigns.length}本）`,
          progress: 60,
        });
      }
      const ops = await finishAdOps(built, a.site, a.media_plan, a.diagnosis.industry, structures);
      return await save({ ad_ops: ops, step: "広告以外の施策を整理しています", progress: 62 });
    }
    // ここから先の章（SNS競合調査・広告以外の施策・SNS運用プラン・KPI・LP改善・キーワード・
    // LINE設計・コピー・検索サジェスト）は、互いの出力を必要としない。
    // 1本ずつ待つと章数ぶん往復が積み上がるので、まだ無いぶんをまとめて並列に生成する。
    //
    // 2026-10-04: 以前はこの9章をPromise.allでまとめて待ち、1本でも失敗すると「どれも保存されない」
    // 仕様だった。generateTactics・generateKpi・generateCopiesには.catchが無く例外を投げるため、
    // Promise.all全体が失敗すると、既に成功していたsocial_competitors（Apify実測＝実際に課金される）
    // まで保存されず、次のtickで9章すべてやり直し＝成功していたApify呼び出しまで再度行う、という
    // 無駄な再実行が起きていた（2026-10-03のクレジット急減事故の一因）。
    // そのため章ごとに完了した時点で即保存するよう変更し、1章の失敗が他の章の成果を消さない・
    // 次のtickではまだ無い章だけが再試行されるようにした
    if (
      a.ad_ops?.done &&
      (!a.social_competitors || !a.tactics || !a.sns_plan || !a.kpi || !a.lpo || !a.keywords || !a.line_plan || !a.copies || !a.suggests)
    ) {
      // YouTube・X・TikTok・Instagramは、自社アカウント情報（登録者数・直近の投稿）が
      // 実測できている場合だけ競合アカウントを探して実測し直す。実測が無い媒体は探しに行くだけ無駄になる
      const readableTargets = (["YouTube", "X", "TikTok", "Instagram"] as const).filter((p) =>
        (a.social?.accounts ?? []).some((acc) => acc.readable && SOCIAL_COMPETITOR_PLATFORM_RE[p].test(acc.platform))
      );
      const addr = a.meo?.self?.address ?? "";
      const ward = addr.match(/[都道府県](.*?[市区町村])/)?.[1] ?? "";
      const town = addr.match(/[市区町村]([^\d\s]{2,6})/)?.[1]?.replace(/[東西南北]$/, "") ?? "";
      const areas = [town, ward].filter(Boolean);
      // a.diagnosis はこの時点で非nullだが、その絞り込みは下のクロージャ（jobs[].run）の中では
      // 保持されない（TypeScriptの仕様）ため、ローカル変数に受けてから使う
      const diagnosis = a.diagnosis;

      // 章ごとに { 保存先キー, 実行関数 } を用意する。まだ無い章だけをここに積む
      // （既に a.X が入っている章は、そもそもジョブを作らずスキップする）
      const jobs: { key: keyof Analysis; run: () => Promise<unknown> }[] = [];
      if (!a.social_competitors) {
        jobs.push({
          key: "social_competitors",
          run: () =>
            readableTargets.length === 0
              ? Promise.resolve<SocialCompetitorScan>({ items: [], searchedAt: new Date().toISOString() })
              : findSocialCompetitors(diagnosis, a.url, readableTargets, a.id).catch(
                  () => ({ items: [], searchedAt: new Date().toISOString() }) as SocialCompetitorScan
                ),
        });
      }
      if (!a.tactics) {
        jobs.push({
          key: "tactics",
          run: () =>
            generateTactics(diagnosis, a.site, a.social, a.ad_ops).catch(
              failedChapter<TacticPlan>({ items: [], schedule: [], risks: [] })
            ),
        });
      }
      if (!a.sns_plan) {
        jobs.push({
          key: "sns_plan",
          run: () => generateSnsPlan(diagnosis, a.social).catch(failedChapter<SnsPlan>({ channels: [], campaign: null })),
        });
      }
      if (!a.kpi) {
        jobs.push({
          key: "kpi",
          run: () =>
            generateKpi(diagnosis, a.site, a.pricing, a.meo, a.gsc, a.ga4).catch(
              failedChapter<KpiTree>({ model: "", branches: [], candidates: [] })
            ),
        });
      }
      if (!a.lpo) {
        jobs.push({
          key: "lpo",
          run: () => generateLpo(diagnosis, a.site, priorityNoteFor(a, "lpo")).catch(failedChapter<LpoPlan>({ groups: [] })),
        });
      }
      if (!a.keywords) {
        jobs.push({
          key: "keywords",
          run: () =>
            generateKeywords(diagnosis, a.site, a.gsc, a.meo, priorityNoteFor(a, "keywords")).catch(
              failedChapter<KeywordPlan>({ rows: [], hasRealData: false, technical: [], content: [], meo: [] })
            ),
        });
      }
      if (!a.line_plan) {
        jobs.push({
          key: "line_plan",
          run: () =>
            generateLine(diagnosis, a.site).catch(
              failedChapter<LinePlan>({ skip: null, richMenu: [], steps: [], segments: [] })
            ),
        });
      }
      if (!a.copies) {
        jobs.push({
          key: "copies",
          // BannerCopy[] は配列なので failedChapter（オブジェクト用）は使わず、空配列にフォールバックする
          run: () => generateCopies(diagnosis, 2).catch(() => [] as BannerCopy[]),
        });
      }
      if (!a.suggests) {
        jobs.push({
          key: "suggests",
          run: () =>
            scanSuggests(diagnosis, a.site, areas).catch(
              failedChapter<SuggestScan>({ rows: [], queried: [], fetchedAt: new Date().toISOString() })
            ),
        });
      }

      // 各ジョブは他のジョブの成否と無関係に、完了した時点でそれぞれ即保存する。
      // save() は update(patch) で該当カラムだけを更新するので、同じ行への並行保存は安全
      await Promise.allSettled(
        jobs.map(async (job) => {
          const value = await job.run();
          await save({ [job.key]: value } as Partial<Analysis>);
        })
      );

      return await save({ step: "訴求軸ごとにコピーを書いています", progress: 80 });
    }
    // YouTube・X・TikTok・Instagramはアカウント情報（登録者数・直近の投稿）が実測できている場合だけ、
    // 競合アカウントを探して実測し直す。実測が無い媒体は探しに行くだけ無駄になる
    if (!a.social_insights) {
      let si: SocialInsightPlan = { items: [] };
      try {
        si = await generateSocialInsights(a.diagnosis, a.social, a.social_competitors, a.social_yt_analytics);
      } catch {
        // 作れなくても分析全体は止めない。その媒体の分析結果が空のまま先に進む
      }
      return await save({ social_insights: si, step: "施策を組み立てています", progress: 81 });
    }
    if (!a.measures) {
      // 通常ここには来ない（直前のまとめ生成で必ず埋まる）が、型の安全のための保険
      if (!a.kpi) {
        const kpi = await generateKpi(a.diagnosis, a.site, a.pricing, a.meo, a.gsc, a.ga4);
        return await save({ kpi, step: "施策を組み立てています", progress: 82 });
      }
      const plan = await generateMeasures(
        a.diagnosis, a.site, a.kpi, a.meo, a.pricing, a.extra_inputs ?? [], [], a.social,
        priorityNoteFor(a, "measures")
      );
      return await save({ measures: plan.items ?? [], step: "SEO記事の設計を書いています", progress: 83 });
    }
    // SEO記事設計（H2/H3構成の記事案2本）。対策キーワードが決まった直後に作る
    if (!a.seo_articles) {
      const seo_articles = await generateSeoArticles(a.diagnosis, a.site, a.keywords, priorityNoteFor(a, "seo_articles")).catch(
        failedChapter<SeoArticleSet>({ articles: [] })
      );
      return await save({ seo_articles, step: "外部露出の施策を書いています", progress: 85 });
    }
    if (!a.outreach) {
      // 通常ここには来ない（直前のまとめ生成で必ず埋まる）が、型の安全のための保険
      if (!a.suggests) {
        const suggests = await scanSuggests(a.diagnosis, a.site, []).catch(
          failedChapter<SuggestScan>({ rows: [], queried: [], fetchedAt: new Date().toISOString() })
        );
        return await save({ suggests, step: "勝ち筋を採点しています", progress: 87 });
      }
      const outreach = await generateOutreach(a.diagnosis, a.suggests, a.competitors).catch(
        failedChapter<OutreachPlan>({
          citations: [],
          affiliate: { fit: false, reason: "生成できなかったため判断していません", asps: [], terms: "", caution: null },
          suggestActions: [],
          prThemes: [],
        })
      );
      return await save({ outreach, step: "勝ち筋を採点しています", progress: 88 });
    }
    if (!a.copies) {
      // 通常ここには来ない（直前のまとめ生成で必ず埋まる）が、型の安全のための保険
      const copies = await generateCopies(a.diagnosis, 2);
      return await save({ copies, step: "勝ち筋を採点しています", progress: 86 });
    }
    if (!a.copies[0]?.score) {
      const scored = await scoreCopies(a.diagnosis, a.copies);
      return await save({ copies: scored, step: "要約をまとめています", progress: 92 });
    }
    // バナーに使える写真かを見る。文字が焼き込まれた画像は切り抜くと切れるので、
    // 候補から外すために先に判定しておく
    if (!a.image_scan && (a.site?.images ?? []).length > 0) {
      const image_scan = await checkImages(a.site!.images).catch(() => ({ items: [], checkedAt: new Date().toISOString() }));
      return await save({ image_scan, step: "要約をまとめています", progress: 94 });
    }
    // 表示速度の実測は最後に回す。PSI は返らないことがあり、
    // 途中に置くとレポート全体がそこで止まる
    if (a.url && !a.speed) {
      const speed = await scanSpeed(a.url);
      return await save({ speed, step: "要約をまとめています", progress: 95 });
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
