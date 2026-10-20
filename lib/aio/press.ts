import { askJson } from "../anthropic";
import { checkGuard } from "../guardrail";
import { normalizeJapanese } from "../meo-ops/japanese";
import type { GuardVerdict } from "../types";
import { bodyChars, h2List } from "./md";
import { PRESS_KINDS, PRESS_MAX_INLINE_IMAGES, PRESS_MAX_VIDEOS, type PressBrief, type PressContent, type PressImage, type PressRelease, type PressVideo } from "./press-types";
import type { AioProject } from "./types";

/**
 * PR TIMES 向けプレスリリースの入稿内容を作る。
 * - 事実を創作しない（数字・日付・価格・固有名詞は、与えられたものだけ。無いものは【要確認：〇〇】で残す）
 * - 画像は文字を描かせない（AGENTS.md）。動画は人が用意した URL だけを本文の位置に置く
 * - 表現の法令チェック（guardPress）は生成と同時に通す
 */

const SYSTEM = `あなたは日本の広報担当者です。PR TIMES などのプレスリリース配信サービスに入稿するプレスリリースの内容を作ります。
ニュースとして読まれる、事実ベースの発表文にします。宣伝文句ではなく「何が・誰に・いつから・なぜ」を明確に書きます。

守ること:
- 事実を創作しない。与えられていない数字・日付・価格・提供開始日・実績・受賞・顧客名・調査結果・代表者名・所在地・人名を書かない
- 与えられていない事実が必要な箇所は「【要確認：提供開始日】」「【要確認：価格】」のように、何が要るかを書いた印で残す
- 「必ず」「絶対」「No.1」「最高」「業界初」「唯一」「圧倒的」など根拠の要る断定・最上級を使わない。効果や成果を約束しない
- 医療・美容・健康食品・金融の効果効能を断定しない。他社を名指しで比べたり貶めたりしない
- 日本語の文章で通常使う漢字（常用漢字・日本の新字体）だけで書く。中国語の簡体字・繁体字を使わない

構成:
- titleOptions: タイトル案を3つ。1つ目を採用案にする。何を・誰が・どうしたかが分かり、数字は与えられたものだけ。長すぎず、冒頭に主要な語を置く
- subtitle: タイトルを補う1文（任意の補足。不要なら空文字）
- lead: リード文。本文の冒頭の要約として、誰が・何を・いつから・何のために、を3〜4文で
- body: 本文（Markdown。見出しは ## だけ、4〜6個）。「背景・課題」「発表の内容」「特長・仕組み」「今後の予定」など。箇条書きは使ってよい。タイトルは本文に入れない
- keywords: 検索や分類に使う語を3〜6個
- companyProfile: 会社概要（会社名・所在地・代表者・設立・事業内容・URL）。与えられていない項目は「【要確認：所在地】」の形
- relatedLinks: 関連リンクを最大3件（与えられた URL だけ。無ければ空配列）
- todo: 入稿前に人が確かめる項目。本文や会社概要に残した【要確認】の一覧を、重複なく短く
- images: メイン画像1枚（role "eyecatch"）と、本文中の画像を最大${PRESS_MAX_INLINE_IMAGES}枚（role "inline"。afterH2 は何番目の ## の直後に置くか、0 始まり）。prompt は画像生成 AI への英語の説明で、文字・看板・ロゴ・画面のスクリーンショット・グラフ・実在の人物や他社の商品は描かせない。値札・予算表・電卓・カレンダー・書類・ホワイトボード・メニュー表・パッケージなど文字や数字が載りがちな物も描かせない（数字の話題でも、人・手・場所・自然・無地の物の場面で表す）。alt と caption は日本語（画像の中には入れない。caption は画像の説明1文）

出力: {"titleOptions":["",""," "],"subtitle":"","lead":"","body":"","keywords":[""],"companyProfile":"","relatedLinks":[{"label":"","url":""}],"todo":[""],"images":[{"role":"eyecatch","afterH2":null,"prompt":"English description","alt":"","caption":""}]}`;

type Raw = {
  titleOptions?: unknown[];
  subtitle?: string;
  lead?: string;
  body?: string;
  keywords?: unknown[];
  companyProfile?: string;
  relatedLinks?: { label?: string; url?: string }[];
  todo?: unknown[];
  images?: { role?: string; afterH2?: number | null; prompt?: string; alt?: string; caption?: string }[];
};

const n = (v: unknown, max: number) => normalizeJapanese(String(v ?? "").trim()).slice(0, max);

