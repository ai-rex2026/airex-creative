import { recordAiCall } from "../ai-context";

/**
 * ナレーションの音声合成（Gemini の TTS）。1場面ずつ作り、WAV（24kHz・16bit・モノラル）で返す。
 * 新しい Interactions API を使い、使えなければ従来の generateContent（音声の出力）で作る。
 */

export const TTS_MODEL = process.env.GEMINI_TTS_MODEL || "gemini-3.8-flash-tts";
const LEGACY_TTS_MODEL = process.env.GEMINI_TTS_LEGACY_MODEL || "gemini-2.5-flash-preview-tts";

export { VOICES } from "./video-types";
import { VOICES } from "./video-types";

export type Wav = { bytes: Buffer; seconds: number };

/** 16bit モノラル PCM → WAV */
export function pcmToWav(pcm: Buffer, sampleRate = 24000): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/** WAV の長さ（秒）。data チャンクを探して数える */
export function wavSeconds(wav: Buffer): number {
  if (wav.toString("ascii", 0, 4) !== "RIFF") return 0;
  const rate = wav.readUInt32LE(24);
  const byteRate = wav.readUInt32LE(28) || rate * 2;
  let off = 12;
  while (off + 8 <= wav.length) {
    const id = wav.toString("ascii", off, off + 4);
    const size = wav.readUInt32LE(off + 4);
    if (id === "data") return Math.min(size, wav.length - off - 8) / byteRate;
    off += 8 + size + (size % 2);
  }
  return 0;
}

const STYLE = "落ち着いた、聞き取りやすい日本語のナレーションとして、自然な速さで読んでください。";

export async function synthesize(text: string, voice: string, f: typeof fetch = fetch): Promise<Wav> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("ナレーションを作るには GEMINI_API_KEY の設定が要ります");
  const v = VOICES.some((x) => x.id === voice) ? voice : "Kore";

  // 1) Interactions API
  const res = await f("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      model: TTS_MODEL,
      input: [{ type: "user_input", content: [{ type: "text", text: `${STYLE}\n${text}` }] }],
      response_format: { type: "audio" },
      generation_config: { speech_config: [{ voice: v }] },
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (res.ok) {
    const j = (await res.json()) as { steps?: { type?: string; content?: { type?: string; data?: string; mime_type?: string }[] }[]; usage?: { input_tokens?: number; output_tokens?: number } };
    const audio = (j.steps ?? []).flatMap((s) => s.content ?? []).filter((c) => c.type === "audio" && c.data).pop();
    if (audio?.data) {
      recordAiCall({ model: TTS_MODEL, input_tokens: j.usage?.input_tokens ?? 0, output_tokens: j.usage?.output_tokens ?? 0 });
      let bytes: Buffer = Buffer.from(audio.data, "base64");
      if (bytes.toString("ascii", 0, 4) !== "RIFF") bytes = pcmToWav(bytes);
      return { bytes, seconds: wavSeconds(bytes) };
    }
  } else if (res.status !== 404 && res.status !== 400) {
    throw new Error(`ナレーションを作れませんでした（Gemini ${res.status}: ${(await res.text()).slice(0, 200)}）`);
  }

  // 2) 従来の generateContent（音声）
  const r2 = await f(`https://generativelanguage.googleapis.com/v1beta/models/${LEGACY_TTS_MODEL}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: `${STYLE}\n${text}` }] }],
      generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: v } } } },
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!r2.ok) throw new Error(`ナレーションを作れませんでした（Gemini ${r2.status}: ${(await r2.text()).slice(0, 200)}）`);
  const j2 = (await r2.json()) as { candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } };
  const part = (j2.candidates?.[0]?.content?.parts ?? []).find((p) => p.inlineData?.data);
  if (!part?.inlineData?.data) throw new Error("ナレーションの音声が返ってきませんでした");
  recordAiCall({ model: LEGACY_TTS_MODEL, input_tokens: j2.usageMetadata?.promptTokenCount ?? 0, output_tokens: j2.usageMetadata?.candidatesTokenCount ?? 0 });
  const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType ?? "")?.[1] ?? 24000);
  const raw = Buffer.from(part.inlineData.data, "base64");
  const bytes = raw.toString("ascii", 0, 4) === "RIFF" ? raw : pcmToWav(raw, rate);
  return { bytes, seconds: wavSeconds(bytes) };
}
