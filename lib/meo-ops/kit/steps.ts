import { askJson, MODEL_FAST } from "../../anthropic";
import { checkGuard, checkGuardDict } from "../../guardrail";
import type { Industry } from "../../types";
import { ask } from "../ai-search";
import { normalizeJapanese } from "../japanese";
import type { MeoStoreSnapshot } from "../types";
import { hpbSalonUrl, keywordHits, KIND_LABEL, lawOf, LIMITS, rankOf, readPage, RULES, withCount, writeReviewUrl } from "./text";
import type {
  AioPack,
  CouponPack,
  Diagnosis,
  GuardPack,
  HpbPack,
  HpbPageResult,
  KitInput,
  KitKind,
  KitPack,
  KitResults,
  MeoPack,
  ScanResult,
  ScorePack,
  SeriesPack,
  SeriesPost,
  WinnersPack,
} from "./types";

/**
 * 「やること」キットの各工程（オルコネレックスの lib/steps.ts を AI-REX に合わせて移したもの）。
 * AI-REX は Google の店舗情報（Places の住所・電話・営業時間・評価）を実測で持っているので、
 * オルコネが web 検索で拾っていたものは実測に置き換えている（数字を AI に作らせない）。
 */

export type KitCtx = {
  kind: KitKind;
  industry: Industry;
  input: KitInput;
  results: KitResults;
  store: MeoStoreSnapshot | null;
  storeName: string;
  /** MEO の「キーワード順位」に登録した語。狙う語として使う */
  keywords: string[];
  /** 今の Google の説明文（プロフィールの下書き） */
  currentDescription: string;
};

const deadline = (ms = 150_000) => Date.now() + ms;
const N = (s: unknown) => normalizeJapanese(String(s ?? ""));

/** Google の実測（Places）を文章にする。AI に渡す「確かな事実」 */
function placeFacts(c: KitCtx): string {
  const s = c.store;
  if (!s) return "";
  return [
    `Googleの店舗情報（実測）: ${s.name}`,
    s.address ? `住所: ${s.address}` : "",
    s.category ? `Googleの業種: ${s.category}` : "",
    s.phoneNumber ? `電話: ${s.phoneNumber}` : "",
    s.openingHours?.length ? `営業時間: ${s.openingHours.join(" / ")}` : "",
    s.rating != null ? `Googleの評価: ${s.rating}（口コミ${s.reviewCount ?? 0}件）` : "",
    s.websiteUrl ? `公式サイト: ${s.websiteUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function facts(c: KitCtx): string {
  const d = c.results.diagnose;
  const lines = [placeFacts(c)];
  if (d) {
    lines.push(
      `店名: ${d.name}`,
      `地域: ${d.area}`,
      `主力メニュー・商材: ${d.product}`,
      `客層: ${d.audience}`,
      `強み: ${d.strengths.join(" / ")}`,
      `買わない理由: ${d.objections.join(" / ")}`,
      `訴求軸: ${d.angles.map((x) => `${x.name}（${x.why}）`).join(" / ")}`,
      `語り口: ${d.tone}`
    );
  }
  if (c.input.note.trim()) lines.push(`補足（お店からの入力）: ${c.input.note.trim()}`);
  if (c.keywords.length) lines.push(`狙う語（自然に入るところにだけ入れる。詰め込まない）: ${c.keywords.join(" / ")}`);
  return lines.filter(Boolean).join("\n");
}

// ── お店の情報を読む ─────────────────────────────
export async function stepScan(c: KitCtx): Promise<ScanResult> {
  const url = c.input.url.trim() || c.store?.websiteUrl || "";
  const isMaps = /google\.[^/]+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps/i.test(url);
  if (url && !isMaps) {
    try {
      const p = await readPage(url, { browserUa: !!hpbSalonUrl(url) });
      return { ...p, via: "page" };
    } catch {
      // 食べログ等はプログラムからの読み込みを弾く。下の web 検索で同じ店の情報を集める
    }
  }
  // 店名と住所は Google の実測で分かっているので、それで探す（別の店を拾わないよう両方を条件にする）
  const name = c.store?.name || c.storeName;
  const where = c.store?.address || c.input.note || "";
  if (!name) throw new Error("お店の情報が読めませんでした。URL を確かめるか、補足にお店の説明を入れてください");
  const a = await ask(
    `「${name}」（${where}）という${KIND_LABEL[c.kind]}について、web で分かることを集めてください。店名と場所の両方が一致するページだけを使い、同じ地域の別の店・同名の別店舗の情報は使わないでください。
最寄駅や住所、ジャンルや主力メニュー・サービス、価格帯、営業時間、雰囲気、こだわり、口コミで多く言われていることを、見つかった事実だけで 800〜2000 文字の文章にしてください。数字は見つかったものだけ。${url ? `\n参考URL: ${url}` : ""}`,
    deadline()
  );
  const text = N(a.text).trim();
  if (text.length < 200) throw new Error("お店の情報が見つかりませんでした。補足にお店の説明（何の店か・強み・メニュー）を入れて、もう一度試してください");
  return { title: name, text: `（ページを直接読めなかったため、店名と住所から web 検索で集めた情報です）\n${text.slice(0, 8000)}`, finalUrl: url, via: "search" };
}

/**
 * 理美容：ホットペッパービューティーのサロンページを用意する。
 * 別のサロンのページを拾うのが一番まずいので、店名と場所が合うと言えるときだけ採用する。
 */
export async function stepHpbPage(c: KitCtx): Promise<HpbPageResult> {
  const scan = c.results.scan;
  const manual = hpbSalonUrl(c.input.hpbUrl);
  const direct = manual || hpbSalonUrl(c.input.url) || hpbSalonUrl(scan?.finalUrl);
  if (!manual && direct && scan?.via === "page") return { url: direct, title: scan.title, text: scan.text };
  let url = direct;
  if (!url) {
    const name = c.store?.name || c.results.diagnose?.name || c.storeName;
    const a = await ask(
      `ホットペッパービューティー（beauty.hotpepper.jp）で「${name}」（${c.store?.address ?? ""}）のサロンページを探してください。店名と場所（最寄駅・住所）の両方が一致するときだけ、そのサロンのトップページの URL（https://beauty.hotpepper.jp/slnH000000000/ の形）を1つ書いてください。同じ地域の別のサロンや支店違いは採用せず、見つからなければ「見つからず」とだけ書いてください。`,
      deadline(120_000)
    );
    const pool = [a.text, ...a.cited.map((x) => x.url)].join(" ");
    url = /見つからず/.test(a.text) ? null : hpbSalonUrl(pool);
    if (!url) return { note: "ホットペッパーのページが見つかりませんでした。下の欄にホットペッパーの URL を入れると、そのページで作り直せます。" };
  }
  try {
    const p = await readPage(url, { browserUa: true });
    return { url, title: p.title, text: p.text, note: direct ? undefined : "入力されたページとは別に、ホットペッパーのページを探して読みました。" };
  } catch (e) {
    return { url, note: `ホットペッパーのページは見つかりましたが、読み込めませんでした（${e instanceof Error ? e.message : String(e)}）。` };
  }
}