/** 連絡先の文面（入力されたものだけ。無い項目は【要確認】） */
export function contactText(brief: PressBrief): string {
  const c = brief.contact;
  const lines = [
    c.company.trim() && `${c.company.trim()}${c.department.trim() ? ` ${c.department.trim()}` : ""}`,
    c.person.trim() && `担当：${c.person.trim()}`,
    `メール：${c.email.trim() || "【要確認：メールアドレス】"}`,
    `電話：${c.tel.trim() || "【要確認：電話番号】"}`,
  ].filter(Boolean);
  return lines.join("\n");
}

/** YouTube などの URL だけ通す（http/https）。動画はそのまま貼る URL として扱う */
export function cleanVideos(videos: { url: string; title: string }[]): { url: string; title: string }[] {
  const out: { url: string; title: string }[] = [];
  for (const v of videos) {
    const url = v.url.trim();
    if (!/^https?:\/\/[^\s]+$/.test(url)) continue;
    out.push({ url: url.slice(0, 500), title: v.title.trim().slice(0, 80) });
    if (out.length >= PRESS_MAX_VIDEOS) break;
  }
  return out;
}

/** 動画を置く位置（本文の見出しの直後）を、先頭から順に、画像と重ならないよう散らして決める（コードで決める） */
export function placeVideos(videos: { url: string; title: string }[], h2n: number, imageAt: number[]): PressVideo[] {
  const taken = new Set(imageAt);
  return videos.map((v, k) => {
    let at = Math.min(Math.max(h2n - 1, 0), k + 1);
    for (let i = 0; i < h2n && taken.has(at); i++) at = (at + 1) % Math.max(h2n, 1);
    taken.add(at);
    return { ...v, afterH2: at };
  });
}

