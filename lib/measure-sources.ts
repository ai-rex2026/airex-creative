import type { AdOps } from "./ad-ops";
import type { KeywordPlan, LinePlan, LpoPlan } from "./deep";
import type { MeoScan } from "./meo";
import { meoStoreActions } from "./meo-actions";
import type { OutreachPlan } from "./outreach";
import type { SpeedScan } from "./pagespeed";
import type { SeoArticleSet } from "./seoArticles";
import type { SnsPlan } from "./sns-plan";
import type { SocialInsightPlan } from "./social-insights";
import type { CategoryKey } from "./summary-tab";

/**
 * サマリータブの施策の「元ネタ台帳」。
 *
 * 2026-10-05: サマリーの施策は、以前は分析データタブとは独立にAIが考えていたため、
 * 分析データに無い施策が出たり、分析データで提案している打ち手がサマリーに出なかったりした。
 * 分析データの各章で既に提案している打ち手を1行ずつ抜き出し、番号・章名・移動先を付けて並べる。
 * サマリーの施策はこの台帳から選んでまとめる（lib/summary-tab.ts の generateSummaryMeasures）。
 *
 * AIは使わない（保存済みの章の中身を並べ直すだけ）。章が無い・作れなかった場合はその章を飛ばす。
 */

export type SourceItem = {
  /** 台帳内の番号（s1, s2 …）。施策の sources から参照する */
  id: string;
  /** 分析データタブでの章の名前（画面のリンクに出す） */
  chapter: string;
  /** 分析データタブの章の見出しの id（画面のリンクの移動先） */
  anchor: string;
  /** カテゴリ別評価のどのカテゴリの話か */
  category: CategoryKey;
  /** 打ち手の中身（1行） */
  text: string;
};

export type LedgerInput = {
  ad_ops: AdOps | null;
  meo: MeoScan | null;
  keywords: KeywordPlan | null;
  seo_articles: SeoArticleSet | null;
  lpo: LpoPlan | null;
  speed: SpeedScan | null;
  sns_plan: SnsPlan | null;
  social_insights: SocialInsightPlan | null;
  line_plan: LinePlan | null;
  outreach: OutreachPlan | null;
};

/** 1章から拾う件数の上限。台帳が長すぎるとAIへの入力が膨らむだけで選ばれない */
const PER_CHAPTER = 6;
const MAX_TEXT = 140;

/** AIが文字列の代わりにオブジェクトを返していた古い分析もあるので、文字列に寄せる */
function str(v: unknown): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const k of ["text", "title", "action", "name", "label"]) if (typeof o[k] === "string") return o[k] as string;
  }
  return "";
}

