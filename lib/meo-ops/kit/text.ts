import type { Industry } from "../../types";
import type { MeoStoreSnapshot } from "../types";
import type { Copy, KitKind } from "./types";

/** AI は自分が書いた文字数を数えられないので、必ずコードで数える */
export function countChars(s: string) {
  return Array.from((s || "").replace(/\r?\n/g, "")).length;
}

export function withCount(field: string, text: string, limit?: number): Copy {
  const count = countChars(text || "");
  return { field, text: text || "", limit, count, over: limit ? count > limit : false };
}

/**
 * 媒体ごとの文字数上限。HPB は公開された上限が無いので安全側の短い値（オルコネと同じ）。
 * GBP は Google ビジネスプロフィール ヘルプの値。
 */
export const LIMITS = {
  hpb: { catch: 30, intro: 300, couponName: 30, couponDesc: 100, blog: 1000 },
  gbp: { description: 750, post: 1500 },
};

const FOOD_TYPE = /restaurant|cafe|coffee|bar|bakery|food|meal|izakaya|ramen|sushi|yakiniku|diner|pub|steak|pizza|noodle/i;
const FOOD_WORD = /飲食|レストラン|カフェ|居酒屋|ラーメン|焼肉|寿司|食堂|バー|ベーカリー|パン|料理|ダイニング|そば|うどん|定食|喫茶/;

/** 業種と Google の業種から、文章の書き分けを決める */
export function kindOf(industry: Industry, store: Pick<MeoStoreSnapshot, "primaryType" | "category"> | null): KitKind {
  if (industry === "beauty") return "beauty";
  const t = `${store?.primaryType ?? ""} ${store?.category ?? ""}`;
  if (FOOD_TYPE.test(t) || FOOD_WORD.test(t)) return "food";
  return "general";
}

export const KIND_LABEL: Record<KitKind, string> = { beauty: "サロン", food: "飲食店", general: "お店" };

export const RULES = `守ること:
- 根拠は渡された実測値（サイト本文・口コミ・評価・件数）だけを引用する。渡していない数字、最上級（No.1・最高・唯一）、断定（必ず・確実に）、一般論は書かない
- 効果や結果を約束しない。「〜を目指せます」「〜と感じていただけるよう」の形にする
- 実在しない設備・メニュー・実績を作らない。サイトに無いものは書かない
- 日本語の文章で通常使う漢字だけで書く`;

/** 業種ごとの法令の注意（文章を作るプロンプトに足す） */
export function lawOf(kind: KitKind, industry: Industry): string {
  if (industry === "medical") return "- 業種は医療。治療効果の保証・安全性の断定・体験談・術前術後の比較は書かない（医療広告ガイドライン）";
  if (kind === "beauty") return "- 業種は美容・サロン。薬機法の禁止表現（痩せる・シミが消える・若返る・小顔になる・治る・発毛 等）を使わない。使用感と印象で書く";
  if (kind === "food")
    return `- 業種は飲食。食品の健康効果（体に良い・痩せる・疲労回復）を書かない。素材・産地・製法の事実で書く
- 口コミの依頼は「率直なご感想をお願いします」型に固定し、良い評価や投稿内容を条件にしない（ステマ規制）`;
  return "- 口コミの依頼は「率直なご感想をお願いします」型に固定し、良い評価や投稿内容を条件にしない（ステマ規制）";
}

const NORM = (s: string) => s.replace(/[\s　]/g, "").toLowerCase();

/** 狙う語がページの本文に入っているか（AIに頼らず数える）。空白で区切った語は、どの部分も入っていれば入っているとみなす */
export function keywordHits(text: string, words: string[]) {
  const t = NORM(text || "");
  return words.map((w) => {
    const parts = String(w || "").split(/[\s　]+/).map(NORM).filter(Boolean);
    return { word: w, found: parts.length > 0 && parts.every((p) => t.includes(p)) };
  });
}

export function rankOf(total: number): { rank: string; advice: string } {
  if (total >= 85) return { rank: "A", advice: "今の形を保ち、更新を止めないようにしましょう" };
  if (total >= 70) return { rank: "B", advice: "あと一歩です。点の低い項目を1つずつ直すと届きます" };
  if (total >= 55) return { rank: "C", advice: "土台はあります。狙う語と、確かめられる数字を足しましょう" };
  if (total >= 40) return { rank: "D", advice: "伝わっていないことが多い状態です。説明文と紹介文から直しましょう" };
  return { rank: "E", advice: "ページの情報がほとんど整っていません。下の「やること」を上から順に進めましょう" };
}

/** ホットペッパービューティーのサロンページか（例: https://beauty.hotpepper.jp/slnH000123456/） */
export function hpbSalonUrl(url?: string | null): string | null {
  const m = (url || "").match(/beauty\.hotpepper\.jp\/(?:kr\/)?(sln[HK]?\d{6,})/i);
  return m ? `https://beauty.hotpepper.jp/${m[1]}/` : null;
}

export function normalizeUrl(s: string): string {
  const t = s.trim();
  if (!t) return "";
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

/** 公開 Web ページを読んで本文だけにする。社内アドレス・IP 直書きは読まない */
export async function readPage(url: string, opt: { browserUa?: boolean } = {}): Promise<{ title: string; text: string; finalUrl: string }> {
  const u = new URL(normalizeUrl(url));
  const host = u.hostname;
  if ((u.protocol !== "https:" && u.protocol !== "http:") || !host.includes(".") || /^[\d.]+$/.test(host) || host.includes(":") || /\.(local|internal|lan)$/.test(host) || host === "localhost") {
    throw new Error("このURLは読めません");
  }
  const res = await fetch(u.toString(), {
    headers: { "user-agent": opt.browserUa ? BROWSER_UA : "Mozilla/5.0 (compatible; AirexBot/1.0)", accept: "text/html,*/*", "accept-language": "ja,en;q=0.8" },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status >= 400) throw new Error(`ページを開けませんでした（HTTP ${res.status}）`);
  const html = (await res.text()).slice(0, 1_500_000);
  const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || "").trim();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 12_000);
  if (text.length < 200) throw new Error("本文がほとんど読めませんでした（ログインが要るページか、画像だけのページの可能性があります）");
  return { title, text, finalUrl: res.url || u.toString() };
}

/** Google の「クチコミを書く」画面の URL */
export function writeReviewUrl(placeId: string | null | undefined): string | null {
  return placeId ? `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}` : null;
}
