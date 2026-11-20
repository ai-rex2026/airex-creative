import type { GuardHit, Industry } from "../types";

/**
 * 記事の法令チェックのうち、AI の指示ではなくコードで確実に守るもの（2026-11-20。承認済みノウハウのコード化）。
 *  - 医療・歯科の記事：体験談・他院との比較は書かない／自由診療は費用と主なリスクを併記する（医療広告ガイドライン）
 *  - 広告・PR の表示：「広告」と書きつつ文中で「第三者としての感想」と書くような、混ぜた書き方をしない（ステマ運用基準）
 *  - 他社比較：調査の出典（調査機関・時点）が本文に無い比較は止める（景表法・比較広告の3要件のうち、コードで見られる部分）
 * AI は呼ばない。語が出たら high（出せない）、書くべき併記が無いものは medium（要判断）にする。
 * 欠点をあげつらう書き方・グレードの違うものを同等に比べる書き方は文脈の判断なので、AI への指示（承認済みの文）に残す。
 */

const hit = (text: string, reason: string, law: string, suggestion: string, severity: GuardHit["severity"]): GuardHit => ({ text, reason, law, suggestion, severity });

const TESTIMONIAL = /体験談|患者(?:様|さん)?の声|お客様の声|口コミ(?:では|によると|より)|実際に(?:受けた|通った)(?:方|患者)/g;
const VS_OTHERS = /他院(?:と|より|に)(?:比べ|比較|違い|優れ)|他のクリニックより|他の(?:歯科|病院)(?:と|より)(?:比べ|違い|優れ)|当院(?:が|は)(?:一番|最も|どこよりも)/g;
const MIXED_PR = /第三者(?:として|の立場)|中立(?:的)?な立場|忖度(?:なし|せず)|(?:提供|報酬|依頼)を受けて(?:いません|おりません|いない)|PR(?:では|ではなく)(?:ありません|ない)/g;
const PR_MARK = /(?:^|[\s【\[（(])(?:PR|広告|アフィリエイト)(?:[\s】\]）):：]|$)|広告を含み|提供を受け/;

/** 比較する記事か（表・ランキング・「比較」の見出し） */
const IS_COMPARISON = /比較表|ランキング|おすすめ順|徹底比較|を比較|比較してみ/;
const HAS_WHEN = /20\d{2}年\d{1,2}月|時点|現在|調べ|調査/;
const HAS_SOURCE = /出典|参照|公式サイト|https?:\/\/|調査(?:機関|会社)|調べ（|公式ページ/;

export function articleRuleHits(parts: string[], industry: Industry): GuardHit[] {
  const text = parts.join("\n");
  const hits: GuardHit[] = [];

  if (industry === "medical") {
    for (const m of text.matchAll(TESTIMONIAL)) {
      hits.push(hit(m[0], "医療・歯科の広告に当たる記事では、体験談は書けない", "医療広告ガイドライン", "体験談・口コミの引用を外し、治療内容・費用・リスクの事実だけにする", "high"));
    }
    for (const m of text.matchAll(VS_OTHERS)) {
      hits.push(hit(m[0], "他院との比較（優良性を示す比較）は書けない", "医療広告ガイドライン", "他院との比較を外し、自院で行う治療の内容を事実で書く", "high"));
    }
    if (/自由診療/.test(text)) {
      const hasCost = /費用|円|料金|税込/.test(text);
      const hasRisk = /リスク|副作用|合併症|デメリット/.test(text);
      if (!hasCost || !hasRisk) {
        hits.push(hit("自由診療", `自由診療を書くときは、費用と主なリスクを併記する（${!hasCost ? "費用" : ""}${!hasCost && !hasRisk ? "・" : ""}${!hasRisk ? "リスク・副作用" : ""}が本文に無い）`, "医療広告ガイドライン", "標準的な費用（税込）と、主なリスク・副作用を同じ記事に書く", "medium"));
      }
    }
  }

  // 広告・PR の表示と、「第三者としての感想」などを混ぜない（全業種）
  if (PR_MARK.test(text)) {
    for (const m of text.matchAll(MIXED_PR)) {
      hits.push(hit(m[0], "広告・PR の表示と、第三者の感想のような書き方を混ぜると、広告であることが分かりにくくなる", "景表法（ステマ規制）運用基準", "広告・PR であることを冒頭に書き、文中では第三者・中立を名乗る書き方をしない", "high"));
    }
  }

  // 他社比較：調査の出典と時点が本文に無いものは止める
  if (IS_COMPARISON.test(text) && (!HAS_WHEN.test(text) || !HAS_SOURCE.test(text))) {
    hits.push(hit("比較", `他社と比べる記事には、調べた時点と出典（調査機関・公式サイトなど）を示す（${!HAS_WHEN.test(text) ? "時点" : ""}${!HAS_WHEN.test(text) && !HAS_SOURCE.test(text) ? "・" : ""}${!HAS_SOURCE.test(text) ? "出典" : ""}が本文に無い）`, "景表法（比較広告）", "「2026年11月時点・各社公式サイトより」のように、時点と出典を本文に書く", "medium"));
  }

  return hits;
}
