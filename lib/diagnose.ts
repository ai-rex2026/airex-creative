import { askJson } from "./anthropic";
import { fetchPageText } from "./fetch-page";
import type { Diagnosis } from "./types";

/**
 * 入口の診断。URL（またはテキスト）から、以降の生成がすべて参照する土台を作る。
 * 既存 AI-REX の分析APIは受け取れない前提なので、ここは自前で持つ。
 */
export async function diagnose(input: { url?: string; text?: string }): Promise<Diagnosis> {
  let title = "";
  let source = input.text?.trim() ?? "";
  if (input.url) {
    const page = await fetchPageText(input.url);
    title = page.title;
    source = `【ページタイトル】${page.title}\n【本文】${page.text}\n${source}`;
  }
  if (!source) throw new Error("URL か 商品説明のどちらかを入れてください");

  const d = await askJson<Omit<Diagnosis, "url" | "title">>(
    `あなたは広告運用のプロです。ランディングページの内容から、広告クリエイティブを作るための土台を作ります。
- angles（訴求軸）は5本。それぞれ切り口が重ならないようにする
- industry は beauty / medical / supplement / finance / general から選ぶ（規制の強さで後段の表現チェックが変わる）
- brand.accent は そのブランドに合う16進カラー1色
- objections は「買わない理由」。ここを潰すコピーが一番効く`,
    `${source}

出力:
{"product":"","audience":"","industry":"general","strengths":[""],"objections":[""],
 "angles":[{"id":"a1","name":"","why":""}],
 "brand":{"name":"","kana":"","tone":"","accent":"#f0b429","ngWords":[]}}`,
    { maxTokens: 3000 }
  );
  return { url: input.url ?? "", title, ...d };
}
