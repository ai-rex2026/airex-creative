import { askJsonWithImages } from "./anthropic";

/**
 * バナーに使える写真かどうかを見る。
 *
 * 文字が焼き込まれた画像を切り抜くと、その文字が途中で切れる。
 * 位置を動かして避けるやり方は、文字が広く入っている画像では成り立たない
 * （表示位置をどこにずらしても、枠のどこかに文字がかかってしまうため）。
 *
 * そこで、文字ありと判定した画像については「文字を一切含まない矩形領域」が
 * 十分な大きさで取れるかも合わせて判定させる。取れる場合は safeCrop にその
 * 領域（画像に対する % 座標）を返す。呼び出し側は、選択された瞬間にその
 * 領域だけを実際に切り出して使う（=文字が入り込む余地自体を無くす）。
 * 領域が無い・小さすぎる場合は safeCrop を null にし、これまで通り
 * 候補から外す（位置調整では逃げられないケース）。
 *
 * 判定は画像を見ないとできないので、1回だけ AI に見せる。
 * 分析1件につき1回の呼び出しで、候補すべてをまとめて見る。
 */

export type SafeCrop = { x0: number; y0: number; x1: number; y1: number };

export type ImageCheck = {
  url: string;
  /** 文字が焼き込まれているか */
  hasText: boolean;
  /** 人物の顔が写っているか。医療・美容では扱いに注意が要る */
  hasFace: boolean;
  /**
   * hasText のとき、文字を一切含まない矩形領域（画像に対する 0〜100 の%座標）。
   * 十分な大きさの領域が無ければ null。hasText が false のときは常に null
   */
  safeCrop: SafeCrop | null;
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

  let res: {
    items: {
      index: number;
      hasText: boolean;
      hasFace: boolean;
      safeCrop: SafeCrop | null;
      note: string;
    }[];
  };
  try {
    res = await askJsonWithImages(
      `あなたは広告バナーに使う写真を選ぶ人です。渡された画像を1枚ずつ見て、判定します。

hasText は、画像の中に**読める文字が焼き込まれているか**。
　ロゴの中の社名、キャッチコピー、価格表示、Before/After の文字なども文字に含める。
　文字があるとバナーで切り抜いたときに途中で切れるので、そのままでは使えません。

hasText が true のときだけ、safeCrop も判定する。
　画像の中に「文字を一切含まない矩形領域」があるかを見て、あれば座標を返す。
　条件：領域の幅・高さがそれぞれ画像の40%以上あること（小さすぎる領域は
　バナーの縦横どちらの比率でも使い物にならない）。文字が画像全体に散らばっていて
　そのような領域が取れないときは null を返す（無理に小さい領域を返さない）。
　座標は画像の左上を (0,0)、右下を (100,100) とする%で、x0<x1、y0<y1。
　hasText が false のときは safeCrop は常に null。

hasFace は、人物の顔がはっきり写っているか。
note は、その画像がバナーに向くか向かないかを15文字以内で。

判定は見えたままを答えること。推測で補わない。safeCrop も、実際に文字が
1文字もかかっていないと確信できる範囲だけを返すこと（少しでもかかる可能性が
あるなら小さく見積もるか null にする）。`,
      `画像は ${usable.length} 枚です。index は 0 から始まる画像の番号です。

出力: {"items":[{"index":0,"hasText":false,"hasFace":false,"safeCrop":null,"note":""}]}
safeCrop の例（文字が上部1/3にある場合）: {"x0":0,"y0":34,"x1":100,"y1":100}`,
      usable.map((x) => x.im),
      { maxTokens: 2000 }
    );
  } catch {
    return { items: [], checkedAt: new Date().toISOString() };
  }

  const items: ImageCheck[] = [];
  for (const r of res.items ?? []) {
    const src = usable[r.index];
    if (!src) continue;
    const c = r.safeCrop;
    // 壊れた座標（幅/高さが40%未満、範囲外、順序逆転）は使わない。判定ミスで
    // 文字入りのまま切り出されるより、除外側に倒すほうが安全
    const validCrop =
      !!c &&
      c.x0 >= 0 && c.y0 >= 0 && c.x1 <= 100 && c.y1 <= 100 &&
      c.x1 - c.x0 >= 40 && c.y1 - c.y0 >= 40;
    items.push({
      url: src.url,
      hasText: !!r.hasText,
      hasFace: !!r.hasFace,
      safeCrop: r.hasText && validCrop ? c : null,
      note: r.note ?? "",
    });
  }
  return { items, checkedAt: new Date().toISOString() };
}
