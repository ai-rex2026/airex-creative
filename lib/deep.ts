import { askJson } from "./anthropic";
import type { Diagnosis } from "./types";
import type { SiteScan } from "./site-scan";
import type { GscData } from "./google";
import type { MeoScan } from "./meo";

/**
 * 実画面で独立章になっていた3つ（LP改善・SEO/MEOのキーワード・LINE）を、
 * 「広告以外の施策」の1行から独立させて設計する。
 */

// ── LP改善（LPO）────────────────────────────────

export type LpoGroup = {
  area: "ファーストビュー" | "CTA・フォーム" | "コンテンツの信頼性" | "表示速度" | "セキュリティ" | string;
  items: string[];
};
export type LpoPlan = { groups: LpoGroup[]; /** 生成に失敗したときの理由。章を空で出す代わりに事実を残す */ error?: string };

export async function generateLpo(d: Diagnosis, site: SiteScan | null): Promise<LpoPlan> {
  // セキュリティと表示速度は実測があるので、AI に推測させずこちらで作る
  const measured: LpoGroup[] = [];
  if (site) {
    const ng = site.headers.filter((h) => !h.pass);
    const items: string[] = [];
    for (const h of ng) {
      items.push(`${h.label}（${h.desc}）が未設定。サーバーまたはCDNのレスポンスヘッダーに追加する`);
    }
    if (!site.https) items.push("HTTPS に未対応。常時SSL化する");
    if (items.length) measured.push({ area: "セキュリティ", items });
  }


  // 表示速度は PageSpeed Insights の実測を、専用の章で数字ごと出す。
  // 測定は返らないことがあるので工程の最後に回しており、ここでは持っていない。

  const res = await askJson<LpoPlan>(
    `あなたはランディングページ改善（LPO）の実務者です。広告の受け皿としてサイトを直す指摘を出します。

守ること:
- groups は「ファーストビュー」「CTA・フォーム」「コンテンツの信頼性」の3つ
  （表示速度は実測から別に作るので、ここでは書かない）
- items は各3〜5件。**この商材の事実（強み・価格・実績）を使って書く**。一般論は書かない
  悪い例：「ファーストビューを分かりやすくする」
  良い例：「症例数5,000件という実績を、ファーストビューの見出し直下に置く」
- 「体制を整える」「最適化する」のようなプロセス語は禁止。何を・どこに・どう変えるかを書く
- 効果を断定する表現は書かない`,
    `商材: ${d.product}
ターゲット: ${d.audience}
業種: ${d.industry}
強み: ${d.strengths.join(" / ")}
買わない理由: ${d.objections.join(" / ")}
訴求軸: ${d.angles.map((a) => `${a.name}（${a.why}）`).join(" / ")}
${site ? `サイトのタイトル: ${site.title}\n説明: ${site.description}` : ""}

出力: {"groups":[{"area":"","items":[""]}]}`,
    { maxTokens: 3500 }
  );

  return { groups: [...(res.groups ?? []), ...measured] };
}

// ── SEO/MEO キーワードプラン ──────────────────────

export type KeywordRow = {
  keyword: string;
  kind: "指名" | "地域" | "一般" | "比較" | string;
  difficulty: "低" | "中" | "高";
  priority: "最高" | "高" | "中";
  action: string;
  /**
   * 月間検索数の推定（AI）。「100〜1,000」のような幅で持つ。実測ではないので画面では必ず「推定」と出す。
   * 古い分析には無い
   */
  volume?: string | null;
  /** Search Console の実測。連携が無ければ null のまま */
  impressions: number | null;
  clicks: number | null;
  position: number | null;
};

export type KeywordPlan = {
  rows: KeywordRow[];
  /** 実測が入っているか。画面の注記を変えるために持つ */
  hasRealData: boolean;
  technical: string[];
  content: string[];
  meo: string[];
  /** 生成に失敗したときの理由 */
  error?: string;
};