export async function draftPressRelease(
  project: AioProject,
  brief: PressBrief,
  today: string
): Promise<{ content: PressContent; images: PressImage[] }> {
  const kindLabel = PRESS_KINDS.find((k) => k.kind === brief.kind)?.label ?? "お知らせ";
  const videos = cleanVideos(brief.videos);
  const lines = [
    "# 発表する会社・事業",
    `事業者名: ${brief.contact.company.trim() || project.name}`,
    project.aliases.length ? `サービス名・別名: ${project.aliases.join(", ")}` : "",
    project.url ? `URL: ${project.url}` : "",
    project.notes ? `事業内容・強み（事業者の説明）: ${project.notes.slice(0, 1500)}` : "",
    project.siteSummary ? `Webサイトの見出し: ${project.siteSummary}` : "",
    "",
    "# 今回のリリース",
    `種類: ${kindLabel}`,
    `発表したい内容: ${brief.announcement.trim()}`,
    brief.facts.trim() ? `確かな事実（この中の数字・日付だけを使う）:\n${brief.facts.trim()}` : "確かな事実: （入力なし。数字・日付・価格は書かず、必要な箇所は【要確認】にする）",
    brief.releaseDate ? `配信を希望する日: ${brief.releaseDate}` : "配信を希望する日: 未定",
    `今日の日付: ${today}`,
    brief.note.trim() ? `書き手への補足: ${brief.note.trim()}` : "",
    videos.length ? `本文に入れる動画: ${videos.length}本（位置はこちらで決める。動画を紹介する一文は本文に書かなくてよい）` : "",
  ].filter((l) => l !== "");

  const res = await askJson<Raw>(SYSTEM, lines.join("\n"), { maxTokens: 8000, timeoutMs: 170_000 });

  const bodyMd = normalizeJapanese(String(res.body ?? "").trim()).replace(/^#\s+.+\n+/, "");
  if (bodyChars(bodyMd) < 300) throw new Error("プレスリリースを書けませんでした。発表したい内容と事実をもう少し具体的に入れてもう一度お試しください");
  const h2n = h2List(bodyMd).length;

  const titles = (Array.isArray(res.titleOptions) ? res.titleOptions : []).map((t) => n(t, 80)).filter(Boolean).slice(0, 3);
  if (!titles.length) throw new Error("タイトルを作れませんでした。もう一度お試しください");

  // 画像はメイン1枚＋本文中最大 PRESS_MAX_INLINE_IMAGES 枚に整える（AI の出力の数・位置をそのまま信じない）
  const raw = Array.isArray(res.images) ? res.images : [];
  const eye = raw.find((i) => i?.role === "eyecatch" && i.prompt) ?? raw.find((i) => i?.prompt);
  const inl = raw.filter((i) => i !== eye && i?.prompt).slice(0, PRESS_MAX_INLINE_IMAGES);
  const images: PressImage[] = [];
  const used = new Set<number>();
  if (eye) images.push({ key: "eyecatch", role: "eyecatch", afterH2: null, prompt: String(eye.prompt).slice(0, 800), alt: n(eye.alt, 60) || titles[0].slice(0, 40), caption: n(eye.caption, 80), path: null, source: "ai" });
  inl.forEach((i, k) => {
    let at = typeof i.afterH2 === "number" && i.afterH2 >= 0 && i.afterH2 < h2n ? Math.floor(i.afterH2) : Math.min(Math.max(h2n - 1, 0), k + 1);
    while (used.has(at) && at < h2n - 1) at++;
    if (used.has(at)) return;
    used.add(at);
    images.push({ key: `inline${k + 1}`, role: "inline", afterH2: at, prompt: String(i.prompt).slice(0, 800), alt: n(i.alt, 60), caption: n(i.caption, 80), path: null, source: "ai" });
  });

  const content: PressContent = {
    titleOptions: titles,
    title: titles[0],
    subtitle: n(res.subtitle, 100),
    lead: n(res.lead, 400),
    bodyMd,
    keywords: (Array.isArray(res.keywords) ? res.keywords : []).map((k) => n(k, 30)).filter(Boolean).slice(0, 6),
    companyProfile: n(res.companyProfile, 800),
    contactText: contactText(brief),
    relatedLinks: (Array.isArray(res.relatedLinks) ? res.relatedLinks : [])
      .map((l) => ({ label: n(l?.label, 60), url: String(l?.url ?? "").trim().slice(0, 300) }))
      .filter((l) => /^https?:\/\//.test(l.url))
      .slice(0, 3),
    todo: (Array.isArray(res.todo) ? res.todo : []).map((t) => n(t, 100)).filter(Boolean).slice(0, 12),
    videos: placeVideos(videos, h2n, [...used]),
  };
  return { content, images };
}

/** 表現の法令チェック（生成と同じ流れで通す。要修正が残るものは「入稿済み」にできない） */
export function guardPress(c: { title: string; subtitle: string; lead: string; bodyMd: string }, industry: AioProject["industry"]): Promise<GuardVerdict> {
  return checkGuard([c.title, c.subtitle, c.lead, c.bodyMd.slice(0, 9000)].filter(Boolean), industry);
}

/** 【要確認】が本文・会社概要・問い合わせに残っているか（入稿前の確認用） */
export function pendingMarks(r: Pick<PressRelease, "content">): string[] {
  const c = r.content;
  const text = [c.title, c.subtitle, c.lead, c.bodyMd, c.companyProfile, c.contactText].join("\n");
  return [...new Set([...text.matchAll(/【要確認[：:][^】]*】/g)].map((m) => m[0]))];
}

/** 本文の見出しごとに、画像・動画の挿入位置の印を入れたテキスト（PR TIMES の入稿画面に貼る用） */
export function bodyWithMarkers(r: Pick<PressRelease, "content" | "images">): string {
  const imgs = r.images.filter((i) => i.role === "inline");
  const vids = r.content.videos;
  const lines = r.content.bodyMd.split("\n");
  const out: string[] = [];
  let h = -1;
  const flush = () => {
    if (h < 0) return;
    imgs.forEach((i, k) => {
      if (i.afterH2 === h) out.push("", `［ここに画像${k + 1}を入れる${i.caption ? `：${i.caption}` : ""}］`);
    });
    vids.forEach((v, k) => {
      if (v.afterH2 === h) out.push("", `［ここに動画${k + 1}を入れる${v.title ? `：${v.title}` : ""}｜${v.url}］`);
    });
  };
  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      flush();
      h++;
    }
    out.push(line);
  }
  flush();
  return out.join("\n").replace(/^#{2,3}\s+/gm, "■ ").replace(/\*\*(.+?)\*\*/g, "$1");
}

/** 入稿用の全文（上から順に貼れる）。画像・動画の位置は印で示す */
export function fullSheet(r: Pick<PressRelease, "content" | "images">): string {
  const c = r.content;
  const eye = r.images.find((i) => i.role === "eyecatch");
  return [
    `【タイトル】\n${c.title}`,
    c.subtitle && `【サブタイトル】\n${c.subtitle}`,
    `【リード文】\n${c.lead}`,
    eye && `【メイン画像】\n${eye.caption || eye.alt}`,
    `【本文】\n${bodyWithMarkers(r)}`,
    c.keywords.length > 0 && `【キーワード】\n${c.keywords.join("、")}`,
    `【会社概要】\n${c.companyProfile}`,
    `【問い合わせ先】\n${c.contactText}`,
    c.relatedLinks.length > 0 && `【関連リンク】\n${c.relatedLinks.map((l) => `${l.label}：${l.url}`).join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}
