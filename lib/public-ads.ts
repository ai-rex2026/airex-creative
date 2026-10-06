import { askJson } from "./anthropic";
import { checkGuard } from "./guardrail";
import { geminiGenerate, hasGemini } from "./gemini";
import { runApifyActor } from "./social";
import type { Diagnosis, GuardHit } from "./types";

/**
 * 公開情報から見た「出稿中の広告」（2026-10-06 新設・第1段階）。
 *
 * 広告アカウントを連携していなくても、Meta 広告ライブラリと Google 広告透明性センターに公開されている
 * 自社の広告を Apify で読み、レポートの精度を上げる。成果の数字（費用・CV）は公開されていないので扱わない。
 * 工程は3段階で、それぞれ終わった時点で保存する（lib/analysis.ts。再試行で済んだ段階をやり直さない）：
 *   1. fetched   … Meta・Google の広告を Apify で取得（各1回。claim_apify_call の予算を通す）
 *   2. creatives … 画像・動画を Gemini Flash-Lite に見せて、素材内の文字の書き起こしと事実の整理（1回）
 *   3. done      … 法令チェック（既存の checkGuard）と、所見・施策案（メインのAI。1回）
 * 費用の目安：1回あたり約20円（2026-10-06 に medicalbrows で実測。Apify 約3.5円・Gemini 約1円・Claude 約9円）。
 * 出稿・入札・予算の変更はしない（読み取りと提案のみ）。
 */

export type PublicMetaAd = {
  id: string;
  title: string;
  body: string;
  linkUrl: string;
  format: string;
  startDate: string;
  platforms: string[];
  imageUrls: string[];
  videoUrls: string[];
  adLibraryUrl: string;
  /** 同じ素材（見出し・本文・形式が同じ）で配信している広告の数（この広告を含む）。2026-10-06 夜〜 */
  sameCount?: number;
  /** 同じ素材の配信先LP（この広告以外） */
  otherLinks?: string[];
};

export type PublicGoogleAd = {
  id: string;
  format: string;
  firstShown: string;
  lastShown: string;
  imageUrl: string;
  headline: string;
  body: string;
  /** 同じ素材（同じ表示見本）の広告の数（この広告を含む）。2026-10-06 夜〜 */
  sameCount?: number;
};

/** 画像・動画の制作案（コンセプトではなく、作る素材の粒度）。2026-10-06 夜〜 */
export type CreativeProposal = {
  /** 形式（例：縦型動画 9:16・15秒／静止画 4:5） */
  format: string;
  /** 狙い（今の広告のどこを埋めるか。番号を引用） */
  aim: string;
  /** 構成（動画は冒頭3秒・中盤・最後、静止画は主役・文字・CTA） */
  structure: string[];
  /** 画像・動画内に入れる文言の案 */
  onscreenText: string;
  /** 撮影・素材のメモ */
  shoot: string;
  flags?: { text: string; law: string; reason: string; suggestion: string }[];
};

export type CreativeNote = {
  /** 素材の番号（m1… は Meta、g1… は Google） */
  ref: string;
  kind: "画像" | "動画";
  what: string;
  onscreenText: string;
  aspect: string;
  first3s?: string;
  subtitles?: string;
};

export type PublicAdsMeasure = { title: string; why: string; steps: string[]; impact: "大" | "中" | "小" };

export type PublicAds = {
  stage: "fetched" | "creatives" | "done";
  fetchedAt: string;
  meta: { status: "ok" | "none" | "skipped" | "error"; pageUrl: string | null; ads: PublicMetaAd[]; error?: string };
  google: { status: "ok" | "none" | "skipped" | "error"; domain: string | null; ads: PublicGoogleAd[]; error?: string };
  creatives?: CreativeNote[];
  creativeError?: string;
  /** 機械的に出せる指摘（AIを使わない） */
  facts?: { lpDomains: string[]; lpOffSite: boolean; duplicateCreatives: number; aspects: Record<string, number> };
  /** platform：どちらの広告の表現か（2026-10-06 夜〜。それ以前の結果には無い） */
  legal?: { text: string; law: string; reason: string; suggestion: string; severity: string; platform?: "meta" | "google" }[];
  /** 所見・施策案を媒体ごとに分けたもの（2026-10-06 夜〜）。画面はこちらを優先して出す */
  byPlatform?: {
    meta: { findings: string[]; measures: PublicAdsMeasure[]; proposals?: CreativeProposal[] };
    google: { findings: string[]; measures: PublicAdsMeasure[]; proposals?: CreativeProposal[] };
  };
  /** 両媒体をまとめたもの（施策の台帳と、分ける前の結果の表示に使う） */
  findings?: string[];
  measures?: PublicAdsMeasure[];
  reviewError?: string;
};

