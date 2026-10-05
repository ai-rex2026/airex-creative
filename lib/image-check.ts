import { askJsonWithImages, hasAnthropic } from "./anthropic";

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
  /**
   * hasFace のとき、顔（複数あれば主役級の顔をまとめて含む範囲）のおおよその位置
   * （画像に対する 0〜100 の%座標）。バナーで画像の上にテキストを重ねる際、
   * この範囲を避けてテキストを置くために使う。hasFace が false のときは常に null
   */
  facePosition: SafeCrop | null;
  /** 一言。なぜ使えない／使えるのか */
  note: string;
};

export type ImageScan = {
  items: ImageCheck[];
  checkedAt: string;
  /**
   * 判定できなかった画像があったときの理由（取得できなかった・AIの判定が失敗した等）。
   * 全部判定できていれば無い。画面の「自動チェックが実行できませんでした」に添えて、要因を確認できるようにする
   */
  error?: string | null;
  /** 判定の対象にした枚数と、画像として取得できた枚数 */
  total?: number;
  fetched?: number;
};

// site-scan.ts の readImages() も 20 枚で打ち切っている。ここを合わせておかないと、
// 上限に収まらなかった画像が「文字チェックされないまま候補に残る」ことになる
const MAX = 20;
/** 1枚あたりの上限。大きすぎる画像は送らない（Claudeは1枚5MBまで） */
const MAX_BYTES = 3_500_000;
/**
 * 1回のAI呼び出しに載せる画像の合計（base64後の文字数）と枚数の上限。
 * 以前は最大20枚を1回の呼び出しにまとめて送っていて、画像が重いサイトでは合計が
 * AIの受け付けるサイズ（Geminiのインライン送信は約20MB、Claudeは約32MB）を超えて
 * 判定全体が失敗し、「自動チェックが実行できませんでした」になりうる作りだった。
 * 小さな塊に分け、1つが失敗しても他の塊の判定は残す
 */
const BATCH_MAX_CHARS = 8_000_000;
const BATCH_MAX_IMAGES = 6;

type Fetched = { ok: true; media: string; base64: string } | { ok: false; why: string };

/**
 * 画像を取得する。ホットリンク対策で Referer を見るサイトがあるため、
 * 画像の置き場（オリジン）を Referer に付けて送る。それでも失敗したら
 * Referer 無しでもう一度だけ試す（逆に Referer を嫌うサイトもあるため）。
 * 取れなかったときは、何が原因かを返す（呼び出し元が集計して画面に出す）
 */
async function fetchImage(url: string): Promise<Fetched> {
  const attempt = async (withReferer: boolean): Promise<Fetched> => {
    const headers: Record<string, string> = { "user-agent": "Mozilla/5.0", accept: "image/*" };
    if (withReferer) {
      try {
        headers.referer = new URL(url).origin + "/";
      } catch {
        // URL が壊れているなら referer 無しの試行に任せる
      }
    }
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
    const media = res.headers.get("content-type")?.split(";")[0] ?? "";
    if (!res.ok) return { ok: false, why: `HTTP ${res.status}` };
    // Claude が受け取れる形式だけ（jpeg / png / gif / webp）。svg・avif などは対象外
    if (!/^image\/(png|jpeg|gif|webp)$/.test(media)) return { ok: false, why: `未対応の形式（${media || "不明"}）` };
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) return { ok: false, why: "ファイルが大きすぎる" };
    return { ok: true, media, base64: Buffer.from(buf).toString("base64") };
  };
  const tryOnce = async (withReferer: boolean): Promise<Fetched> => {
    try {
      return await attempt(withReferer);
    } catch (e) {
      return { ok: false, why: e instanceof Error && e.name === "TimeoutError" ? "取得がタイムアウト" : "接続できない" };
    }
  };
  const first = await tryOnce(true);
  return first.ok ? first : tryOnce(false);
}

