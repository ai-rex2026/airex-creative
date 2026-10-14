import type { SupabaseClient } from "@supabase/supabase-js";
import { askJson } from "../anthropic";
import { ask } from "./ai-search";
import { jstPeriodKey } from "./daily";
import { normalizeJapanese } from "./japanese";
import type { MeoStoreSnapshot } from "./types";

/**
 * 情報の一貫性チェック（サイテーション）。
 * 公式サイト・Googleビジネスプロフィール・食べログ・ホットペッパー・エキテン・SNS など、
 * あらゆる場所に「同じ・最新の」店名／住所／電話／営業時間が載っていると評価が安定する（2026-10-13 ミーティング）。
 * 基準は Google（Places）の情報。web 検索つきの AI で各媒体の掲載を集め、ずれを一覧にする。
 * 直すのは人（各媒体の管理画面）。ここは「どこが・何が・どうずれているか」を出すところまで。
 */

export const CITATION_MONTHLY_LIMIT = 3;

export type CitationSource = {
  name: string;
  url: string;
  address: string | null;
  phone: string | null;
  hours: string | null;
  /** match: 一致 / mismatch: ずれあり / partial: 一部しか載っていない / missing: 見つからず */
  status: "match" | "mismatch" | "partial" | "missing";
  issues: string[];
};

export type CitationCheck = {
  id: string;
  status: "completed" | "failed";
  reference: { name: string; address: string | null; phone: string | null; website: string | null };
  sources: CitationSource[];
  summary: string;
  engine: string;
  errorMessage: string | null;
  createdAt: string;
};

export function rowToCitation(r: Record<string, unknown>): CitationCheck {
  const b = (r.result as Record<string, unknown>) ?? {};
  return {
    id: String(r.id),
    status: r.status === "failed" ? "failed" : "completed",
    reference: (b.reference as CitationCheck["reference"]) ?? { name: "", address: null, phone: null, website: null },
    sources: Array.isArray(b.sources) ? (b.sources as CitationSource[]) : [],
    summary: String(b.summary ?? ""),
    engine: String(r.engine ?? ""),
    errorMessage: (r.error_message as string | null) ?? null,
    createdAt: String(r.created_at),
  };
}

export async function citationQuota(sb: SupabaseClient, storeId: string) {
  const period = jstPeriodKey();
  const { count } = await sb.from("meo_citation_checks").select("id", { count: "exact", head: true }).eq("store_id", storeId).eq("period", period);
  return { period, limit: CITATION_MONTHLY_LIMIT, remaining: Math.max(0, CITATION_MONTHLY_LIMIT - (count ?? 0)) };
}

/** 公式サイトから住所・電話・営業時間らしき文を拾う（取れなければ空） */
async function fetchOfficialFacts(url: string | null): Promise<string> {
  try {
    if (!url) return "";
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return "";
    const res = await fetch(u.toString(), { signal: AbortSignal.timeout(8_000), redirect: "follow", headers: { "user-agent": "Mozilla/5.0 (compatible; AirexBot/1.0)" } });
    if (!res.ok) return "";
    const html = (await res.text()).slice(0, 400_000);
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ");
    const hits: string[] = [];
    for (const m of text.matchAll(/.{0,40}(営業時間|定休日|住所|所在地|電話|TEL|Tel|〒\d{3}-?\d{4}|0\d{1,4}-\d{1,4}-\d{3,4}).{0,80}/g)) {
      hits.push(m[0].trim());
      if (hits.length >= 12) break;
    }
    return hits.join(" / ").slice(0, 1500);
  } catch {
    return "";
  }
}

const COMPARE_SYSTEM = `あなたは店舗情報の照合担当です。基準（Googleビジネスプロフィールの情報）と、各媒体に載っている情報を比べて、ずれを一覧にします。

- sources は見つかった媒体ごとに1件。公式サイトも1件として入れる
- address は番地・建物名まで含めて比べる。表記ゆれ（全角/半角、ハイフン、「丁目」と「-」、ビル名の有無）は "partial" ではなく、実質同じなら "match" とし issues に「表記が違う（内容は同じ）」と書く
- phone はハイフンの有無を無視して比べる
- hours は基準側に無いことが多いので、媒体間で食い違っていれば issues に書き、status は address/phone で決める
- 見つからなかった主要媒体（食べログ・ホットペッパー・エキテン・Yahoo!ロコ・Instagram など、その業種で一般的なもの）は status "missing" で url 空のまま入れる
- 与えられた情報に無いことを推測で書かない。確認できなかった項目は null
- 日本語の文章で通常使う漢字だけで書く

出力: {"summary":"所見（150字以内）","sources":[{"name":"媒体名","url":"","address":null,"phone":null,"hours":null,"status":"match|mismatch|partial|missing","issues":["何がどうずれているか"]}]}`;

export async function runCitationCheck(store: MeoStoreSnapshot, storeName: string): Promise<Omit<CitationCheck, "id" | "createdAt" | "status" | "errorMessage">> {
  const reference = { name: storeName, address: store.address, phone: store.phoneNumber, website: store.websiteUrl };
  const deadline = Date.now() + 200_000;
  const question = `「${storeName}」（${store.address ?? ""}）という店舗の掲載情報を探しています。
公式サイト・Googleマップ以外の媒体（食べログ、ホットペッパー、エキテン、Yahoo!ロコ、Retty、Instagram、Facebook、その他の業種ポータル）で、この店舗のページを見つけ、
各ページに書かれている「店名・住所・電話番号・営業時間・定休日」を、ページの URL とともにそのまま書き出してください。見つからない媒体は「見つからず」と書いてください。`;
  const [answer, official] = await Promise.all([ask(question, deadline), fetchOfficialFacts(store.websiteUrl)]);
  const lines = [
    "# 基準（Googleビジネスプロフィール）",
    `店名: ${storeName}`,
    `住所: ${store.address ?? "（不明）"}`,
    `電話: ${store.phoneNumber ?? "（不明）"}`,
    `公式サイト: ${store.websiteUrl ?? "（不明）"}`,
    "",
    "# 公式サイトから拾った文",
    official || "（取得できず）",
    "",
    "# web検索つき AI が集めた各媒体の掲載",
    answer.text.slice(0, 12_000),
    "",
    "# 参照URL",
    ...answer.cited.slice(0, 20).map((c) => `- ${c.title} ${c.url}`),
  ];
  const res = await askJson<{ summary?: string; sources?: Record<string, unknown>[] }>(COMPARE_SYSTEM, lines.join("\n"), { maxTokens: 3000, timeoutMs: 90_000 });
  const str = (v: unknown, n: number) => (v == null || v === "" ? null : normalizeJapanese(String(v)).slice(0, n));
  const sources: CitationSource[] = (res.sources ?? [])
    .slice(0, 16)
    .map((s) => ({
      name: str(s.name, 60) ?? "",
      url: String(s.url ?? "").slice(0, 500),
      address: str(s.address, 200),
      phone: str(s.phone, 40),
      hours: str(s.hours, 200),
      status: (["match", "mismatch", "partial", "missing"].includes(String(s.status)) ? String(s.status) : "partial") as CitationSource["status"],
      issues: (Array.isArray(s.issues) ? s.issues : []).map((i) => normalizeJapanese(String(i)).slice(0, 160)).filter(Boolean).slice(0, 5),
    }))
    .filter((s) => s.name);
  return { reference, sources, summary: normalizeJapanese(String(res.summary ?? "")).slice(0, 300), engine: answer.engine };
}