/** 2026-10-06：30件ずつでは同じ素材の使い回しが並ぶだけで読みにくかったため減らした */
const MAX_META = 15;
const MAX_GOOGLE = 10;
/**
 * 一覧と分析に使う広告の数（同じ素材をまとめた後）。2026-10-06 夜：所見・施策案は媒体ごとに数件なので、
 * 分析対象も少なくてよい。取得は上の件数のまま（同じ素材の使い回しが多いと、少なく取ると別パターンを取りこぼすため）
 */
const SHOW_META = 5;
const SHOW_GOOGLE = 5;
const MAX_IMAGES = 10;
const MAX_VIDEOS = 5;
const MAX_GOOGLE_IMAGES = 8;
const MAX_VIDEO_BYTES = 40 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** 2026-10-06 の試験では2本並行で数十秒〜2分ほどかかった。分析の1回分（240秒）に収まる範囲で長めに待つ */
const APIFY_TIMEOUT_MS = 150_000;
const META_ACTOR = process.env.APIFY_ACTOR_META_ADS || "automation-lab/facebook-ads-library";
const GOOGLE_ACTOR = process.env.APIFY_ACTOR_GOOGLE_ADS || "automation-lab/google-ads-scraper";

const s = (v: unknown) => (typeof v === "string" ? v : "");
const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/** Apify（automation-lab/facebook-ads-library）の結果を保存する形にする */
export function mapMetaItems(items: Record<string, unknown>[]): PublicMetaAd[] {
  return items.slice(0, MAX_META).map((x, i) => ({
    id: s(x.adArchiveId) || `m${i + 1}`,
    title: s(x.title),
    body: s(x.bodyText).slice(0, 600),
    linkUrl: s(x.linkUrl),
    format: s(x.displayFormat),
    startDate: s(x.startDate),
    platforms: arr(x.platforms),
    imageUrls: arr(x.imageUrls).slice(0, 3),
    videoUrls: arr(x.videoUrls).slice(0, 1),
    adLibraryUrl: s(x.adLibraryUrl),
  }));
}

/** Apify（automation-lab/google-ads-scraper）の結果を保存する形にする */
export function mapGoogleItems(items: Record<string, unknown>[]): PublicGoogleAd[] {
  return items.slice(0, MAX_GOOGLE).map((x, i) => ({
    id: s(x.creativeId) || `g${i + 1}`,
    format: s(x.adFormat),
    firstShown: s(x.firstShown),
    lastShown: s(x.lastShown),
    imageUrl: s(x.imageUrl),
    headline: s(x.headline),
    body: s(x.body) || s(x.adText),
  }));
}

const norm = (t: string) => t.replace(/\s+/g, "").toLowerCase();

/** 見出し・本文・形式が同じ広告を1つにまとめる（配信先LPだけ違う使い回しが多いため）。並びは最初に出た順 */
export function dedupeMeta(ads: PublicMetaAd[]): PublicMetaAd[] {
  const map = new Map<string, PublicMetaAd>();
  for (const a of ads) {
    const key = `${a.format}|${norm(a.title)}|${norm(a.body)}`;
    const cur = map.get(key);
    if (!cur) {
      map.set(key, { ...a, sameCount: 1, otherLinks: [] });
      continue;
    }
    cur.sameCount = (cur.sameCount ?? 1) + 1;
    if (a.linkUrl && a.linkUrl !== cur.linkUrl && !(cur.otherLinks ?? []).includes(a.linkUrl)) cur.otherLinks = [...(cur.otherLinks ?? []), a.linkUrl];
  }
  return [...map.values()];
}

