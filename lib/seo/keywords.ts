/**
 * SEO運用の対策キーワード（2026-10-21 新設）。全体レポートの「対策キーワード」「SEO記事設計」を土台に、
 * キーワードを決める → 記事を書く（自社サイト／サテライトサイト）→ Search Console の実測で順位を見る、を1つの一覧で回す。
 * 月間検索数は AI の推定（5段階。実測ではない）。実測は Search Console の表示・クリック・平均順位だけを使う。
 * このファイルは画面からも読むので、サーバー専用のモジュールを import しない
 */

export type KwKind = "指名" | "地域" | "一般" | "比較";
export type KwPriority = "最高" | "高" | "中" | "低";
export type KwTarget = "site" | "satellite" | "existing";
export type KwStatus = "todo" | "writing" | "published" | "skip";
export type KwSource = "report" | "article_plan" | "gsc" | "manual";

export type KwGscPoint = { to: string; impressions: number; clicks: number; position: number };

export type SeoKeyword = {
  id: string;
  keyword: string;
  kind: KwKind;
  priority: KwPriority;
  difficulty: "低" | "中" | "高" | null;
  /** 月間検索数の推定（5段階）。null は未推定 */
  volume: string | null;
  /** report=全体レポートの推定 / ai=この画面での推定 */
  volumeSource: "report" | "ai" | null;
  target: KwTarget;
  /** 既存ページを直すときのページ、公開した記事の URL */
  targetUrl: string | null;
  status: KwStatus;
  source: KwSource;
  /** レポートの打ち手・記事案のタイトルなど */
  action: string;
  note: string;
  /** この語で作った記事（aio_articles.id） */
  articleIds: string[];
  /** Search Console の実測の推移（新しい順、最大12件） */
  gsc: KwGscPoint[];
  createdAt: string;
};

export const VOLUME_BANDS = ["〜100", "100〜1,000", "1,000〜10,000", "10,000〜100,000", "100,000〜"] as const;
export const TARGET_LABEL: Record<KwTarget, string> = { site: "自社サイト", satellite: "サテライト", existing: "既存ページを直す" };
export const KW_STATUS_LABEL: Record<KwStatus, string> = { todo: "未着手", writing: "作成中", published: "公開済み", skip: "対象外" };
export const KW_SOURCE_LABEL: Record<KwSource, string> = { report: "全体レポート", article_plan: "SEO記事設計", gsc: "Search Console", manual: "手入力" };

/** 照合用の正規化（全角・半角・大文字小文字・空白の揺れを無くす） */
export function normKeyword(k: string): string {
  return k.normalize("NFKC").toLowerCase().replace(/[\s　]+/g, " ").trim();
}

export function kindOf(v: unknown): KwKind {
  const s = String(v ?? "");
  return s === "指名" || s === "地域" || s === "比較" ? s : "一般";
}

/** 書く先の目安：指名・地域は自社サイト、比較・一般のうち「比較・おすすめ・ランキング」系はサテライトサイト */
export function defaultTarget(keyword: string, kind: KwKind, hasSatellite: boolean): KwTarget {
  if (!hasSatellite) return "site";
  if (kind === "指名" || kind === "地域") return "site";
  if (kind === "比較" || /比較|おすすめ|オススメ|ランキング|選び方|人気|評判|口コミ/.test(keyword)) return "satellite";
  return "site";
}

/** 推定の段階の上限（月間）。「100,000〜」は上限なし */
function bandUpper(band: string | null): number | null {
  switch (band) {
    case "〜100":
      return 100;
    case "100〜1,000":
      return 1000;
    case "1,000〜10,000":
      return 10000;
    case "10,000〜100,000":
      return 100000;
    default:
      return null;
  }
}

/** 実測の表示回数（28日）が、推定の段階の上限より多い */
export function moreThanEstimate(k: Pick<SeoKeyword, "volume" | "gsc">): boolean {
  const up = bandUpper(k.volume);
  const last = k.gsc[0];
  return up !== null && !!last && last.impressions > up;
}