export async function generateKeywords(
  d: Diagnosis,
  site: SiteScan | null,
  gsc: GscData | null,
  meo: MeoScan | null
): Promise<KeywordPlan> {
  const real = (gsc?.queries ?? []).filter((q) => q.impressions > 0);

  const res = await askJson<{
    rows: Omit<KeywordRow, "impressions" | "clicks" | "position">[];
    technical: string[];
    content: string[];
    meo: string[];
  }>(
    `あなたはSEO/MEOの実務者です。対策キーワードと改善施策を出します。

守ること:
- rows は12〜16件。指名・地域・一般・比較をバランスよく混ぜる
- volume は月間検索数の**推定**。次の5段階から1つを選ぶ（ピンポイントの数字は書かない）
  「〜100」「100〜1,000」「1,000〜10,000」「10,000〜100,000」「100,000〜」
  指名検索は企業規模・知名度から、地域語は地域の人口規模から、一般語は業種の市場規模から見積もる
- difficulty は 低/中/高、priority は 最高/高/中 のいずれか
- action は「何のページをどう作る・直す」を1文で。「対策する」「強化する」だけは不可
- technical / content は各4〜5件。この商材の事実に紐付けて書く
- meo は${meo?.self ? "4〜5件" : "3件"}。${meo?.self ? "下に渡す実測値を根拠に書く" : "Googleビジネスプロフィールの状態が不明なので、まず確認することから書く"}
- 効果を断定する表現は書かない`,
    `商材: ${d.product}
ターゲット: ${d.audience}
業種: ${d.industry}
強み: ${d.strengths.join(" / ")}
${site ? `サイト: ${site.title}\n構造化データ: ${site.structuredData ? "有り" : "無し"} / sitemap: ${site.sitemapXml ? "有り" : "無し"} / 内部リンク: ${site.internalLinks}` : ""}
${real.length ? `\n実際に検索されている語（Search Console 直近28日）:\n${real.slice(0, 10).map((q) => `- ${q.query}（表示${q.impressions} / クリック${q.clicks} / 平均${q.position.toFixed(1)}位）`).join("\n")}\n※ この語は必ず rows に含めること` : ""}
${meo?.self ? `\nGoogleビジネスプロフィールの実測:\n- 評価 ${meo.self.rating ?? "—"}（近隣平均 ${meo.avgRating ?? "—"}）\n- レビュー ${meo.self.reviews}件（近隣平均 ${meo.avgReviews ?? "—"}件・${meo.totalShops}店中${meo.reviewRank}位）` : ""}

出力: {"rows":[{"keyword":"","kind":"","volume":"100〜1,000","difficulty":"","priority":"","action":""}],
 "technical":[""],"content":[""],"meo":[""]}`,
    { maxTokens: 5000 }
  );

  // 実測がある語には実数を入れる。無い語は null のまま（推測で埋めない）
  const byQuery = new Map(real.map((q) => [q.query, q]));
  const rows: KeywordRow[] = (res.rows ?? []).map((r) => {
    const hit = byQuery.get(r.keyword);
    return {
      ...r,
      volume: r.volume && VOLUME_BANDS.includes(r.volume) ? r.volume : null,
      impressions: hit?.impressions ?? null,
      clicks: hit?.clicks ?? null,
      position: hit ? Number(hit.position.toFixed(1)) : null,
    };
  });

  return {
    rows,
    hasRealData: rows.some((r) => r.impressions !== null),
    technical: res.technical ?? [],
    content: res.content ?? [],
    meo: res.meo ?? [],
  };
}

// ── LINE公式アカウント ────────────────────────────

export type LinePlan = {
  /** 使うべきでない商材なら理由を入れて他は空にする */
  skip: string | null;
  richMenu: { label: string; goes: string }[];
  steps: { when: string; title: string; body: string }[];
  segments: string[];
  /** 生成に失敗したときの理由 */
  error?: string;
};

export async function generateLine(d: Diagnosis, site: SiteScan | null): Promise<LinePlan> {
  const hasLine = site?.social.some((s) => s.platform === "LINE") ?? false;

  return askJson<LinePlan>(
    `あなたはLINE公式アカウントの運用設計者です。

守ること:
- この商材にLINEが向かないなら skip に理由を1文で書き、他は空配列にする
  （検討期間が短い・単価が低すぎる・BtoBで担当者が個人LINEを使わない 等）
- richMenu は6枠。label は12文字以内、goes は遷移先を書く
- steps は5通。when は「友だち追加直後」「登録1日後」のように書く。
  body は150〜250文字。**この商材の事実（価格・実績・所在地）を入れる**
- 効果や結果を断定する表現・最上級表現は使わない（別で法令チェックにかけます）
- 「〜させる」ではなく、送る文面そのものを書く`,
    `商材: ${d.product}
ターゲット: ${d.audience}
業種: ${d.industry}
強み: ${d.strengths.join(" / ")}
買わない理由: ${d.objections.join(" / ")}
${site ? `サイト: ${site.title}` : ""}
公式LINEアカウント: ${hasLine ? "サイトからリンクされている（既にある）" : "サイトからは見つからなかった"}

出力: {"skip":null,"richMenu":[{"label":"","goes":""}],
 "steps":[{"when":"","title":"","body":""}],"segments":[""]}`,
    { maxTokens: 5000 }
  );
}

export const VOLUME_BANDS = ["〜100", "100〜1,000", "1,000〜10,000", "10,000〜100,000", "100,000〜"];

/** 古い分析の対策キーワードに、月間検索数の推定だけを後から足す */
export async function estimateKeywordVolumes(d: Diagnosis, rows: KeywordRow[]): Promise<KeywordRow[]> {
  if (rows.length === 0) return rows;
  const res = await askJson<{ items: { n: number; volume: string }[] }>(
    `あなたはSEOの実務者です。日本のGoogle検索での月間検索数を**推定**します。
- volume は次の5段階から1つを選ぶ。ピンポイントの数字は書かない：${VOLUME_BANDS.map((b) => `「${b}」`).join("")}
- 指名検索は企業規模・知名度から、地域語は地域の人口規模から、一般語は業種の市場規模から見積もる
- n は変えずにそのまま返す`,
    `商材: ${d.product}
業種: ${d.industry}
キーワード:
${rows.map((r, n) => `${n}. ${r.keyword}（${r.kind}）`).join("\n")}

出力: {"items":[{"n":0,"volume":"100〜1,000"}]}`,
    { maxTokens: 2000 }
  );
  const byN = new Map((res.items ?? []).map((x) => [x.n, x.volume]));
  return rows.map((r, n) => {
    const v = byN.get(n);
    return { ...r, volume: v && VOLUME_BANDS.includes(v) ? v : null };
  });
}