function clean(v: unknown): string {
  const t = str(v).replace(/\s+/g, " ").trim();
  return t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT - 1)}…` : t;
}

export function buildLedger(a: LedgerInput): SourceItem[] {
  const out: SourceItem[] = [];
  const add = (chapter: string, anchor: string, category: CategoryKey, texts: unknown[]) => {
    const seen = new Set<string>();
    for (const raw of texts) {
      if (seen.size >= PER_CHAPTER) break;
      const text = clean(raw);
      if (!text || seen.has(text)) continue;
      seen.add(text);
      out.push({ id: `s${out.length + 1}`, chapter, anchor, category, text });
    }
  };

  // 計測タグ（必須なのに未導入と確認できたものだけ。要確認は施策の材料にしない）
  const tags = (a.ad_ops?.tags ?? []).filter((t) => t.need === "必須" && t.status === "未導入");
  add("計測タグの導入状況", "sec-tags", "広告の準備", tags.map((t) => `${t.name}のタグが未導入（必須）。${t.note}`));

  // 広告運用設計（キャンペーンを立ち上げる）
  if (a.ad_ops?.done) {
    add(
      "広告運用設計",
      "sec-adops",
      "広告の準備",
      a.ad_ops.campaigns.map((c) => `${c.channel}で「${c.name}」を設計どおりに立ち上げる${c.purpose ? `（${c.purpose}）` : ""}`)
    );
  }

  // MEO（画面の「MEO（Googleマップ）」欄と同じく、店舗の実測から作る改善。店舗が複数あれば
  // レビューの多い順に並んでいるので、主要店舗から拾う）
  add("MEO（Googleマップ対策）", "sec-meo", "MEO", (a.meo?.stores ?? [])
      .slice(0, 3)
      // 「実測できないので管理画面で確認してください」という注記は打ち手ではないので除く
      .flatMap((st) => meoStoreActions(st).filter((x) => !/実測できません/.test(x)).map((x) => `${st.self.name}：${x}`))
  );

  // SEO（技術面）とキーワード・記事
  add("対策キーワード", "sec-kw", "SEO強度", a.keywords?.technical ?? []);
  add("対策キーワード", "sec-kw", "対策キーワード充足度", a.keywords?.content ?? []);
  add(
    "SEO記事設計",
    "sec-seoart",
    "対策キーワード充足度",
    (a.seo_articles?.articles ?? []).map((x) => `SEO記事「${x.title}」（狙う語：${x.targetKeyword}）を公開する`)
  );

  // LP改善（重・中の指摘。セキュリティは「ついでに直すもの」で扱うので除く）
  const lpoItems = (a.lpo?.groups ?? [])
    .filter((g) => g.area !== "セキュリティ")
    .flatMap((g) => g.items.map((it) => (typeof it === "string" ? { text: it, severity: "中" } : it)).map((it) => ({ ...it, area: g.area })))
    .filter((it) => it.severity !== "軽")
    .sort((x, y) => (x.severity === "重" ? 0 : 1) - (y.severity === "重" ? 0 : 1));
  add("LP改善", "sec-lpo", "LP", lpoItems.map((it) => `${it.area}：${str(it.text)}`));
  add(
    "表示速度（実測）",
    "sec-speed",
    "LP",
    (a.speed?.opportunities ?? []).map((o) => `表示速度：${o.title}（短縮の見込み ${o.savingsDisplay}）`)
  );

  // SNS（運用プラン・競合比較からの施策・LINE）
  add(
    "公式SNSアカウント",
    "sec-social",
    "SNS",
    [
      ...(a.sns_plan?.channels ?? []).map(
        (c) => `${c.platform}を${c.status === "新規" ? "開設して" : ""}運用プランどおりに投稿する（頻度：${c.frequency}）`
      ),
      ...(a.sns_plan?.campaign ? [`SNSキャンペーン「${a.sns_plan.campaign.title}」を実施する`] : []),
      ...(a.social_insights?.items ?? []).flatMap((i) => i.measures.map((m) => `${i.platform}：${m.title}`)),
    ]
  );
  if (a.line_plan && !a.line_plan.skip && (a.line_plan.richMenu?.length ?? 0) > 0) {
    add("公式SNSアカウント", "sec-social", "SNS", ["LINE公式アカウントのリッチメニューとステップ配信を、LINEプランどおりに作る"]);
  }

  // 検索サジェスト・外部施策
  add("検索サジェスト", "sec-suggest", "検索サジェスト", a.outreach?.suggestActions ?? []);
  const o = a.outreach;
  add("外部施策", "sec-outreach", "外部施策", [
    ...(o?.citations ?? []).map((c) => `${c.site}への掲載を狙う：${str(c.how)}`),
    ...(o?.affiliate?.fit ? [`アフィリエイトを始める（${(o.affiliate.asps ?? []).join("・")}）。${o.affiliate.terms ?? ""}`] : []),
    ...(o?.prThemes ?? []).map((t) => `PRで出す：${str(t)}`),
    ...(o?.negatives ?? []).map((t) => `ネガティブ対策：${str(t)}`),
  ]);

  return out;
}
