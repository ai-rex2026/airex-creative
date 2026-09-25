import Anthropic from "@anthropic-ai/sdk";
import { currentProvider, recordAiCall } from "./ai-context";
import { geminiGenerate } from "./gemini";

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

/** JSON だけを返させる。壊れた出力は最初の { … } / [ … ] を拾って救済する */
export async function askJson<T>(system: string, user: string, opts: AskOpts = {}): Promise<T> {
  const model = opts.model ?? MODEL;

  const call = async (extra: string, maxTokens: number) => {
    if (currentProvider() === "gemini") {
      const g = await geminiGenerate({
        system: system + "\n\n必ず JSON のみを出力すること。前置き・後置き・コードフェンスを付けない。" + extra,
        parts: [{ text: user }],
        maxTokens,
        json: true,
        timeoutMs: opts.timeoutMs,
      });
      return { text: stripFence(g.text), stop: g.truncated ? "max_tokens" : "end_turn" };
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
      { timeout: opts.timeoutMs ?? 150_000, maxRetries: 1 }
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

  const first = await call("", opts.maxTokens ?? 4000);
  try {
    return parse(first.text);
  } catch {
    // 途中で切れた JSON は救済できない。max_tokens に当たっているなら枠を広げ、
    // そうでなければ短く書き直させて、もう一度だけ試す。
    // 1回の生成が壊れただけでレポート全体を失敗させないための再試行。
    const truncated = first.stop === "max_tokens";
    const retry = await call(
      truncated
        ? "\n前回の出力は途中で切れた。項目数を減らし、各項目を短くして、必ず閉じ括弧まで出力すること。"
        : "\n前回の出力は JSON として読めなかった。構文を厳密に守り、JSON だけを出力すること。",
      Math.min(Math.round((opts.maxTokens ?? 4000) * 1.5), 8000)
    );
    try {
      return parse(retry.text);
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
export async function askJsonWithImages<T>(
  system: string,
  user: string,
  images: { media: string; base64: string }[],
  opts: AskOpts = {}
): Promise<T> {
  const model = opts.model ?? MODEL_FAST;

  const call = async (maxTokens: number, extraSystem: string) => {
    if (currentProvider() === "gemini") {
      const g = await geminiGenerate({
        system: system + "\n\n必ず JSON のみを出力すること。前置き・後置き・コードフェンスを付けない。" + extraSystem,
        parts: [
          ...images.flatMap((im, i) => [{ text: `画像 ${i}` }, { inline_data: { mime_type: im.media, data: im.base64 } }]),
          { text: user },
        ],
        maxTokens,
        json: true,
        timeoutMs: opts.timeoutMs ?? 90_000,
      });
      return { text: stripFence(g.text), stop: g.truncated ? "max_tokens" : "end_turn" };
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
      { timeout: opts.timeoutMs ?? 90_000, maxRetries: 1 }
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
  const first = await call(maxTokens, "");
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
        : "\n前回の出力は JSON として読めなかった。構文を厳密に守り、JSON だけを出力すること。"
    );
    return parse(retry.text);
  }
}