const SYSTEM = `あなたは広告バナーに使う写真を選ぶ人です。渡された画像を1枚ずつ見て、判定します。

hasText は、画像の中に**読める文字が焼き込まれているか**。
　ロゴの中の社名、キャッチコピー、価格表示、Before/After の文字なども文字に含める。
　文字があるとバナーで切り抜いたときに途中で切れるので、そのままでは使えません。

　見落としが起きやすいのは、画像の隅や端に小さく貼られた価格タグ・キャンペーンバッジ・
　割引シール・「◯◯円〜」のような料金表記です。写真の主役（人物・施術の様子・機材など）に
　注意が向きがちですが、必ず四隅と上下左右の端まで確認してください。小さく写っていても、
　拡大すれば読める文字であれば hasText は true です。読めるかどうか自信が持てない場合も、
　「文字なし」と断定せず true 側に倒してください（見逃して文字入りのままバナーに
　使われる方が、安全側に判定して候補から外れるより悪影響が大きいため）。

hasText が true のときだけ、safeCrop も判定する。
　画像の中に「文字を一切含まない矩形領域」があるかを見て、あれば座標を返す。
　条件：領域の幅・高さがそれぞれ画像の40%以上あること（小さすぎる領域は
　バナーの縦横どちらの比率でも使い物にならない）。文字が画像全体に散らばっていて
　そのような領域が取れないときは null を返す（無理に小さい領域を返さない）。
　座標は画像の左上を (0,0)、右下を (100,100) とする%で、x0<x1、y0<y1。
　hasText が false のときは safeCrop は常に null。

hasFace は、人物の顔がはっきり写っているか。

hasFace が true のときだけ、facePosition も判定する。
　写っている顔（複数人いる場合は、主役級の顔をすべて含む最小の範囲）のおおよその位置を、
　画像の左上を (0,0)、右下を (100,100) とする%の矩形で返す。バナーでこの画像の上に
　テキストを重ねるとき、顔にかからない位置を選ぶために使う。判定は緩めでよいが、
　実際の顔より狭く見積もって顔の一部が範囲外にはみ出すことは避けること（広めに見積もる）。
　hasFace が false のときは facePosition は常に null。

note は、その画像がバナーに向くか向かないかを15文字以内で。

判定は見えたままを答えること。推測で補わない。safeCrop も、実際に文字が
1文字もかかっていないと確信できる範囲だけを返すこと（少しでもかかる可能性が
あるなら小さく見積もるか null にする）。`;

/** 同じ理由をまとめて「HTTP 403 ×5」のように数える */
function tally(reasons: string[]): string {
  const m = new Map<string, number>();
  for (const r of reasons) m.set(r, (m.get(r) ?? 0) + 1);
  return [...m.entries()].map(([r, n]) => (n > 1 ? `${r} ×${n}` : r)).join("、");
}

/**
 * AIの返答を画像に対応付ける。軽いモデルは外枠や番号の付け方が揺れるので、
 * よくある揺れ（配列だけで返す・別の名前で包む・番号を文字列や1始まりで返す・番号を省く）を吸収する。
 * 対応付けられなかった画像は含めない（呼び出し側が再判定する）
 */
export function toItems(raw: unknown, batch: { url: string }[]): ImageCheck[] {
  let list: unknown = raw;
  if (list && typeof list === "object" && !Array.isArray(list)) {
    const o = list as Record<string, unknown>;
    list = Array.isArray(o.items) ? o.items : Object.values(o).find((v) => Array.isArray(v));
  }
  if (!Array.isArray(list)) return [];
  const rows = list.filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x));
  const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v) : NaN);
  const idx = rows.map((x) => num(x.index));
  const allHave = idx.every((n) => Number.isInteger(n));
  // 「画像 1」〜「画像 n」のように1始まりで振られた場合（0 が無く n がある）
  const oneBased = allHave && idx.length > 0 && !idx.includes(0) && idx.includes(batch.length);
  const bool = (v: unknown) => v === true || v === "true";
  const out: ImageCheck[] = [];
  const seen = new Set<string>();
  rows.forEach((it, pos) => {
    // 番号が付いていない返答は、件数が画像の枚数と一致するときだけ並び順で対応付ける
    const i = allHave ? idx[pos] - (oneBased ? 1 : 0) : rows.length === batch.length ? pos : -1;
    const src = batch[i];
    if (!src || seen.has(src.url)) return;
    seen.add(src.url);
    const hasText = bool(it.hasText);
    const hasFace = bool(it.hasFace);
    const c = it.safeCrop as SafeCrop | null | undefined;
    // 壊れた座標（幅/高さが40%未満、範囲外、順序逆転）は使わない。判定ミスで
    // 文字入りのまま切り出されるより、除外側に倒すほうが安全
    const validCrop =
      !!c &&
      c.x0 >= 0 && c.y0 >= 0 && c.x1 <= 100 && c.y1 <= 100 &&
      c.x1 - c.x0 >= 40 && c.y1 - c.y0 >= 40;
    const fp = it.facePosition as SafeCrop | null | undefined;
    // facePosition は「テキストを重ねてよい場所」を避けるためだけに使う。
    // safeCrop ほど厳密な最小サイズは要らないが、座標として壊れているものは捨てる
    // （はみ出した座標をそのまま使うと、避けたはずの位置に文字を置いてしまう）
    const validFace =
      !!fp && fp.x0 >= 0 && fp.y0 >= 0 && fp.x1 <= 100 && fp.y1 <= 100 && fp.x1 > fp.x0 && fp.y1 > fp.y0;
    out.push({
      url: src.url,
      hasText,
      hasFace,
      safeCrop: hasText && validCrop ? c! : null,
      facePosition: hasFace && validFace ? fp! : null,
      note: typeof it.note === "string" ? it.note : "",
    });
  });
  return out;
}

