/**
 * レポート1本の中で、どのAI（Claude / Gemini）を使うかと、使った量の記録。
 *
 * 各章の生成関数は askJson を呼ぶだけで、どのAIかを知らない。
 * tick() が工程の実行をこの文脈で包むことで、分析ごとに使うAIを切り替え、使った量を集計する。
 */

export type AiProvider = "anthropic" | "gemini";

export type AiCall = {
  model: string;
  input_tokens: number;
  output_tokens: number;
  /** Gemini の思考トークン（出力と同じ単価で課金される） */
  thinking_tokens?: number;
  /** Web検索（Claude）/ Google検索連携（Gemini）の回数 */
  searches?: number;
};

export type AiUsageTotal = {
  provider: AiProvider;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  thinking_tokens: number;
  searches: number;
  /** 料金表からの計算値（USD） */
  cost_usd: number;
  by_model: Record<string, { calls: number; input_tokens: number; output_tokens: number; thinking_tokens: number }>;
};

type Ctx = { provider: AiProvider; calls: AiCall[] };

type Als<T> = { getStore(): T | undefined; run<R>(store: T, fn: () => R): R };

/**
 * AsyncLocalStorage はサーバー（Node）でだけ使う。このファイルは画面側の部品からも
 * 間接的に読み込まれるため、node: モジュールを静的に import するとクライアントのビルドが落ちる。
 * 実行時に取り出し、無い環境（ブラウザ）では何もしない入れ物にする。
 */
function makeStore(): Als<Ctx> {
  const g = globalThis as unknown as {
    AsyncLocalStorage?: new () => Als<Ctx>;
    process?: { getBuiltinModule?: (id: string) => { AsyncLocalStorage?: new () => Als<Ctx> } | undefined };
  };
  const Ctor = g.process?.getBuiltinModule?.("node:async_hooks")?.AsyncLocalStorage ?? g.AsyncLocalStorage;
  if (Ctor) return new Ctor();
  return { getStore: () => undefined, run: (_s, fn) => fn() };
}

const store = makeStore();

export function currentProvider(): AiProvider {
  return store.getStore()?.provider ?? "anthropic";
}

export function recordAiCall(c: AiCall) {
  store.getStore()?.calls.push(c);
}

/** fn の中で呼ばれた AI を provider に切り替え、使った量を返す */
export async function withAi<T>(provider: AiProvider, fn: () => Promise<T>): Promise<{ result: T; calls: AiCall[] }> {
  const ctx: Ctx = { provider, calls: [] };
  const result = await store.run(ctx, fn);
  return { result, calls: ctx.calls };
}

// 100万トークンあたりの単価（USD）。料金改定時はここを直す
const PRICES: { match: RegExp; input: number; output: number }[] = [
  { match: /claude-sonnet/, input: 3, output: 15 },
  { match: /claude-haiku/, input: 1, output: 5 },
  { match: /claude-opus/, input: 5, output: 25 },
  { match: /gemini-3\.1-flash-lite/, input: 0.25, output: 1.5 },
  { match: /gemini-3\.5-flash-lite/, input: 0.3, output: 2.5 },
  { match: /gemini-3\.[678]-flash/, input: 0.75, output: 3.75 },
  { match: /gemini-3\.5-flash/, input: 1.5, output: 9 },
  { match: /gemini-3\.1-pro/, input: 2, output: 12 },
];

function callCost(c: AiCall) {
  const p = PRICES.find((x) => x.match.test(c.model));
  const tokens = p ? (c.input_tokens * p.input + (c.output_tokens + (c.thinking_tokens ?? 0)) * p.output) / 1_000_000 : 0;
  // Claude の Web検索は1回0.01ドル。Gemini の検索連携は月5,000回まで無料なので0で数える
  const search = /^claude/.test(c.model) ? (c.searches ?? 0) * 0.01 : 0;
  return tokens + search;
}

export function addUsage(prev: AiUsageTotal | null, provider: AiProvider, calls: AiCall[]): AiUsageTotal {
  const t: AiUsageTotal = prev
    ? { ...prev, by_model: { ...prev.by_model } }
    : { provider, calls: 0, input_tokens: 0, output_tokens: 0, thinking_tokens: 0, searches: 0, cost_usd: 0, by_model: {} };
  for (const c of calls) {
    t.calls += 1;
    t.input_tokens += c.input_tokens;
    t.output_tokens += c.output_tokens;
    t.thinking_tokens += c.thinking_tokens ?? 0;
    t.searches += c.searches ?? 0;
    t.cost_usd = Math.round((t.cost_usd + callCost(c)) * 10000) / 10000;
    const m = t.by_model[c.model] ?? { calls: 0, input_tokens: 0, output_tokens: 0, thinking_tokens: 0 };
    t.by_model[c.model] = {
      calls: m.calls + 1,
      input_tokens: m.input_tokens + c.input_tokens,
      output_tokens: m.output_tokens + c.output_tokens,
      thinking_tokens: m.thinking_tokens + (c.thinking_tokens ?? 0),
    };
  }
  return t;
}
