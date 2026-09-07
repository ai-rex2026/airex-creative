import { adWidth } from "./ad-ops";
import { checkGuard } from "./guardrail";
import type { Analysis } from "./analysis";
import type { GuardHit } from "./types";

/**
 * チャットからレポートを書き換える。
 *
 * 触れるのは**文言だけ**。実測値（サイトスキャン・MEO・Search Console・
 * サジェスト）は対象に含めない。ここを書き換えられるようにすると
 * 「計測していないことを断定しない」という前提が崩れる。
 *
 * 書き換えた文言は必ずガードレールに通し直す。通さないと、検査済みの原稿に
 * 未検査の文言が混ざった状態になる。
 */

export type Editable = {
  /** チャットが指定するID。人にもAIにも短く扱える形にする */
  id: string;
  label: string;
  text: string;
  /** 全角換算の上限。無い場合は null */
  limit: number | null;
};

/** 書き換えられる文言を全部集める。ここに無いものは書き換えられない */
export function editables(a: Analysis): Editable[] {
  const out: Editable[] = [];

  (a.copies ?? []).forEach((c, i) => {
    out.push({ id: `C${i + 1}-1`, label: `コピー${i + 1} 見出し1行目`, text: c.headline[0] ?? "", limit: null });
    out.push({ id: `C${i + 1}-2`, label: `コピー${i + 1} 見出し2行目`, text: c.headline[1] ?? "", limit: null });
    if (c.subhead) out.push({ id: `C${i + 1}-S`, label: `コピー${i + 1} サブ見出し`, text: c.subhead, limit: null });
    if (c.body) out.push({ id: `C${i + 1}-B`, label: `コピー${i + 1} 本文`, text: c.body, limit: null });
  });

  (a.ad_ops?.campaigns ?? []).forEach((cp, ci) =>
    (cp.groups ?? []).forEach((g, gi) => {
      (g.headlines ?? []).forEach((t, k) =>
        out.push({ id: `A${ci + 1}-${gi + 1}-H${k + 1}`, label: `${cp.channel} ${g.name} 見出し${k + 1}`, text: t, limit: 30 })
      );
      (g.descriptions ?? []).forEach((t, k) =>
        out.push({ id: `A${ci + 1}-${gi + 1}-D${k + 1}`, label: `${cp.channel} ${g.name} 説明文${k + 1}`, text: t, limit: 90 })
      );
    })
  );

  return out;
}

export type EditResult =
  | { ok: true; id: string; label: string; before: string; after: string }
  | { ok: false; id: string; reason: string };

type Patch = { copies?: Analysis["copies"]; ad_ops?: Analysis["ad_ops"] };

/**
 * 1件書き換える。書き換えた結果を返すが、保存はしない（呼び出し側でまとめて保存する）。
 * 上限超過とガードレール high はどちらも差し替えない。直った体で通すほうが害が大きい。
 */
export async function applyEdit(a: Analysis, id: string, text: string): Promise<{ result: EditResult; patch: Patch }> {
  const item = editables(a).find((x) => x.id === id);
  if (!item) return { result: { ok: false, id, reason: "その番号の原稿は見つかりませんでした" }, patch: {} };

  const next = text.trim();
  if (!next) return { result: { ok: false, id, reason: "空にはできません" }, patch: {} };
  if (next === item.text) return { result: { ok: false, id, reason: "元の文言と同じです" }, patch: {} };

  if (item.limit !== null) {
    const w = adWidth(next);
    if (w > item.limit) {
      return {
        result: { ok: false, id, reason: `文字数が上限を超えています（${Math.ceil(w / 2)}文字／上限${item.limit / 2}文字）` },
        patch: {},
      };
    }
  }

  // 書き換えた文言は必ず検査し直す。high は出せないので差し替えない
  const industry = a.diagnosis?.industry ?? "general";
  const verdict = await checkGuard([next], industry);
  const high = verdict.hits.filter((h) => h.severity === "high");
  if (high.length > 0) {
    const h = high[0];
    return {
      result: { ok: false, id, reason: `${h.law}に触れる表現です（「${h.text}」）。${h.suggestion}` },
      patch: {},
    };
  }

  const patch: Patch = {};

  const cm = id.match(/^C(\d+)-(1|2|S|B)$/);
  if (cm) {
    const copies = structuredClone(a.copies ?? []);
    const c = copies[Number(cm[1]) - 1];
    if (!c) return { result: { ok: false, id, reason: "その番号の原稿は見つかりませんでした" }, patch: {} };
    if (cm[2] === "1") c.headline[0] = next;
    else if (cm[2] === "2") c.headline[1] = next;
    else if (cm[2] === "S") c.subhead = next;
    else c.body = next;
    // そのコピー全体で判定し直す。1行だけ直しても他の行が赤なら赤のまま
    c.guard = await checkGuard([c.headline.join(" "), c.subhead ?? "", c.body ?? ""].filter(Boolean), industry);
    patch.copies = copies;
  }

  const am = id.match(/^A(\d+)-(\d+)-([HD])(\d+)$/);
  if (am) {
    const ops = structuredClone(a.ad_ops);
    if (!ops) return { result: { ok: false, id, reason: "広告運用設計がありません" }, patch: {} };
    const g = ops.campaigns[Number(am[1]) - 1]?.groups?.[Number(am[2]) - 1];
    if (!g) return { result: { ok: false, id, reason: "その番号の原稿は見つかりませんでした" }, patch: {} };
    const arr = am[3] === "H" ? g.headlines : g.descriptions;
    arr[Number(am[4]) - 1] = next;

    // 全体の指摘と超過リストを作り直す。1件直したら他の件数も変わる
    const texts = ops.campaigns.flatMap((c) => (c.groups ?? []).flatMap((x) => [...(x.headlines ?? []), ...(x.descriptions ?? [])]));
    ops.guard = await checkGuard(texts, industry);
    ops.overLength = ops.overLength.filter((o) => o.text !== item.text);
    ops.flagged = [];
    for (const t of new Set(texts)) {
      for (const h of ops.guard.hits) {
        if (h.severity !== "low" && t.includes(h.text)) {
          ops.flagged.push({ text: t, law: h.law, reason: h.reason, suggestion: h.suggestion });
          break;
        }
      }
    }
    patch.ad_ops = ops;
  }

  return { result: { ok: true, id, label: item.label, before: item.text, after: next }, patch };
}

/** 書き換えたあとに残る指摘。画面の注記に使う */
export function remainingHits(a: Analysis): GuardHit[] {
  return a.ad_ops?.guard?.hits ?? [];
}
