import Anthropic from "@anthropic-ai/sdk";
import { currentProvider, recordAiCall } from "./ai-context";
import { geminiOrFallback } from "./gemini";

/**
 * 判断・生成が要る処理は品質側、機械的な抽出・分類は低コスト側に振る。
 * （airex-recruiting で実測した使い分けをそのまま踏襲）
 */
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
export const MODEL_FAST = process.env.ANTHROPIC_MODEL_FAST || "claude-haiku-4-5";

export function hasAnthropic() {
  return !!process.env.ANTHROPIC_API_KEY;
}

function client() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

export type AiUsage = { model: string; input_tokens: number; output_tokens: number };

export type AskOpts = { maxTokens?: number; model?: string; timeoutMs?: number; meter?: (u: AiUsage) => void };

function stripFence(raw: string) {
  return raw
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}


/**
 * 指示の「出力:」に書いた JSON の外枠と、返ってきた JSON の外枠がずれたときに合わせる。
 * 軽いモデルほど {"items":[...]} を [...] で返したり、別の名前で包んだりしやすく、
 * そのままだと中身があるのに空として扱われてしまう。
 */
function exampleOf(prompt: string): Record<string, unknown> | null {
  const i = prompt.lastIndexOf("出力");
  if (i < 0) return null;
  const start = prompt.indexOf("{", i);
  if (start < 0) return null;
  let depth = 0;
  for (let j = start; j < prompt.length; j++) {
    const ch = prompt[j];
    if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      try {
        const v = JSON.parse(prompt.slice(start, j + 1));
        return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function conformToExample<T>(parsed: unknown, system: string, user: string): T {
  const ex = exampleOf(user) ?? exampleOf(system);
  if (!ex) return parsed as T;
  const exKeys = Object.keys(ex);
  const arrayKeys = exKeys.filter((k) => Array.isArray(ex[k]));
  // [...] だけが返ってきた
  if (Array.isArray(parsed)) {
    if (arrayKeys.length === 1) {
      console.warn("[ai] wrapped bare array into", arrayKeys[0]);
      return { [arrayKeys[0]]: parsed } as T;
    }
    return parsed as T;
  }
  if (!parsed || typeof parsed !== "object") return parsed as T;
  let obj = parsed as Record<string, unknown>;
  // {"result": {...本来の中身...}} のように1段余計に包まれている
  const own = Object.keys(obj);
  if (!exKeys.some((k) => k in obj) && own.length === 1) {
    const inner = obj[own[0]];
    if (Array.isArray(inner) && arrayKeys.length === 1) {
      console.warn("[ai] renamed", own[0], "to", arrayKeys[0]);
      return { [arrayKeys[0]]: inner } as T;
    }
    if (inner && typeof inner === "object" && exKeys.some((k) => k in (inner as object))) {
      console.warn("[ai] unwrapped", own[0]);
      obj = inner as Record<string, unknown>;
    }
  }
  // 配列のキー名だけが違う（"items" の代わりに "plans" など）
  const missing = arrayKeys.filter((k) => !(k in obj));
  const extra = Object.keys(obj).filter((k) => !exKeys.includes(k) && Array.isArray(obj[k]));
  if (missing.length === 1 && extra.length === 1) {
    console.warn("[ai] renamed", extra[0], "to", missing[0]);
    obj = { ...obj, [missing[0]]: obj[extra[0]] };
  }
  return obj as T;
}

/**
 * askJson は失敗時に最大1回リトライする（下記）。
 *
 * 2026-10-04: 以前はリトライも初回と同じ timeoutMs を使っていたため、呼び出し元が
 * timeoutMs を長めに指定していると（例: lib/ad-ops.ts の finishAdOps は170秒）、
 * 「初回170秒＋リトライ170秒＝最悪340秒」のように、1回の askJson 呼び出し単体で
 * サーバーレス関数の実行上限（300秒）を超えてしまい、途中経過を保存する前に
 * 関数ごと強制終了される組み合わせが存在した。
 * そのため、初回とリトライを合わせた合計がこの値を超えないように、リトライの
 * 持ち時間を「残り予算」として算出する（呼び出し元が timeoutMs をどう指定しても、
 * askJson 1回の呼び出し全体がこの上限に収まることを保証する）
 */
const TOTAL_BUDGET_MS = 260_000;
/** 初回・リトライのどちらにも、最低限これだけの時間は残す */
const MIN_CALL_MS = 20_000;

/** JSON だけを返させる。壊れた出力は最初の { … } / [ … ] を拾って救済する */
export async function askJson<T>(system: string, user: string, opts: AskOpts = {}): Promise<T> {
  const model = opts.model ?? MODEL;
  const firstTimeoutMs = Math.min(opts.timeoutMs ?? 150_000, TOTAL_BUDGET_MS - MIN_CALL_MS);
  const retryTimeoutMs = Math.max(MIN_CALL_MS, TOTAL_BUDGET_MS - firstTimeoutMs);

  const call = async (extra: string, maxTokens: number, timeoutMs: number) => {
    if (currentProvider() === "gemini") {
      const g = await geminiOrFallback({
        system: system + "\n\n必ず JSON のみを出力すること。前置き・後置き・コードフェンスを付けない。" + extra,
        parts: [{ text: user }],
        maxTokens,
        json: true,
        timeoutMs,
      });
      if (g) return { text: stripFence(g.text), stop: g.truncated ? "max_tokens" : "end_turn" };
    }
    const res = await client().messages.create(
      {
        model,
        max_tokens: maxTokens,
        system:
          system +
          "\n\n必ず JSON のみを出力すること。前置き・後置き・コードフェンスを付けない。" +
          extra,
        messages: [{ role: "user", content: user }],
      },
      // 返ってこない呼び出しに実行時間を食われると、工程を保存できないまま関数ごと切られる
      { timeout: timeoutMs, maxRetries: 1 }
    );
    opts.meter?.({
      model,
      input_tokens: res.usage.input_tokens,
      output_tokens: res.usage.output_tokens,
    });
    recordAiCall({ model, input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens });
    return { text: stripFence(res.content.map((b) => (b.type === "text" ? b.text : "")).join("")), stop: res.stop_reason };
  };

  const parse = (cleaned: string): T => {
    try {
      return JSON.parse(cleaned) as T;
    } catch {
      const m = cleaned.match(/[[{][\s\S]*[\]}]/);
      if (!m) throw new Error("no-json");
      return JSON.parse(m[0]) as T;
    }
  };

  const first = await call("", opts.maxTokens ?? 4000, firstTimeoutMs);
  try {
    return conformToExample<T>(parse(first.text), system, user);
  } catch {
    // 途中で切れた JSON は救済できない。max_tokens に当たっているなら枠を広げ、
    // そうでなければ短く書き直させて、もう一度だけ試す。
    // 1回の生成が壊れただけでレポート全体を失敗させないための再試行。
    const truncated = first.stop === "max_tokens";
    const retry = await call(
      truncated
        ? "\n前回の出力は途中で切れた。項目数を減らし、各項目を短くして、必ず閉じ括弧まで出力すること。"
        : "\n前回の出力は JSON として読めなかった。構文を厳密に守り、JSON だけを出力すること。",
      Math.min(Math.round((opts.maxTokens ?? 4000) * 1.5), 12000),
      retryTimeoutMs
    );
    try {
      return conformToExample<T>(parse(retry.text), system, user);
    } catch {
      throw new Error(
        truncated
          ? "AIの応答が長すぎて途中で切れました"
          : "AIの応答をJSONとして読めませんでした"
      );
    }
  }
}

/**
 * 画像を見せて JSON を返させる。
 * 画像は base64 で渡す（外部URLのままだと、取得できないことがある）。
 */
/** askJson と同じ理由（合計が実行上限に迫らないように）。こちらは元のデフォルトが
 *  90秒×2＝180秒とまだ余裕があるため、やや緩めの合計予算にしている */
const TOTAL_BUDGET_MS_IMAGES = 220_000;

export async function askJsonWithImages<T>(
  system: string,
  user: string,
  images: { media: string; base64: string }[],
  opts: AskOpts = {}
): Promise<T> {
  const model = opts.model ?? MODEL_FAST;
  const firstTimeoutMs = Math.min(opts.timeoutMs ?? 90_000, TOTAL_BUDGET_MS_IMAGES - MIN_CALL_MS);
  const retryTimeoutMs = Math.max(MIN_CALL_MS, TOTAL_BUDGET_MS_IMAGES - firstTimeoutMs);

  const call = async (maxTokens: number, extraSystem: string, timeoutMs: number) => {
    if (currentProvider() === "gemini") {
      const g = await geminiOrFallback({
        system: system + "\n\n必ず JSON のみを出力すること。前置き・後置き・コードフェンスを付けない。" + extraSystem,
        parts: [
          ...images.flatMap((im, i) => [{ text: `画像 ${i}` }, { inline_data: { mime_type: im.media, data: im.base64 } }]),
          { text: user },
        ],
        maxTokens,
        json: true,
        timeoutMs,
      });
      if (g) return { text: stripFence(g.text), stop: g.truncated ? "max_tokens" : "end_turn" };
    }
    const res = await client().messages.create(
      {
        model,
        max_tokens: maxTokens,
        system: system + "\n\n必ず JSON のみを出力すること。前置き・後置き・コードフェンスを付けない。" + extraSystem,
        messages: [
          {
            role: "user",
            content: [
              ...images.map((im, i) => [
                { type: "text" as const, text: `画像 ${i}` },
                {
                  type: "image" as const,
                  source: { type: "base64" as const, media_type: im.media as "image/png", data: im.base64 },
                },
              ]).flat(),
              { type: "text" as const, text: user },
            ],
          },
        ],
      },
      { timeout: timeoutMs, maxRetries: 1 }
    );
    opts.meter?.({ model, input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens });
    recordAiCall({ model, input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens });
    return { text: stripFence(res.content.map((b) => (b.type === "text" ? b.text : "")).join("")), stop: res.stop_reason };
  };

  const parse = (cleaned: string): T => {
    try {
      return JSON.parse(cleaned) as T;
    } catch {
      const m = cleaned.match(/[[{][\s\S]*[\]}]/);
      if (!m) throw new Error("no-json");
      return JSON.parse(m[0]) as T;
    }
  };

  const maxTokens = opts.maxTokens ?? 1500;
  const first = await call(maxTokens, "", firstTimeoutMs);
  try {
    return parse(first.text);
  } catch {
    // 画像枚数が多いと出力が途中で切れてJSONとして読めないことがある。
    // 1回壊れただけで判定全体（＝写真の候補すべて）を失わないよう、枠を広げて一度だけ再試行する
    const truncated = first.stop === "max_tokens";
    const retry = await call(
      truncated ? Math.min(Math.round(maxTokens * 1.5), 6000) : maxTokens,
      truncated
        ? "\n前回の出力は途中で切れた。各項目の note を短くしてでも、必ず閉じ括弧まで出力すること。"
        : "\n前回の出力は JSON として読めなかった。構文を厳密に守り、JSON だけを出力すること。",
      retryTimeoutMs
    );
    return parse(retry.text);
  }
}
