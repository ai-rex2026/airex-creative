import { askJson } from "./anthropic";
import { checkGuard } from "./guardrail";
import type { BannerCopy, Diagnosis } from "./types";

/**
 * 訴求軸ごとにバナーコピーを起こし、その場で法令チェックと勝ち筋スコアを付ける。
 * 「作ってから審査」ではなく「作ると同時に守る」——ロードマップの中心的な要求。
 */
export async function generateCopies(d: Diagnosis, perAngle = 2): Promise<BannerCopy[]> {
  const copies = await askJson<{ copies: BannerCopy[] }>(
    `あなたは日本の広告コピーライターです。指定の訴求軸ごとにバナー用のコピーを書きます。
制約:
- headline は2行の配列。1行目＋2行目で1つの言い切りになるようにし、各行は全角12文字以内
- ribbonTop は条件・限定（全角14文字以内）、ribbonBottom は一番強い一言（全角10文字以内）
- body は2文以内・全角70文字以内
- cta は全角10文字以内の行動喚起
- 根拠のない数値・最上級・効果の断定は使わない（後段で法令チェックに落ちるため）
- 使用禁止語: ${d.brand.ngWords.join("、") || "なし"}`,
    `商材: ${d.product}
ターゲット: ${d.audience}
強み: ${d.strengths.join(" / ")}
買わない理由: ${d.objections.join(" / ")}
訴求軸:
${d.angles.map((a) => `- ${a.id}: ${a.name}（${a.why}）`).join("\n")}

各訴求軸につき ${perAngle} 本ずつ書いてください。
出力: {"copies":[{"angleId":"a1","headline":["",""],"subhead":"","ribbonTop":"","ribbonBottom":"","body":"","cta":""}]}`,
    { maxTokens: 6000 }
  );

  const list = copies.copies ?? [];
  // 法令チェックとスコアは本数ぶん並列で回す
  const scored = await Promise.all(
    list.map(async (c) => {
      const texts = [c.headline.join(""), c.subhead, c.ribbonTop, c.ribbonBottom, c.body, c.cta]
        .filter(Boolean) as string[];
      const guard = await checkGuard(texts, d.industry);
      return { ...c, guard };
    })
  );
  return scored;
}

/**
 * 勝ち筋スコア（ロードマップ #02 の最小版）。
 * 配信前に「どれを出すか」を絞るための相対順位づけで、CTRの実測予測ではない。
 * 実データが溜まったら学習側に差し替える前提で、根拠を必ず文章で返す。
 */
export async function scoreCopies(d: Diagnosis, copies: BannerCopy[]): Promise<BannerCopy[]> {
  if (copies.length === 0) return copies;
  const res = await askJson<{ scores: { index: number; score: number; reason: string }[] }>(
    `あなたは広告クリエイティブの審査者です。各案に0-100の「勝ち筋スコア」を付けます。
判断材料: ①ターゲットの悩みに触れているか ②具体か（抽象語だけでないか）
③1秒で意味が取れるか ④他案と差別化できているか ⑤買わない理由を潰しているか。
100点や0点は付けず、案どうしの差が分かるように散らすこと。理由は日本語1文。`,
    `商材: ${d.product} / ターゲット: ${d.audience}
買わない理由: ${d.objections.join(" / ")}

案:
${copies.map((c, i) => `${i}: ${c.headline.join("")}／${c.ribbonBottom ?? ""}／${c.body}`).join("\n")}

出力: {"scores":[{"index":0,"score":72,"reason":""}]}`,
    { maxTokens: 2000 }
  );
  const map = new Map(res.scores?.map((s) => [s.index, s]) ?? []);
  return copies.map((c, i) => ({ ...c, score: map.get(i)?.score, scoreReason: map.get(i)?.reason }));
}