/** 同じ表示見本（画像URL）の広告を1つにまとめる */
export function dedupeGoogle(ads: PublicGoogleAd[]): PublicGoogleAd[] {
  const map = new Map<string, PublicGoogleAd>();
  for (const a of ads) {
    const key = a.imageUrl || `${a.format}|${norm(a.headline)}|${norm(a.body)}|${a.id}`;
    const cur = map.get(key);
    if (cur) cur.sameCount = (cur.sameCount ?? 1) + 1;
    else map.set(key, { ...a, sameCount: 1 });
  }
  return [...map.values()];
}

/** 工程1：Meta・Google の公開広告を取る。どちらかが失敗しても、もう一方は残す */
export async function fetchPublicAds(analysisId: string, siteUrl: string | null, facebookUrl: string | null): Promise<PublicAds> {
  const domain = hostOf(siteUrl);
  const [m, g] = await Promise.allSettled([
    facebookUrl
      ? runApifyActor(analysisId, META_ACTOR, { pageUrls: [facebookUrl], country: "JP", activeStatus: "active", maxAds: MAX_META }, APIFY_TIMEOUT_MS)
      : Promise.resolve(null),
    domain ? runApifyActor(analysisId, GOOGLE_ACTOR, { domains: [domain], region: "JP", maxAds: MAX_GOOGLE }, APIFY_TIMEOUT_MS) : Promise.resolve(null),
  ]);
  const msg = (r: PromiseRejectedResult) => (r.reason instanceof Error ? r.reason.message : String(r.reason));

  const meta: PublicAds["meta"] =
    m.status === "rejected"
      ? { status: "error", pageUrl: facebookUrl, ads: [], error: msg(m) }
      : m.value === null
        ? { status: "skipped", pageUrl: null, ads: [] }
        : (() => {
            const ads = dedupeMeta(mapMetaItems(m.value)).slice(0, SHOW_META);
            return { status: ads.length ? "ok" : "none", pageUrl: facebookUrl, ads } as PublicAds["meta"];
          })();

  const google: PublicAds["google"] =
    g.status === "rejected"
      ? { status: "error", domain, ads: [], error: msg(g) }
      : g.value === null
        ? { status: "skipped", domain: null, ads: [] }
        : (() => {
            const ads = dedupeGoogle(mapGoogleItems(g.value)).slice(0, SHOW_GOOGLE);
            return { status: ads.length ? "ok" : "none", domain, ads } as PublicAds["google"];
          })();

  return { stage: "fetched", fetchedAt: new Date().toISOString(), meta, google };
}

async function download(url: string, limit: number) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > limit) throw new Error("大きすぎます");
  return { data: buf.toString("base64"), mime: res.headers.get("content-type")?.split(";")[0] || "application/octet-stream" };
}

/**
 * 工程2：画像・動画の中身を Gemini Flash-Lite で読む（素材内の文字の書き起こしと、見せているものの整理）。
 * 2026-10-06 の試験で、書き起こしは正確だが法令の判断は浅かったため、ここでは事実の整理だけをさせ、
 * 法令と改善案は工程3（既存の法令チェックとメインのAI）に回す。
 */