export async function checkImages(urls: string[]): Promise<ImageScan> {
  const list = urls.slice(0, MAX);
  const fetched = await Promise.all(list.map(async (u) => ({ url: u, im: await fetchImage(u) })));
  const usable = fetched.flatMap((x) => (x.im.ok ? [{ url: x.url, im: { media: x.im.media, base64: x.im.base64 } }] : []));
  const fetchFailures = fetched.flatMap((x) => (x.im.ok ? [] : [x.im.why]));
  const base = { total: list.length, fetched: usable.length };
  const fetchNote = fetchFailures.length > 0 ? `画像${list.length}枚のうち${fetchFailures.length}枚を取得できませんでした（${tally(fetchFailures)}）` : null;
  if (usable.length === 0) {
    return { items: [], checkedAt: new Date().toISOString(), error: fetchNote ?? "判定できる画像がありませんでした", ...base };
  }

  // 合計サイズと枚数で塊に分ける
  const batches: (typeof usable)[] = [];
  let cur: typeof usable = [];
  let curChars = 0;
  for (const u of usable) {
    if (cur.length > 0 && (cur.length >= BATCH_MAX_IMAGES || curChars + u.im.base64.length > BATCH_MAX_CHARS)) {
      batches.push(cur);
      cur = [];
      curChars = 0;
    }
    cur.push(u);
    curChars += u.im.base64.length;
  }
  if (cur.length > 0) batches.push(cur);

  const prompt = (n: number) => `画像は ${n} 枚です。index は 0 から始まる画像の番号です。

出力: {"items":[{"index":0,"hasText":false,"hasFace":false,"safeCrop":null,"facePosition":null,"note":""}]}
safeCrop の例（文字が上部1/3にある場合）: {"x0":0,"y0":34,"x1":100,"y1":100}
facePosition の例（顔が画面中央やや上にある場合）: {"x0":30,"y0":10,"x1":70,"y1":45}`;

  type Batch = (typeof usable)[number][];
  const ask = (batch: Batch, forceAnthropic: boolean) =>
    askJsonWithImages<unknown>(
      SYSTEM,
      prompt(batch.length),
      batch.map((x) => x.im),
      // 1枚ごとの判定が出力に占める量に合わせて上限を決める。項目数が多いと出力が
      // 途中で切れてJSONとして読めなくなることがあった
      { maxTokens: 900 + batch.length * 650, forceAnthropic }
    );

  /**
   * 1つの塊を判定する。返ってきた判定が1件も画像に対応付けられなかったとき
   * （出力の形が想定と違う等）は、エラー無しの「判定0件」として黙って保存しない。
   * 2026-10-02〜10-05 はこの経路で全レポートの判定が0件になり、文字入りの写真が
   * 上から順に候補に並んでいた。対応付けられなかった画像だけを Claude でもう一度見る
   */
  const judge = async (batch: Batch): Promise<{ items: ImageCheck[]; note: string | null }> => {
    let firstErr: unknown = null;
    const raw = await ask(batch, false).catch((e) => {
      firstErr = e;
      return null;
    });
    const first = raw === null ? [] : toItems(raw, batch);
    const missing = batch.filter((b) => !first.some((x) => x.url === b.url));
    if (missing.length === 0) return { items: first, note: null };
    if (!hasAnthropic()) {
      if (firstErr) throw firstErr;
      return { items: first, note: `${batch.length}枚中${missing.length}枚の判定結果を読み取れませんでした` };
    }
    try {
      const second = toItems(await ask(missing, true), missing);
      const left = missing.length - second.length;
      return {
        items: [...first, ...second],
        note: left > 0 ? `${batch.length}枚中${left}枚の判定結果を読み取れませんでした` : null,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        items: first,
        note: `${batch.length}枚中${missing.length}枚の判定結果を読み取れませんでした（再判定も失敗：${msg.replace(/\s+/g, " ").slice(0, 80)}）`,
      };
    }
  };

  const results = await Promise.allSettled(batches.map((batch) => judge(batch)));

  const items: ImageCheck[] = [];
  const aiFailures: string[] = [];
  results.forEach((r) => {
    if (r.status === "rejected") {
      const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
      aiFailures.push(msg.replace(/\s+/g, " ").slice(0, 120));
      return;
    }
    items.push(...r.value.items);
    if (r.value.note) aiFailures.push(r.value.note);
  });

  const notes = [
    fetchNote,
    aiFailures.length > 0 ? `AIによる判定で一部うまくいきませんでした（${[...new Set(aiFailures)].join(" / ")}）` : null,
  ].filter((x): x is string => !!x);
  return { items, checkedAt: new Date().toISOString(), error: notes.length > 0 ? notes.join("。") : null, ...base };
}
