import { askJson } from "./anthropic";
import { checkGuard } from "./guardrail";
import type { Diagnosis, GuardHit, Industry } from "./types";
import type { SocialAccount, SocialScan } from "./social";
import type { SocialCompetitorScan } from "./social-competitors";

/**
 * YouTube・Xの「分析結果」と「施策詳細」。
 *
 * アカウント情報（登録者数・直近の投稿内容など）が実測できている媒体についてだけ作る。
 * 実測が無いのに書くと、取れていない数字を前提にした一般論になってしまうため
 * （このリポジトリ全体の「取れなかったことを取れなかったと書く」原則と同じ）。
 *
 * 「広告以外の施策（tactics.ts）」は媒体をまたいだ4〜6件の大づかみな施策だが、
 * こちらは実測できている媒体1つずつについて、自社の実際の投稿内容と競合の実測値を
 * 突き合わせた「分析結果」と、そこから導く「施策詳細」（手順・担当・完了条件つき）を出す。
 */

export type SocialInsightMeasure = {
  title: string;
  /** なぜその施策が効くと考えたか。実測値を引用して書かせる */
  why: string;
  steps: string[];
  owner: string;
  effort: "すぐ" | "数日" | "数週間";
  /** 見る数字。1つ */
  kpi: string;
  flags?: { text: string; law: string; reason: string; suggestion: string }[];
};

export type SocialInsight = {
  platform: "YouTube" | "X";
  /** 自社の実測値と競合の実測値を突き合わせて分かったこと */
  findings: string[];
  measures: SocialInsightMeasure[];
};

export type SocialInsightPlan = { items: SocialInsight[] };

const PLATFORM_RE: Record<"YouTube" | "X", RegExp> = {
  YouTube: /youtube/i,
  X: /twitter|^x$/i,
};

/** 実測できている（readable）自社アカウントだけを対象にする */
function ownAccountsByPlatform(social: SocialScan | null): Partial<Record<"YouTube" | "X", SocialAccount>> {
  const out: Partial<Record<"YouTube" | "X", SocialAccount>> = {};
  for (const p of ["YouTube", "X"] as const) {
    const a = (social?.accounts ?? []).find((x) => PLATFORM_RE[p].test(x.platform) && x.readable);
    if (a) out[p] = a;
  }
  return out;
}

function accountFacts(a: SocialAccount, label: string): string {
  const lines = [
    `${label}：@${a.handle || a.url}`,
    a.followers !== null ? `フォロワー（登録者）数 ${a.followers.toLocaleString()}人` : "フォロワー（登録者）数は取得できず",
    a.posts !== null ? `投稿（動画）数 ${a.posts.toLocaleString()}件` : "",
    a.views !== null ? `総再生回数 ${a.views.toLocaleString()}回` : "",
    a.bio ? `プロフィール：${a.bio}` : "",
    a.recentContent?.length ? `直近の投稿内容：${a.recentContent.join(" / ")}` : "直近の投稿内容は取得できず",
  ].filter(Boolean);
  return lines.join("\n  ");
}

async function flag(items: SocialInsightMeasure[], industry: Industry): Promise<SocialInsightMeasure[]> {
  const texts = items.flatMap((m) => [m.title, m.why, ...(m.steps ?? [])]);
  if (texts.length === 0) return items;
  let hits: GuardHit[] = [];
  try {
    hits = (await checkGuard(texts, industry)).hits.filter((h) => h.severity !== "low");
  } catch {
    return items; // 検査できなくても施策は返す
  }
  return items.map((m) => {
    const own = hits.filter((h) => [m.title, m.why, ...(m.steps ?? [])].some((t) => t?.includes(h.text)));
    return own.length
      ? { ...m, flags: own.map((h) => ({ text: h.text, law: h.law, reason: h.reason, suggestion: h.suggestion })) }
      : m;
  });
}

export async function generateSocialInsights(
  d: Diagnosis,
  social: SocialScan | null,
  competitors: SocialCompetitorScan | null
): Promise<SocialInsightPlan> {
  const own = ownAccountsByPlatform(social);
  const targets = (["YouTube", "X"] as const).filter((p) => own[p]);
  if (targets.length === 0) return { items: [] };

  const blocks = targets.map((p) => {
    const a = own[p]!;
    const comp = (competitors?.items ?? []).filter((c) => c.platform === p);
    const compBlock = comp.length
      ? comp.map((c, i) => accountFacts(c.account, `競合${i + 1}（${p}）`)).join("\n  ")
      : "競合アカウントは見つからなかった、または実測できなかった";
    return `【${p}】
  ${accountFacts(a, `自社（${p}）`)}
  ${compBlock}`;
  });

  const res = await askJson<SocialInsightPlan>(
    `あなたはSNS運用の実務者です。実測できているYouTube・Xのアカウントについて、
「分析結果（findings）」と、そこから導く「施策詳細（measures）」を媒体ごとに作ります。

守ること:
- 対象媒体は ${targets.join("・")} のみ。実測が無い媒体は出さない
- findings は媒体ごとに2〜4件。**渡された実測値（フォロワー数・投稿数・直近の投稿内容）を
  引用して**書く。競合が実測できていれば自社との比較で書き、競合が無ければ自社の実測値と
  投稿内容から分かることだけを書く
  ・渡されていない数字を作らない（「エンゲージメント率が高い」のような、渡していない指標の断定は禁止）
  ・一般論（「動画は伸びやすい」等）や最上級・断定（「必ず」「業界随一」）は禁止
- measures は媒体ごとに2〜3件。**すでに運用している前提**で書く（新規開設は書かない）
  ・title は「何をするか」を動詞で。「〜の検討」「〜の強化」のような、やったか判断できない書き方は禁止
  ・why は findings の裏付けとなる実測値を引用して書く
  ・steps は3〜4手順。誰がどこで何をするか
  ・owner は実在する役割（「SNS運用担当」「店舗責任者」など）
  ・effort は すぐ / 数日 / 数週間 のいずれか
  ・kpi は1つ。数えられるものにする（例：登録者数、動画の平均再生数、投稿へのリプライ数）
  ・効果や結果を断定しない。「必ず」「保証」は使わない`,
    `商材: ${d.product}
ターゲット: ${d.audience}
業種: ${d.industry}

【実測データ】
${blocks.join("\n\n")}

出力:
{"items":[{"platform":"YouTube","findings":["",""],
 "measures":[{"title":"","why":"","steps":["",""],"owner":"","effort":"すぐ","kpi":""}]}]}`,
    { maxTokens: 4000 }
  );

  const items = await Promise.all(
    (res.items ?? []).map(async (it) => ({ ...it, measures: await flag(it.measures ?? [], d.industry) }))
  );
  return { items };
}