export async function readCreatives(p: PublicAds): Promise<PublicAds> {
  const items: { ref: string; kind: "画像" | "動画"; url: string; limit: number }[] = [];
  const seen = new Set<string>();
  const push = (ref: string, kind: "画像" | "動画", url: string, limit: number) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    items.push({ ref, kind, url, limit });
  };
  p.meta.ads.forEach((a, i) => a.imageUrls.slice(0, 1).forEach((u) => push(`m${i + 1}`, "画像", u, MAX_IMAGE_BYTES)));
  const imgs = items.splice(0).slice(0, MAX_IMAGES);
  p.meta.ads.forEach((a, i) => a.videoUrls.forEach((u) => push(`m${i + 1}`, "動画", u, MAX_VIDEO_BYTES)));
  const vids = items.splice(0).slice(0, MAX_VIDEOS);
  // Google のテキスト広告は、文字ではなく画像として公開されている（2026-10-06 確認）。画像から書き起こす
  p.google.ads.forEach((a, i) => push(`g${i + 1}`, "画像", a.imageUrl, MAX_IMAGE_BYTES));
  const gimgs = items.splice(0).slice(0, MAX_GOOGLE_IMAGES);
  const all = [...imgs, ...vids, ...gimgs];
  if (all.length === 0 || !hasGemini()) {
    return { ...p, stage: "creatives", creatives: [], ...(all.length && !hasGemini() ? { creativeError: "画像・動画を読むAIが未設定です" } : {}) };
  }

  const settled = await Promise.allSettled(all.map((x) => download(x.url, x.limit)));
  const parts: { text?: string; inline_data?: { mime_type: string; data: string } }[] = [];
  const used: typeof all = [];
  settled.forEach((r, i) => {
    if (r.status !== "fulfilled") return;
    used.push(all[i]);
    parts.push({ text: `【${all[i].ref}】${all[i].kind}${all[i].ref.startsWith("g") ? "（Google 検索広告の表示見本）" : ""}` });
    parts.push({ inline_data: { mime_type: r.value.mime, data: r.value.data } });
  });
  if (used.length === 0) return { ...p, stage: "creatives", creatives: [], creativeError: "画像・動画を取得できませんでした" };

  try {
    const res = await geminiGenerate({
      system: `渡された広告の画像・動画を、見えるとおりに記録します。評価や法令の判断はしません。
素材ごとに：ref（見出しの【】内）、kind（画像/動画）、what（何を見せているか1文）、onscreenText（素材内の文字を省略せずそのまま書き起こす）、
aspect（1:1／4:5／9:16／16:9 など）、first3s（動画のみ。冒頭3秒に映るもの）、subtitles（動画のみ。あり/なし）
JSONのみ：{"items":[{"ref":"m1","kind":"画像","what":"","onscreenText":"","aspect":"","first3s":"","subtitles":""}]}`,
      parts,
      maxTokens: 6000,
      json: true,
      timeoutMs: 120_000,
    });
    const j = JSON.parse(res.text) as { items?: CreativeNote[] };
    const refs = new Set(used.map((u) => u.ref));
    const creatives = (j.items ?? [])
      .filter((c) => c && typeof c.ref === "string" && refs.has(c.ref))
      .map((c) => ({
        ref: c.ref,
        kind: (c.kind === "動画" ? "動画" : "画像") as "画像" | "動画",
        what: s(c.what),
        onscreenText: s(c.onscreenText),
        aspect: s(c.aspect),
        ...(c.first3s ? { first3s: s(c.first3s) } : {}),
        ...(c.subtitles ? { subtitles: s(c.subtitles) } : {}),
      }));
    return { ...p, stage: "creatives", creatives };
  } catch (e) {
    return { ...p, stage: "creatives", creatives: [], creativeError: e instanceof Error ? e.message : String(e) };
  }
}

/** 機械的に出せる指摘（AIを使わない） */
export function publicAdFacts(p: PublicAds, siteUrl: string | null): NonNullable<PublicAds["facts"]> {
  const site = hostOf(siteUrl);
  const lpDomains = [...new Set(p.meta.ads.map((a) => hostOf(a.linkUrl)).filter((x): x is string => !!x))];
  const texts = (p.creatives ?? []).map((c) => c.onscreenText.trim()).filter((t) => t.length > 8);
  const duplicateCreatives = texts.length - new Set(texts).size;
  const aspects: Record<string, number> = {};
  for (const c of p.creatives ?? []) if (c.aspect) aspects[c.aspect] = (aspects[c.aspect] ?? 0) + 1;
  return { lpDomains, lpOffSite: !!site && lpDomains.length > 0 && lpDomains.every((d) => d !== site && !d.endsWith(`.${site}`)), duplicateCreatives, aspects };
}