// ── お店の特徴の整理 ─────────────────────────────
export async function stepDiagnose(c: KitCtx): Promise<Diagnosis> {
  const s = c.results.scan;
  const h = c.results.hpbpage;
  const src = [
    placeFacts(c),
    s ? `【ページタイトル】${s.title}\n【本文】${s.text}` : "",
    h?.text && h.url !== hpbSalonUrl(s?.finalUrl) ? `【ホットペッパーのページ】${h.title || ""}\n${h.text.slice(0, 6000)}` : "",
    c.input.note.trim() ? `【補足】${c.input.note.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const d = await askJson<Diagnosis>(
    `あなたは${KIND_LABEL[c.kind]}の集客の実務者です。店舗ページの内容から、文章を作るための土台を作ります。
- name は店名、area は市区町村や最寄駅（本文から読み取れる範囲。無ければ空文字）
- product は主力メニューや看板商品・サービス（本文にあるものだけ）
- audience は「人物が浮かぶ粒度」で2〜3タイプ。どこの誰が・どんな場面で来るかまで。本文に無い属性は作らず、立地・価格・メニュー・営業時間の手がかりから言える範囲で
- angles（訴求軸）は5本。切り口が重ならないようにする
- objections は「買わない理由」。ここを潰す文章が一番効く
- tone は本文から読み取れる語り口（例：丁寧でやわらかい／親しみやすい／落ち着いた）
- 空欄で返さない。補足（お店からの入力）がある場合はそちらを優先する。どうしても読み取れない項目だけ「不明」と書く
${RULES}`,
    `${src}

出力:
{"name":"","area":"","product":"","audience":"","strengths":[""],"objections":[""],"angles":[{"id":"a1","name":"","why":""}],"tone":""}`,
    { maxTokens: 2500 }
  );
  for (const k of ["name", "area", "product", "audience", "tone"] as const) {
    const v = (d as Record<string, unknown>)[k];
    (d as Record<string, unknown>)[k] = N(Array.isArray(v) ? v.filter(Boolean).join("／") : v);
  }
  d.strengths = (d.strengths ?? []).map(N).filter(Boolean);
  d.objections = (d.objections ?? []).map(N).filter(Boolean);
  d.angles = (d.angles ?? []).map((a, i) => ({ id: a.id || `a${i + 1}`, name: N(a.name), why: N(a.why) }));
  if (!d.name && !d.product && !d.strengths.length) throw new Error("お店の情報が読み取れませんでした。補足にお店の説明を入れて再実行してください");
  return d;
}

// ── 集客スコア ──────────────────────────────────
export const KEYWORD_LABEL = "狙う語がページに入っている";
const CRITERIA: Record<KitKind, { label: string; weight: number; how: string }[]> = {
  beauty: [
    { label: "キャッチで誰向けのサロンか分かる", weight: 15, how: "一覧で最初に目に入る一文に、来てほしい人と強みが入っているか" },
    { label: "紹介文の最初の3行に強みがある", weight: 15, how: "サロン紹介文の冒頭で、選ぶ理由（技術・得意な悩み・人柄）が言えているか" },
    { label: "クーポン名で誰向けか分かる", weight: 15, how: "メニュー名だけでなく、誰の・どんな悩み向けかが名前に入っているか。価格が分かるか" },
    { label: KEYWORD_LABEL, weight: 15, how: "（コードで数える）" },
    { label: "確かめられる数字で裏付けている", weight: 10, how: "「施術歴○年」「口コミ○件」のような、確かめられる数字が載っているか（作った数字は不可）" },
    { label: "写真・スタイル・メニューがそろっている", weight: 10, how: "スタイル写真・店内・スタッフ・メニューと価格がそろっているか" },
    { label: "口コミの数・評価・返信", weight: 15, how: "口コミの件数と評価、お店からの返信が付いているか" },
    { label: "ブログ・新着が続いている", weight: 15, how: "直近のブログや新着情報が続いて出ているか" },
  ],
  food: [
    { label: "何の店か・誰向けかがすぐ分かる", weight: 15, how: "店の紹介文の冒頭で、ジャンル・使い方（一人・宴会・デート等）・強みが分かるか" },
    { label: "看板メニューと価格が載っている", weight: 15, how: "看板メニューの名前・写真・価格が載っているか" },
    { label: "口コミの数・評価・返信", weight: 20, how: "口コミの件数と評価、お店からの返信が付いているか" },
    { label: KEYWORD_LABEL, weight: 15, how: "（コードで数える）" },
    { label: "確かめられる数字で裏付けている", weight: 10, how: "「創業○年」「仕込み○時間」のような、確かめられる数字が載っているか（作った数字は不可）" },
    { label: "写真がそろっている", weight: 10, how: "料理・店内・外観の写真があるか" },
    { label: "営業時間・予約・行き方が分かる", weight: 15, how: "営業時間・定休日・予約の方法・最寄駅からの行き方が載っているか" },
    { label: "投稿・お知らせが続いている", weight: 10, how: "最近の投稿や新着のお知らせが続いて出ているか" },
  ],
  general: [
    { label: "何のお店か・誰向けかがすぐ分かる", weight: 20, how: "紹介文の冒頭で、何を提供しているか・誰のためのお店か・強みが分かるか" },
    { label: "サービスと料金が載っている", weight: 15, how: "主なサービス・メニューの名前と料金の目安が載っているか" },
    { label: "口コミの数・評価・返信", weight: 20, how: "口コミの件数と評価、お店からの返信が付いているか" },
    { label: KEYWORD_LABEL, weight: 15, how: "（コードで数える）" },
    { label: "確かめられる数字で裏付けている", weight: 10, how: "「創業○年」「実績○件」のような、確かめられる数字が載っているか（作った数字は不可）" },
    { label: "写真がそろっている", weight: 10, how: "店内・外観・スタッフ・サービスの写真があるか" },
    { label: "営業時間・予約・行き方が分かる", weight: 10, how: "営業時間・定休日・予約や問い合わせの方法・行き方が載っているか" },
  ],
};

export async function stepScore(c: KitCtx): Promise<ScorePack> {
  const crit = CRITERIA[c.kind];
  const aiCrit = crit.filter((x) => x.label !== KEYWORD_LABEL);
  const h = c.results.hpbpage;
  const page =
    c.kind === "beauty" && h?.text
      ? { src: `ホットペッパービューティー（${h.url}）`, text: h.text }
      : { src: c.results.scan?.finalUrl || c.input.url || "入力された情報", text: c.results.scan?.text || c.input.note || "" };
  const fixed = c.keywords.filter(Boolean);
  const r = await askJson<{ items: { label: string; score: number; reason: string; fix: string }[]; keywords: string[] }>(
    `あなたは${KIND_LABEL[c.kind]}の集客の採点者です。お店の今のページを、渡された評価の基準ごとに 0〜100点で採点します。
- 判断はページ本文と Google の店舗情報（実測）から読み取れることだけで行う。読み取れない基準は 50点にして reason に「ページから読み取れませんでした」と書く
- reason は今の状態を1文（何がある・何が無い）。fix は「どこを・何に」直すかを1文。お店の人に向けた普通の言葉で
- 甘く付けない。80点以上は、その基準でお客さんに選ばれる理由が十分に伝わっているときだけ
- items は渡した基準と同じ順番・同じ label で返す
- keywords: ${fixed.length ? "空配列でよい" : "このお店がお客さんに検索されたい語を5つ。実際に打たれる短い1語（例：「髪質改善」「個室」「駐車場」）。地域名・店名は入れない"}
${RULES}`,
    `${facts(c)}

【評価の基準】
${aiCrit.map((x, i) => `${i + 1}. ${x.label}（${x.how}）`).join("\n")}

【今のページ】${page.src}
${page.text.slice(0, 8000)}

出力: {"items":[{"label":"","score":0,"reason":"","fix":""}],"keywords":[""]}`,
    { maxTokens: 3500 }
  );
  const got = r.items ?? [];
  const words = (fixed.length ? fixed : (r.keywords ?? []).map((w) => N(w).trim()).filter(Boolean)).slice(0, 10);
  const hits = keywordHits(page.text, words);
  const found = hits.filter((x) => x.found).length;
  const missing = hits.filter((x) => !x.found).map((x) => x.word);
  const items = crit.map((cr) => {
    if (cr.label === KEYWORD_LABEL) {
      return {
        label: cr.label,
        weight: cr.weight,
        score: words.length ? Math.round((found / words.length) * 100) : 50,
        reason: words.length ? `${words.length}語のうち${found}語がページに入っています` : "狙う語が決まっていません",
        fix: missing.length ? `「${missing.slice(0, 4).join("」「")}」を、説明文・紹介文のうち自然に入るところに入れる` : "このままで大丈夫です",
      };
    }
    const g = got.find((x) => x.label === cr.label) ?? got[aiCrit.indexOf(cr)];
    return { label: cr.label, weight: cr.weight, score: Math.min(100, Math.max(0, Math.round(Number(g?.score) || 0))), reason: N(g?.reason), fix: N(g?.fix) };
  });
  const wsum = items.reduce((s, x) => s + x.weight, 0) || 1;
  const total = Math.round(items.reduce((s, x) => s + x.score * x.weight, 0) / wsum);
  return { total, ...rankOf(total), items, keywords: hits, source: page.src, at: new Date().toISOString() };
}

// ── 文章を作る ──────────────────────────────────
/** 上限超過の文言だけ短縮を1回だけ試し、それでも超えていれば over=true のまま返す */
async function repairOver<T extends Record<string, { text: string; limit?: number; over?: boolean; field: string }>>(pack: T, keys: (keyof T)[]) {
  const over = keys.filter((k) => pack[k].over);
  if (!over.length) return pack;
  const req = over.map((k) => `[${String(k)}] 上限${pack[k].limit}文字:\n${pack[k].text}`).join("\n\n");
  try {
    const fixed = await askJson<Record<string, string>>(`渡された文言を、意味を変えずにそれぞれの上限文字数以内に短くする。キーは渡されたものをそのまま使う。`, `${req}\n\n出力: {"キー":"短くした文言"}`, {
      model: MODEL_FAST,
      maxTokens: 2500,
    });
    for (const k of over) {
      const t = fixed[String(k)];
      if (t) (pack as Record<string, unknown>)[k as string] = withCount(pack[k].field, N(t), pack[k].limit);
    }
  } catch {
    // 短くできなければ「上限超過」のまま出す（画面で「短く」を押せる）
  }
  return pack;
}

export async function stepHpb(c: KitCtx): Promise<HpbPack> {
  const L = LIMITS.hpb;
  type F = { before: string; after: string; why: string };
  const h = c.results.hpbpage;
  const r = await askJson<{ catch: F; intro: F; couponName: F; couponDesc: F; blog: F }>(
    `あなたはホットペッパービューティー（HPB）の掲載文を直す人です。お店の人に「今はこう → こう変える → なぜ」を見せます。
各項目について:
- before: 「今のホットペッパーのページ本文」から、今載っている文言をそのまま抜き出す（キャッチ・サロン紹介文・いちばん上のクーポン名と説明）。本文に見当たらなければ空文字。お店のHPの文言は before に入れない。blog の before は、最近のブログの題名や更新の様子が分かればそれを1行で、無ければ空文字
- after: 新しい文言
  - catch はサロンのキャッチ（${L.catch}文字以内）
  - intro はサロン紹介文（${L.intro}文字以内）。強みと「選ばれない理由への答え」を入れる
  - couponName はクーポン名（${L.couponName}文字以内、誰向けかが分かる名前）、couponDesc はクーポン説明（${L.couponDesc}文字以内）。価格はページにある実際の数字だけ
  - blog はブログ記事の下書き（${L.blog}文字以内、改行60回以内）。1行目に題名（25文字以内）、以降が本文。来店前の不安に答える内容
- why: 今の文言と比べて、何が足りない／何が変わるのかを1〜2文で。before が空なら「今の文言が読み取れなかったので、お店の情報から新しく作りました。」から始める
${RULES}
${lawOf(c.kind, c.industry)}`,
    `${facts(c)}

${
  h?.text
    ? `【今のホットペッパーのページ本文】（${h.url}）\n${h.text.slice(0, 8000)}`
    : `【今のページ本文】（ホットペッパーのページは見つかっていない。before は必ず空文字にする）\n${(c.results.scan?.text || "").slice(0, 8000)}`
}

出力: {"catch":{"before":"","after":"","why":""},"intro":{"before":"","after":"","why":""},"couponName":{"before":"","after":"","why":""},"couponDesc":{"before":"","after":"","why":""},"blog":{"before":"","after":"","why":""}}`,
    { maxTokens: 5000 }
  );
  const mk = (label: string, f: F | undefined, lim: number) => ({ ...withCount(label, N(f?.after), lim), before: h?.text ? N(f?.before) : "", why: N(f?.why) });
  const pack: HpbPack = {
    catch: mk("キャッチ", r.catch, L.catch),
    intro: mk("サロン紹介文", r.intro, L.intro),
    couponName: mk("クーポン名", r.couponName, L.couponName),
    couponDesc: mk("クーポン説明", r.couponDesc, L.couponDesc),
    blog: mk("ブログ", r.blog, L.blog),
  };
  const keys = ["catch", "intro", "couponName", "couponDesc", "blog"] as const;
  const meta = Object.fromEntries(keys.map((k) => [k, { before: pack[k].before, why: pack[k].why }]));
  const fixed = await repairOver(pack, [...keys]);
  for (const k of keys) fixed[k] = { ...fixed[k], ...meta[k] };
  return fixed;
}

export async function stepMeo(c: KitCtx): Promise<MeoPack> {
  const L = LIMITS.gbp;
  const r = await askJson<{ description: { after: string; why: string }; posts: string[]; calendar: { week: string; theme: string }[]; menu?: string[] }>(
    `あなたは Googleビジネスプロフィール（Googleマップ）の文章を書く人です。
- description.after は店舗の説明文（${L.description}文字以内）。何の店で、誰に、何が強いかを事実で。狙う語は自然に入るところにだけ
- description.why は、今の説明文と比べて何が変わるかを1〜2文（今の説明文が無ければ「今の説明文が登録されていないので、お店の情報から作りました。」から始める）
- posts は週1本×4週の投稿文（各200〜400文字）。季節・メニュー・スタッフ・来店前の不安への答え など切り口を変える。口コミの引用・一般論は書かない
- calendar は posts に対応する4週分の {week:"第1週", theme:"..."}
${c.kind === "food" ? `- menu は看板メニュー3品の紹介文（各120文字以内）。サイトにあるメニューだけ` : ""}
${RULES}
${lawOf(c.kind, c.industry)}`,
    `${facts(c)}

【今の説明文】
${c.currentDescription.trim() || "（登録されていない）"}

出力: {"description":{"after":"","why":""},"posts":["","","",""],"calendar":[{"week":"第1週","theme":""}]${c.kind === "food" ? `,"menu":["","",""]` : ""}}`,
    { maxTokens: 4500 }
  );
  const pack: MeoPack = {
    description: { ...withCount("説明文", N(r.description?.after), L.description), before: c.currentDescription.trim(), why: N(r.description?.why) },
    posts: (r.posts ?? []).slice(0, 4).map((p, i) => withCount(`投稿 第${i + 1}週`, N(p), L.post)),
    calendar: (r.calendar ?? []).slice(0, 4).map((x) => ({ week: N(x.week), theme: N(x.theme) })),
    menu: r.menu ? r.menu.slice(0, 3).map((m, i) => withCount(`メニュー紹介 ${i + 1}`, N(m), 120)) : undefined,
  };
  if (pack.description.over) {
    const meta = { before: pack.description.before, why: pack.description.why };
    const f = await repairOver({ description: pack.description }, ["description"]);
    pack.description = { ...f.description, ...meta };
  }
  return pack;
}

export async function stepKit(c: KitCtx): Promise<KitPack> {
  const r = await askJson<{ pop: string[]; talk: string[]; line: string }>(
    `あなたは${KIND_LABEL[c.kind]}の口コミ依頼の文面を書く人です。
- pop は${c.kind === "beauty" ? "鏡の横やレジに置くカード" : c.kind === "food" ? "卓上POP" : "受付やレジに置くカード"}の文面3案（各60文字以内）。QRコードの横に置く前提
- talk は${c.kind === "beauty" ? "仕上げ後や会計時" : "会計時やお見送りのとき"}の依頼トーク2案（各80文字以内）。スタッフがそのまま言える口語
- line は LINE／メールで送る依頼文（150文字以内）
- すべて「率直なご感想をお願いします」型。良い評価・高評価・星5・投稿内容を条件にした特典は絶対に書かない
${RULES}
${lawOf(c.kind, c.industry)}`,
    `${facts(c)}\n\n出力: {"pop":["","",""],"talk":["",""],"line":""}`,
    { maxTokens: 1500 }
  );
  return { reviewUrl: writeReviewUrl(c.store?.placeId) ?? "", pop: (r.pop ?? []).map(N).filter(Boolean), talk: (r.talk ?? []).map(N).filter(Boolean), line: N(r.line) };
}

export async function stepCoupon(c: KitCtx): Promise<CouponPack> {
  const r = await askJson<CouponPack>(
    `あなたは${KIND_LABEL[c.kind]}の再来店クーポンを作る人です。3案。
- title は20文字以内、body は60文字以内、condition は利用条件（40文字以内）、expiry は有効期限の書き方（例：発行日から30日）
- 値引き額や無料の品はサイトに載っているメニュー・価格の範囲で。数字を作らない
- 口コミの投稿を条件にしない（配る相手は「来店したお客様全員」）
${RULES}
${lawOf(c.kind, c.industry)}`,
    `${facts(c)}\n\n出力: {"items":[{"title":"","body":"","condition":"","expiry":""}]}`,
    { maxTokens: 1500 }
  );
  return { items: (r.items ?? []).slice(0, 3).map((x) => ({ title: N(x.title), body: N(x.body), condition: N(x.condition), expiry: N(x.expiry) })) };
}

// ── AI検索での見え方 ──────────────────────────────
/**
 * AIが答えを作るときに見ているのは GBP・口コミ・サイト。その3か所に載せるものを出す。
 * 1) いま AI に「このお店ってどんな店？」と聞くと何と答えるか（web 検索つき）
 * 2) よくある質問（AIは質問の形で拾う）と、口コミで言われたい言葉
 * 構造化データ（JSON-LD）は AI に書かせず、Google の実測からコードで組み立てる。
 */
export async function stepAio(c: KitCtx): Promise<AioPack> {
  const d = c.results.diagnose;
  if (!d) throw new Error("先にお店の情報を整理してください");
  const kind = c.kind === "beauty" ? "美容室・サロン" : c.kind === "food" ? "飲食店" : "お店";
  const sample = `「${d.area || "近く"}で${d.product || "おすすめ"}の${kind}は？」`;

  const currentP = (async () => {
    const a = await ask(`「${d.name}」（${c.store?.address || d.area}）ってどんな${kind}？ 3〜5文で教えてください。見つからない情報は推測せず、見つからないと言ってください。`, deadline());
    const s = await askJson<{ answer: string; missing: string[] }>(
      `AI の答えと、店側が言いたい強みを比べます。
- answer: AI の答えを、意味を変えずに3〜5文に整える（AI が見つけられなかったと言っていれば、そのまま残す）
- missing: 店側の強みのうち、AI の答えに入っていないもの。全部入っていれば空配列`,
      `【AIの答え】\n${a.text.slice(0, 4000)}\n\n【店側の強み】\n${d.strengths.join(" / ")}\n\n出力: {"answer":"","missing":[""]}`,
      { model: MODEL_FAST, maxTokens: 1500 }
    );
    return { answer: N(s.answer || a.text.slice(0, 600)), missing: (s.missing ?? []).map(N).filter(Boolean), sources: a.cited.slice(0, 8).map((x) => `${x.title} ${x.url}`.trim()), engine: a.engine };
  })();

  const genP = askJson<{ faq: { q: string; a: string }[]; words: { word: string; why: string }[] }>(
    `あなたは${KIND_LABEL[c.kind]}の集客の実務者です。AI検索は「〇〇ってどんな店？」「△△で□□の店は？」のような質問の形で情報を拾うので、お店のサイトや Googleビジネスプロフィールに載せる文章を質問と答えの形で用意します。
- faq は5本。お客様が来店前に AI や検索に聞きそうな質問（例：${sample}、初めてでも大丈夫か、予約は要るか、駐車場・子連れ・一人客、支払い方法、所要時間）に、このお店の事実で答える。答えは各120文字以内。地域名と店名を自然に入れる
- 「買わない理由」への答えを faq のどれかに必ず入れる
- words は「口コミで言われたい言葉」5つ。AIは口コミの具体的な言葉を根拠にするので、このお店の強みが口コミに出るときの言い方を、お客様の口語で。why はその言葉がなぜ効くかを1文で
- 「AIに必ず出る」「上位に出る」のような効果の断定は書かない
${RULES}
${lawOf(c.kind, c.industry)}`,
    `${facts(c)}\n\n出力: {"faq":[{"q":"","a":""}],"words":[{"word":"","why":""}]}`,
    { maxTokens: 3000 }
  );

  const [cur, gen] = await Promise.allSettled([currentP, genP]);
  if (gen.status === "rejected") throw gen.reason;
  const faq = (gen.value.faq ?? []).slice(0, 6).map((x) => ({ q: N(x.q), a: N(x.a) }));
  const { jsonld, missing } = buildJsonLd(c, d, faq);
  const current =
    cur.status === "fulfilled"
      ? { ...cur.value, note: "web 検索つきの AI に実際に聞いた答えです。AIの答えは日々変わるので、ChatGPT や Google の AIモードでも同じ質問をして見比べてください。" }
      : { answer: "", missing: [], sources: [], engine: "", note: `AIに聞けませんでした（${cur.reason instanceof Error ? cur.reason.message : String(cur.reason)}）。少し時間をおいて作り直してください。` };
  return { current, faq, jsonld, jsonldMissing: missing, words: (gen.value.words ?? []).slice(0, 5).map((w) => ({ word: N(w.word), why: N(w.why) })) };
}

const SCHEMA_TYPE: Record<KitKind, string> = { beauty: "HairSalon", food: "Restaurant", general: "LocalBusiness" };

/** Google の実測だけで JSON-LD を組む。無い項目は入れず、埋められなかった項目名を返す */
function buildJsonLd(c: KitCtx, d: Diagnosis, faq: { q: string; a: string }[]) {
  const s = c.store;
  const missing: string[] = [];
  const biz: Record<string, unknown> = { "@context": "https://schema.org", "@type": SCHEMA_TYPE[c.kind] };
  const name = s?.name || d.name;
  if (name && name !== "不明") biz.name = name;
  else missing.push("店名");
  const url = s?.websiteUrl || c.input.url;
  if (url) biz.url = url;
  else missing.push("公式サイト");
  if (s?.address) biz.address = { "@type": "PostalAddress", streetAddress: s.address, addressCountry: "JP" };
  else missing.push("住所");
  if (s?.phoneNumber) biz.telephone = s.phoneNumber;
  else missing.push("電話番号");
  if (s?.location) biz.geo = { "@type": "GeoCoordinates", latitude: s.location.latitude, longitude: s.location.longitude };
  if (s?.openingHours?.length) biz.openingHours = s.openingHours;
  else missing.push("営業時間");
  if (s?.mapsUri) biz.hasMap = s.mapsUri;
  const desc = d.strengths.filter((x) => x && x !== "不明").slice(0, 3).join("。");
  if (desc) biz.description = desc;
  const graph: unknown[] = [biz];
  if (faq.length) graph.push({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map((x) => ({ "@type": "Question", name: x.q, acceptedAnswer: { "@type": "Answer", text: x.a } })) });
  const body = graph.map((g) => JSON.stringify(g, null, 2)).join(",\n");
  return { jsonld: `<script type="application/ld+json">\n[\n${body}\n]\n</script>`, missing };
}

// ── 言葉のチェック ────────────────────────────────
export async function stepGuard(c: KitCtx): Promise<GuardPack> {
  const r = c.results;
  const texts: { where: string; text: string }[] = [];
  if (r.hpb) for (const x of Object.values(r.hpb)) texts.push({ where: `ホットペッパー ${x.field}`, text: x.text });
  if (r.meo) {
    texts.push({ where: "Google 説明文", text: r.meo.description.text });
    r.meo.posts.forEach((p) => texts.push({ where: `Google ${p.field}`, text: p.text }));
    (r.meo.menu ?? []).forEach((m) => texts.push({ where: `Google ${m.field}`, text: m.text }));
  }
  if (r.kit) {
    r.kit.pop.forEach((p, i) => texts.push({ where: `POP ${i + 1}`, text: p }));
    r.kit.talk.forEach((p, i) => texts.push({ where: `依頼トーク ${i + 1}`, text: p }));
    texts.push({ where: "LINE依頼文", text: r.kit.line });
  }
  if (r.coupon) r.coupon.items.forEach((x, i) => texts.push({ where: `クーポン ${i + 1}`, text: `${x.title}\n${x.body}\n${x.condition}` }));
  if (r.aio) r.aio.faq.forEach((q, i) => texts.push({ where: `よくある質問 ${i + 1}`, text: `${q.q}\n${q.a}` }));
  const list = texts.filter((t) => t.text.trim());
  // 辞書は文ごとに当てて「どこの」言葉かを出す。文脈が要るものは AI がまとめて見る（多くても2件）
  const dict = list.flatMap((t) => checkGuardDict([t.text], c.industry).map((h) => ({ ...h, where: t.where })));
  const verdict = await checkGuard(list.map((t) => t.text), c.industry);
  const ai = verdict.hits
    .filter((h) => !dict.some((x) => x.text === h.text))
    .map((h) => ({ ...h, where: list.find((t) => t.text.includes(h.text))?.where ?? "文章全体" }));
  return { hits: [...dict, ...ai], checked: list.length, level: verdict.level };
}

// ── AIが挙げる店の分析 ──────────────────────────────
export async function stepWinners(c: KitCtx, names: string[], from: WinnersPack["from"]): Promise<WinnersPack> {
  if (!names.length) throw new Error("比べる店がまだありません。先に「AI検索」タブで測るか、店舗情報を更新して近くの同業を取り込んでください");
  const own = (c.kind === "beauty" && c.results.hpbpage?.text) || c.results.scan?.text || "";
  const where = c.kind === "beauty" ? "ホットペッパービューティーのサロンページ・Googleマップ・公式サイト" : "Googleマップ・口コミサイト・公式サイト";
  const research = await ask(
    `${c.store?.address ? `${c.store.address} の近くにある` : ""}次の店について、それぞれの${where}を読み、お客さんや AI に選ばれる理由になっていそうなこと（キャッチ・紹介文の言葉、メニューと価格の見せ方、口コミの数と返信、写真、投稿の続き具合など）を、ページで確認できた事実だけで店ごとに書いてください。店名と地域が合うページだけを使い、確認できなかった店は「確認できず」と書いてください。読んだページの URL も書いてください。
${names.map((n, i) => `${i + 1}. ${n}`).join("\n")}`,
    deadline(150_000)
  );
  const r = await askJson<{ items: { name: string; url: string; works: string[]; evidence: string }[]; gaps: { point: string; ours: string; theirs: string }[]; actions: { title: string; where: string; detail: string }[] }>(
    `あなたは${KIND_LABEL[c.kind]}の集客の実務者です。${from === "ai" ? "AIに店名を出さずにおすすめを聞くと、下の店が自店より先に挙がります。" : "下の店は自店の近くの同業です。"}調べた内容をもとに、何が効いているかを特定し、打ち手を出します。
- items: 店ごとに name、url（調べた内容にある URL。無ければ空）、works（効いていそうなこと2〜4個。調べた内容で確認できた事実だけ）、evidence（どのページで確認したか1文）。確認できなかった店は works を空にし、evidence に「ページを確認できませんでした」
- gaps: 自店との差を3〜5個。point は何の差か、ours は自店の今（自店のページに無ければ「ページに見当たらない」）、theirs は相手
- actions: 自店が今月やることを3〜5個。title は動詞で終わる一文、where はどこで（例：Googleビジネスプロフィール → 投稿、${c.kind === "beauty" ? "SALON BOARD → 掲載管理" : "お店のHP"}）、detail は具体的に何をするか。相手の文章をそのまま写させず、自店の事実から書く
- 相手を悪く書かない。数字は確認できたものだけ
${RULES}
${lawOf(c.kind, c.industry)}`,
    `${facts(c)}

【比べる店を調べた内容】
${research.text.slice(0, 9000)}
${research.cited.slice(0, 12).map((x) => `- ${x.title} ${x.url}`).join("\n")}

【自店の今のページ】
${own.slice(0, 4000)}

出力: {"items":[{"name":"","url":"","works":[""],"evidence":""}],"gaps":[{"point":"","ours":"","theirs":""}],"actions":[{"title":"","where":"","detail":""}]}`,
    { maxTokens: 5000, timeoutMs: 100_000 }
  );
  return {
    from,
    items: (r.items ?? []).slice(0, 5).map((x) => ({ name: N(x.name), url: x.url || undefined, works: (x.works ?? []).map(N).filter(Boolean), evidence: N(x.evidence) })),
    gaps: (r.gaps ?? []).slice(0, 5).map((g) => ({ point: N(g.point), ours: N(g.ours), theirs: N(g.theirs) })),
    actions: (r.actions ?? []).slice(0, 5).map((a) => ({ title: N(a.title), where: N(a.where), detail: N(a.detail) })),
    note: "web で確認できた範囲の参考です。AIや検索で先に挙がる理由は、ページから読み取れることからの推定です。",
    at: new Date().toISOString(),
  };
}

// ── 続けて出すもの（理美容 = HPBブログ、それ以外 = Googleマップの投稿） ─────────
/** 1回目は1年分（12本）のテーマを決め、以降は呼ばれるたびに次のテーマで1本書く */
export async function nextSeriesPost(c: KitCtx): Promise<{ series: SeriesPack; post: SeriesPost }> {
  const d = c.results.diagnose;
  if (!d) throw new Error("先にお店の情報を整理してください");
  const blog = c.kind === "beauty";
  const where = blog ? "ホットペッパービューティーのサロンブログ" : "Googleビジネスプロフィール（Googleマップ）の投稿";
  let series: SeriesPack = c.results.series ?? { themes: [], posts: [] };
  if (!series.themes.length) {
    const t = await askJson<{ themes: { title: string; angle: string }[] }>(
      `あなたは${KIND_LABEL[c.kind]}の${where}を1年続けるための、テーマ表を作る人です。
- 12本。季節（月ごと）・来店前の不安への答え・メニュー紹介・スタッフやお店の人柄・よくある質問、を混ぜる
- 「選ばれない理由」への答えを最低4本入れる
- title はテーマの題（25文字以内）、angle は何を書くか1文
${RULES}`,
      `${facts(c)}\n今月: ${new Date().getMonth() + 1}月\n\n出力: {"themes":[{"title":"","angle":""}]}`,
      { maxTokens: 2000 }
    );
    series = { themes: (t.themes ?? []).slice(0, 12).map((x) => ({ title: N(x.title), angle: N(x.angle) })), posts: [] };
  }
  if (!series.themes.length) throw new Error("テーマを決められませんでした。もう一度押してください");
  const used = new Set(series.posts.map((p) => p.theme));
  const theme = series.themes.find((x) => !used.has(x.title)) ?? series.themes[series.posts.length % series.themes.length];
  const limit = blog ? LIMITS.hpb.blog : 400;
  const r = await askJson<{ title: string; body: string }>(
    `あなたは${d.name}のスタッフとして、${where}を1本書きます。
- テーマ: ${theme.title}（${theme.angle}）
- title は題名（${blog ? "25" : "30"}文字以内）、body は本文（${blog ? "600〜950文字、改行は60回以内" : "200〜400文字"}）。お店の語り口で
- これまでの題名と重ならないようにする: ${series.posts.map((p) => p.title).join(" / ") || "なし"}
- 最後に予約・来店への一言を入れる（押し売りにしない）
${RULES}
${lawOf(c.kind, c.industry)}`,
    `${facts(c)}\n\n出力: {"title":"","body":""}`,
    { maxTokens: 3000 }
  );
  const body = N(r.body);
  const cnt = withCount("本文", body, limit);
  const verdict = await checkGuard([`${r.title}\n${body}`], c.industry);
  const post: SeriesPost = { theme: theme.title, title: N(r.title) || theme.title, body, count: cnt.count ?? 0, createdAt: new Date().toISOString(), hits: verdict.hits };
  return { series: { ...series, posts: [...series.posts, post].slice(-24) }, post };
}

// ── 作り直し（短く・やわらかく・別案） ───────────────────────
export async function rewriteCopy(c: Pick<KitCtx, "kind" | "industry">, text: string, mode: "短く" | "やわらかく" | "別案", limit?: number) {
  const r = await askJson<{ text: string }>(
    `渡された文言を作り直す。
- 短く: 意味を変えずに3割ほど短く${limit ? `（${limit}文字以内）` : ""}
- やわらかく: 言い切りを減らし、来る人に話しかけるような言い方に
- 別案: 同じ事実で切り口を変えた別の案
今回: ${mode}
${RULES}
${lawOf(c.kind, c.industry)}`,
    `${text}\n\n出力: {"text":""}`,
    { model: MODEL_FAST, maxTokens: 2500 }
  );
  const out = N(r.text).trim() || text;
  const verdict = await checkGuard([out], c.industry);
  return { ...withCount("", out, limit), hits: verdict.hits };
}