/** 決まった型の見立て（AI なし）。公開済みで、28日以上たって平均順位が10位より下なら直す候補 */
export function adviceFor(k: SeoKeyword, articleDates: Record<string, string>): string | null {
  if (k.articleIds.length > 1) return `この語に記事が${k.articleIds.length}本あります。1つの語には1ページを当て、他の記事は別の語に寄せるか統合します（同じ語で自社の記事どうしが順位を食い合わないように）`;
  const last = k.gsc[0];
  if (k.status === "published") {
    const pub = k.articleIds.map((id) => articleDates[id]).filter(Boolean).sort()[0];
    const days = pub ? (Date.now() - new Date(pub).getTime()) / 864e5 : null;
    if (!last) return days !== null && days >= 28 ? "公開から28日以上たっても Search Console に表示がありません。タイトルに語を入れているか、インデックスされているか（Search Console の URL 検査）を確かめます" : null;
    if (days !== null && days >= 28 && last.position > 10)
      return `平均順位 ${last.position} 位です。上位の記事と見比べて足りない話題を足す（リライト）、関連する記事から内部リンクを張る、タイトル・見出しに語を入れる、を試します`;
    if (last.position <= 10 && last.impressions > 0 && last.clicks / last.impressions < 0.02) return "10位以内ですがクリック率が低めです。タイトルと説明文（meta description）を、検索した人の目的に合う言い回しに直します";
  }
  if (k.status === "todo" && last && last.position > 10 && last.impressions >= 50) return `すでに表示が${last.impressions}回あり、平均順位 ${last.position} 位です。この語に答える記事を作るか、表示されているページを直すと伸びしろがあります`;
  return null;
}

export function rowToKeyword(r: Record<string, unknown>): SeoKeyword {
  const pick = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d);
  return {
    id: String(r.id),
    keyword: String(r.keyword ?? ""),
    kind: kindOf(r.kind),
    priority: pick(r.priority, ["最高", "高", "中", "低"] as const, "中"),
    difficulty: r.difficulty === "低" || r.difficulty === "中" || r.difficulty === "高" ? r.difficulty : null,
    volume: (VOLUME_BANDS as readonly string[]).includes(String(r.volume)) ? String(r.volume) : null,
    volumeSource: r.volume_source === "report" || r.volume_source === "ai" ? r.volume_source : null,
    target: pick(r.target, ["site", "satellite", "existing"] as const, "site"),
    targetUrl: (r.target_url as string | null) ?? null,
    status: pick(r.status, ["todo", "writing", "published", "skip"] as const, "todo"),
    source: pick(r.source, ["report", "article_plan", "gsc", "manual"] as const, "manual"),
    action: String(r.action ?? ""),
    note: String(r.note ?? ""),
    articleIds: Array.isArray(r.article_ids) ? (r.article_ids as unknown[]).map(String) : [],
    gsc: Array.isArray(r.gsc) ? (r.gsc as KwGscPoint[]) : [],
    createdAt: String(r.created_at ?? ""),
  };
}

/** 並び：公開前の優先度の高いもの → 作成中 → 公開済み → 対象外 */
export function sortKeywords(list: SeoKeyword[]): SeoKeyword[] {
  const st = { writing: 0, todo: 1, published: 2, skip: 3 } as const;
  const pr = { 最高: 0, 高: 1, 中: 2, 低: 3 } as const;
  return [...list].sort((a, b) => st[a.status] - st[b.status] || pr[a.priority] - pr[b.priority] || (b.gsc[0]?.impressions ?? 0) - (a.gsc[0]?.impressions ?? 0));
}

/** Search Console の行を、対策キーワードに当てて推移を積む（同じ期間は上書き） */
export function mergeGsc(prev: KwGscPoint[], point: KwGscPoint): KwGscPoint[] {
  return [point, ...prev.filter((p) => p.to !== point.to)].sort((a, b) => b.to.localeCompare(a.to)).slice(0, 12);
}

/** 候補にする検索語：表示が一定以上あり、まだ上位に届いていない（11位以下）もの */
export function gscCandidates(rows: { query: string; impressions: number; clicks: number; position: number }[], existing: Set<string>, limit = 15) {
  return rows
    .filter((r) => r.impressions >= 20 && r.position > 10 && !existing.has(normKeyword(r.query)))
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, limit);
}