/** 指摘された文言がどちらの広告のものか（Meta の文言・素材内の文字に含まれていれば Meta） */
function platformOfText(p: PublicAds, text: string): "meta" | "google" {
  const inMeta =
    p.meta.ads.some((a) => a.title.includes(text) || a.body.includes(text)) ||
    (p.creatives ?? []).some((c) => c.ref.startsWith("m") && c.onscreenText.includes(text));
  if (inMeta) return "meta";
  const inGoogle =
    p.google.ads.some((a) => a.headline.includes(text) || a.body.includes(text)) ||
    (p.creatives ?? []).some((c) => c.ref.startsWith("g") && c.onscreenText.includes(text));
  return inGoogle ? "google" : "meta";
}

const MEDICAL_RULES = `- 医療・美容医療の広告では、医療広告ガイドラインの観点で次を必ず確認し、該当があれば legal に書く：
  ・患者の体験談・口コミ（「痛みも無く」「もっと早く受ければ良かった」など本人の感想の形）
  ・ビフォーアフター写真（治療内容・費用・リスク・副作用の併記が無い場合）
  ・最上級・比較・権威の表現（「No.1」「最多」「世界大会◯冠」「SNSで話題」など）
  ・費用を強調した誘引（「モニター価格」「限定」など）`;

/** 工程3：法令チェックと、所見・施策案 */
export async function reviewPublicAds(p: PublicAds, d: Diagnosis, siteUrl: string | null): Promise<PublicAds> {
  const facts = publicAdFacts(p, siteUrl);
  const hasAny = p.meta.ads.length > 0 || p.google.ads.length > 0;
  if (!hasAny) return { ...p, stage: "done", facts, legal: [], findings: [], measures: [] };

  // 法令チェック：広告の文言と、画像・動画内の文字
  const texts = [
    ...p.meta.ads.flatMap((a) => [a.title, a.body]),
    ...p.google.ads.flatMap((a) => [a.headline, a.body]),
    ...(p.creatives ?? []).map((c) => c.onscreenText),
  ].filter((t) => t && t.trim());
  let guard: GuardHit[] = [];
  try {
    guard = (await checkGuard([...new Set(texts)], d.industry)).hits.filter((h) => h.severity !== "low");
  } catch {
    // 検査できなくても所見は出す
  }

  const lines = [
    `【分析したサイト】${siteUrl ?? "（URLなし）"}`,
    `【Meta 広告（配信中 ${p.meta.ads.length}件）】`,
    ...p.meta.ads.slice(0, 15).map((a, i) => `- M${i + 1}［${a.format}／${a.startDate}〜／${a.platforms.join("・")}${(a.sameCount ?? 1) > 1 ? `／同じ素材で${a.sameCount}本配信` : ""}］見出し：${a.title}／本文：${a.body.replace(/\s+/g, " ").slice(0, 160)}／LP：${a.linkUrl}`),
    `【Google 広告（${p.google.ads.length}件）】`,
    ...p.google.ads.slice(0, 15).map((a, i) => `- G${i + 1}［${a.format}／${a.firstShown}〜${a.lastShown}］${a.headline} ${a.body}`.trim()),
    `【画像・動画の中身（AIで書き起こし）】`,
    ...(p.creatives ?? []).map((c) => `- ${c.ref.toUpperCase()}［${c.kind}／${c.aspect}${c.subtitles ? `／字幕${c.subtitles}` : ""}］${c.what}／文字：${c.onscreenText}${c.first3s ? `／冒頭3秒：${c.first3s}` : ""}`),
    `【機械的に分かったこと】LPのドメイン：${facts.lpDomains.join("・") || "不明"}${facts.lpOffSite ? "（分析したサイトとは別のドメイン）" : ""}／文字が同じ素材：${facts.duplicateCreatives}件／縦横比：${Object.entries(facts.aspects).map(([k, v]) => `${k}×${v}`).join("・") || "不明"}`,
    guard.length ? `【法令チェックの指摘】\n${guard.map((h) => `- 「${h.text}」${h.law}：${h.reason}`).join("\n")}` : "",
  ].join("\n");

  try {
    type Side = { findings: string[]; measures: PublicAdsMeasure[]; proposals: CreativeProposal[] };
    const out = await askJson<{ meta: Side; google: Side; legal: { text: string; law: string; reason: string; suggestion: string; platform: string }[] }>(
      `あなたは運用型広告のクリエイティブと受け皿（LP）の実務者です。公開情報（広告ライブラリ・透明性センター）で見えている広告だけを材料に、所見と施策案を書きます。
守ること:
- 成果の数字（費用・CV・CTR）は分からない。推測で書かない。「配信が長く続いている」は事実として書いてよい
- 効果や結果を断定しない。「必ず」「確実に」「最も」は使わない
- 所見と施策案は、Meta 広告（meta）と Google 広告（google）に分けて書く。広告が0件の媒体は空の配列にする
- findings は媒体ごとに2〜4件。広告の番号（Meta は M1・M2…、Google は G1・G2…。小文字にしない）と文言を引用して「何が起きているか」を書く
- measures は媒体ごとに2〜4件。title は「何をするか」を動詞で（「〜の検討」「〜の強化」は禁止）。why は引用した事実、steps は3〜5手順、impact は 大／中／小
- proposals（制作案）は媒体ごとに2〜3件。方針ではなく「この形式で、この構成の素材を作る」粒度で書く：
  format（例：縦型動画 9:16・15秒／静止画 4:5／静止画 1:1。Google は表示見本の文言を想定したレスポンシブ広告の見出し・説明文でもよい）、
  aim（今の広告で足りない訴求・配信面のどこを埋めるか。広告の番号を引用）、
  structure（動画は「冒頭3秒」「中盤」「最後（CTA）」、静止画は「主役のビジュアル」「文字の配置」「CTA」をそれぞれ1行ずつ）、
  onscreenText（画像・動画内に入れる文言の案。下の法令上の注意に触れない表現にする）、shoot（撮影・素材のメモ）
- LPが分析したサイトと別のドメインなら、広告の受け皿のLPを確認・改善する施策を入れる
- 縦横比が偏っている（例：画像が1:1だけ）なら、配信面に合わせた作り分けを施策に入れる
- legal は、渡された【法令チェックの指摘】に加えて、あなたが気づいた法令上の注意（無ければ空）。platform にどちらの広告の表現か（meta／google）を入れる
${d.industry === "medical" || d.industry === "beauty" ? MEDICAL_RULES : ""}`,
      `【事業】${d.product}（対象：${d.audience}）\n${lines}\n\n出力:\n{"meta":{"findings":[""],"measures":[{"title":"","why":"","steps":[""],"impact":"中"}],"proposals":[{"format":"","aim":"","structure":[""],"onscreenText":"","shoot":""}]},"google":{"findings":[""],"measures":[],"proposals":[]},"legal":[{"text":"","law":"","reason":"","suggestion":"","platform":"meta"}]}`,
      { maxTokens: 8000 }
    );
    const legal = [
      ...guard.map((h) => ({ text: h.text, law: h.law, reason: h.reason, suggestion: h.suggestion, severity: h.severity, platform: platformOfText(p, h.text) })),
      ...(out.legal ?? [])
        .filter((x) => x && s(x.text) && !guard.some((h) => h.text === x.text))
        .map((x) => ({
          text: s(x.text),
          law: s(x.law),
          reason: s(x.reason),
          suggestion: s(x.suggestion),
          severity: "medium",
          platform: x.platform === "google" ? ("google" as const) : x.platform === "meta" ? ("meta" as const) : platformOfText(p, s(x.text)),
        })),
    ].slice(0, 12);
    const side = (x: Side | undefined, has: boolean): Side =>
      has
        ? {
            findings: (x?.findings ?? []).filter((f) => typeof f === "string" && f.trim()).slice(0, 4),
            measures: (x?.measures ?? []).filter((m) => m && typeof m.title === "string" && m.title.trim()).slice(0, 4),
            proposals: (x?.proposals ?? [])
              .filter((c) => c && typeof c.format === "string" && c.format.trim())
              .slice(0, 3)
              .map((c) => ({
                format: s(c.format),
                aim: s(c.aim),
                structure: arr(c.structure).slice(0, 5),
                onscreenText: s(c.onscreenText),
                shoot: s(c.shoot),
              })),
          }
        : { findings: [], measures: [], proposals: [] };
    const byPlatform = { meta: side(out.meta, p.meta.ads.length > 0), google: side(out.google, p.google.ads.length > 0) };
    // 制作案の文言も法令チェックを通す（AGENTS.md：生成と同時にチェックする）
    const propTexts = [...byPlatform.meta.proposals, ...byPlatform.google.proposals].flatMap((c) => [c.onscreenText, ...c.structure]).filter(Boolean);
    if (propTexts.length) {
      try {
        const hits = (await checkGuard([...new Set(propTexts)], d.industry)).hits.filter((h) => h.severity !== "low");
        for (const c of [...byPlatform.meta.proposals, ...byPlatform.google.proposals]) {
          const own = hits.filter((h) => [c.onscreenText, ...c.structure].some((t) => t.includes(h.text)));
          if (own.length) c.flags = own.map((h) => ({ text: h.text, law: h.law, reason: h.reason, suggestion: h.suggestion }));
        }
      } catch {
        // 検査できなくても制作案は出す
      }
    }
    return {
      ...p,
      stage: "done",
      facts,
      legal,
      byPlatform,
      findings: [...byPlatform.meta.findings, ...byPlatform.google.findings],
      measures: [...byPlatform.meta.measures, ...byPlatform.google.measures],
    };
  } catch (e) {
    return {
      ...p,
      stage: "done",
      facts,
      legal: guard.map((h) => ({ text: h.text, law: h.law, reason: h.reason, suggestion: h.suggestion, severity: h.severity, platform: platformOfText(p, h.text) })),
      findings: [],
      measures: [],
      reviewError: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * 広告運用設計（lib/ad-ops.ts の generateCampaign）に渡す要約。2026-10-06〜：
 * 公開情報で見えている今の広告と所見・制作案を踏まえて、広告運用設計の原稿と制作案を作る（重複させない）。
 * まだ調べ終わっていない・広告が無いときは空文字
 */
export function publicAdsNote(p: PublicAds | null | undefined, channel: string): string {
  if (!p || p.stage !== "done") return "";
  const isMeta = /meta|facebook|instagram|インスタ/i.test(channel);
  // ヤフー・Microsoft の検索・ディスプレイは Google の公開情報と無関係なので渡さない
  const isGoogle = !/yahoo|ヤフー|microsoft|bing/i.test(channel) && /google|youtube|p-?max|ディスプレイ|gdn|検索/i.test(channel);
  const side = isMeta ? "meta" : isGoogle ? "google" : null;
  if (!side) return "";
  const ads = side === "meta" ? p.meta.ads : p.google.ads;
  if (ads.length === 0) return "";
  const bp = p.byPlatform?.[side];
  const notes = new Map((p.creatives ?? []).map((c) => [c.ref, c]));
  const lines = [
    `【出稿中の広告（公開情報）：${side === "meta" ? "Meta" : "Google"}】`,
    ...(side === "meta"
      ? p.meta.ads.map((a, i) => `- M${i + 1}［${a.format}］${a.title}／${a.body.replace(/\s+/g, " ").slice(0, 80)}${notes.get(`m${i + 1}`)?.onscreenText ? `／素材内：${notes.get(`m${i + 1}`)!.onscreenText.slice(0, 80)}` : ""}`)
      : p.google.ads.map((a, i) => `- G${i + 1}［${a.format}］${[a.headline, a.body].filter(Boolean).join(" ") || notes.get(`g${i + 1}`)?.onscreenText?.slice(0, 80) || ""}`)),
    ...(bp?.findings?.length ? ["所見：", ...bp.findings.map((f) => `- ${f}`)] : []),
    ...(bp?.proposals?.length
      ? ["制作案：", ...bp.proposals.map((c) => `- ${c.format}：${c.aim}／${c.structure.join("→")}／文言案：${c.onscreenText}`)]
      : []),
    ...((p.legal ?? []).filter((l) => (l.platform ?? "meta") === side).length
      ? ["法令上の注意（使わない表現）：", ...(p.legal ?? []).filter((l) => (l.platform ?? "meta") === side).map((l) => `- 「${l.text}」${l.law}`)]
      : []),
  ];
  return lines.join("\n").slice(0, 3000);
}
