import { askJsonWithImages } from "./anthropic";

/**
 * バナーに使える写真かどうかを見る。
 *
 * 文字が焼き込まれた画像を切り抜くと、その文字が途中で切れる。
 * 位置を動かして避けるやり方は、文字が広く入っている画像では成り立たない。
 * だから「避けて切る」のではなく「文字が入っている画像を候補から外す」。
 *
 * 判定は画像を見ないとできないので、1回だけ AI に見せる。
 * 分析1件につき1回の呼び出しで、候補すべてをまとめて見る。
 */

export type ImageCheck = {
  url: string;
  /** 文字が焼き込まれているか */
  hasText: boolean;
  /** 人物の顔が写っているか。医療・美容では扱いに注意が要る */
  hasFace: boolean;
  /** 一言。なぜ使えない／使えるのか */
  note: string;
};

export type ImageScan = { items: ImageCheck[]; checkedAt: string };

const MAX = 10;
/** 1枚あたりの上限。大きすぎる画像は送らない */
const MAX_BYTES = 3_500_000;

async function fetchImage(url: string): Promise<{ media: string; base64: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0", accept: "image/*" },
      signal: AbortSignal.timeout(10_000),
    });
    const media = res.headers.get("content-type")?.split(";")[0] ?? "";
    // Claude が受け取れる形式だけ。webp は受け取れないので対象外にする
    if (!res.ok || !/^image\/(png|jpeg|gif|webp)$/.test(media)) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) return null;
    return { media, base64: Buffer.from(buf).toString("base64") };
  } catch {
    return null;
  }
}

export async function checkImages(urls: string[]): Promise<ImageScan> {
  const list = urls.slice(0, MAX);
  const fetched = await Promise.all(list.map(async (u) => ({ url: u, im: await fetchImage(u) })));
  const usable = fetched.filter((x): x is { url: string; im: { media: string; base64: string } } => !!x.im);
  if (usable.length === 0) return { items: [], checkedAt: new Date().toISOString() };

  let res: { items: { index: number; hasText: boolean; hasFace: boolean; note: string }[] };
  try {
    res = await askJsonWithImages(
      `あなたは広告バナーに使う写真を選ぶ人です。渡された画像を1枚ずつ見て、判定します。

hasText は、画像の中に**読める文字が焼き込まれているか**。
　ロゴの中の社名、キャッチコピー、価格表示、Before/After の文字なども文字に含める。
　文字があるとバナーで切り抜いたときに途中で切れるので、使えません。
hasFace は、人物の顔がはっきり写っているか。
note は、その画像がバナーに向くか向かないかを15文字以内で。

判定は見えたままを答えること。推測で補わない。`,
      `画像は ${usable.length} 枚です。index は 0 から始まる画像の番号です。

出力: {"items":[{"index":0,"hasText":false,"hasFace":false,"note":""}]}`,
      usable.map((x) => x.im),
      { maxTokens: 1500 }
    );
  } catch {
    return { items: [], checkedAt: new Date().toISOString() };
  }

  const items: ImageCheck[] = [];
  for (const r of res.items ?? []) {
    const src = usable[r.index];
    if (!src) continue;
    items.push({ url: src.url, hasText: !!r.hasText, hasFace: !!r.hasFace, note: r.note ?? "" });
  }
  return { items, checkedAt: new Date().toISOString() };
}
