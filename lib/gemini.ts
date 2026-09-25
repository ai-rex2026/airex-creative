import { fallbackToAnthropic, recordAiCall } from "./ai-context";

/**
 * Gemini API（REST）の最小クライアント。
 * SDK を足さずに fetch で呼ぶ（依存を増やさない・Vercel のバンドルを太らせない）。
 *
 * 連携がひとつも無いレポートは精度より費用を優先し、全工程をこのモデルで作る。
 */

export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";

export function hasGemini() {
  return !!process.env.GEMINI_API_KEY;
}

/** 残高切れ・利用上限・キー不正など、待っても直らない（または当面直らない）失敗 */
export class GeminiUnavailableError extends Error {}

type Part = { text?: string; thought?: boolean; inline_data?: { mime_type: string; data: string } };

export type GeminiResult = { text: string; truncated: boolean };

// モデル名の揺れ（安定版とプレビュー版）と、思考レベル指定の可否を、実際に呼んで確かめてから固定する
let resolvedModel: string | null = null;
let thinkingSupported = true;

function candidates(model: string) {
  return resolvedModel ? [resolvedModel] : [model, `${model}-preview`];
}

export async function geminiGenerate(opts: {
  system: string;
  parts: Part[];
  maxTokens: number;
  json?: boolean;
  search?: boolean;
  timeoutMs?: number;
}): Promise<GeminiResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new GeminiUnavailableError("GEMINI_API_KEY が未設定です");

  const body = (withThinking: boolean) => ({
    system_instruction: { parts: [{ text: opts.system }] },
    contents: [{ role: "user", parts: opts.parts }],
    ...(opts.search ? { tools: [{ google_search: {} }] } : {}),
    generationConfig: {
      maxOutputTokens: opts.maxTokens,
      temperature: 0.7,
      // 検索連携と JSON 指定は同時に使えないモデルがあるため、検索時は文章中の JSON を拾う
      ...(opts.json && !opts.search ? { responseMimeType: "application/json" } : {}),
      // 思考は出力と同じ単価で課金される。精度より費用を優先する用途なので最小にする
      ...(withThinking ? { thinkingConfig: { thinkingLevel: "minimal" } } : {}),
    },
  });

  let lastErr = "";
  for (const model of candidates(GEMINI_MODEL)) {
    for (const withThinking of thinkingSupported ? [true, false] : [false]) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 150_000);
      let res: Response;
      try {
        res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify(body(withThinking)),
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (res.status === 404) {
        lastErr = `model ${model} not found`;
        break; // 次のモデル名を試す
      }
      if (res.status === 400 && withThinking) {
        const t = await res.text();
        if (/thinking/i.test(t)) {
          thinkingSupported = false;
          continue; // 思考レベルの指定を外して再試行
        }
        throw new Error(`Gemini 400: ${t.slice(0, 300)}`);
      }
      if (!res.ok) {
        const t = (await res.text()).slice(0, 300);
        if ([401, 402, 403, 429, 500, 503].includes(res.status)) throw new GeminiUnavailableError(`Gemini ${res.status}: ${t}`);
        throw new Error(`Gemini ${res.status}: ${t}`);
      }

      resolvedModel = model;
      const j = (await res.json()) as {
        candidates?: { content?: { parts?: Part[] }; finishReason?: string }[];
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; toolUsePromptTokenCount?: number };
      };
      const u = j.usageMetadata ?? {};
      const c = j.candidates?.[0];
      recordAiCall({
        model,
        input_tokens: (u.promptTokenCount ?? 0) + (u.toolUsePromptTokenCount ?? 0),
        output_tokens: u.candidatesTokenCount ?? 0,
        thinking_tokens: u.thoughtsTokenCount ?? 0,
        searches: opts.search ? 1 : 0,
      });
      const text = (c?.content?.parts ?? [])
        .filter((p) => !p.thought)
        .map((p) => p.text ?? "")
        .join("");
      return { text, truncated: c?.finishReason === "MAX_TOKENS" };
    }
  }
  throw new GeminiUnavailableError(`Gemini: 利用できるモデルが見つかりません（${lastErr}）`);
}

/**
 * Gemini で生成し、使えなければ null を返して呼び出し元に Claude で作らせる。
 * 一度使えなかったら、その工程の残りは Claude に切り替える（毎回失敗を待たない）。
 */
export async function geminiOrFallback(opts: Parameters<typeof geminiGenerate>[0]): Promise<GeminiResult | null> {
  try {
    return await geminiGenerate(opts);
  } catch (e) {
    if (e instanceof GeminiUnavailableError) {
      console.error("[gemini] fallback to anthropic:", e.message);
      fallbackToAnthropic();
      return null;
    }
    throw e;
  }
}
