import { askJson, MODEL_FAST } from "@/lib/anthropic";
import { JUDGE_SYSTEM, judgeUser, normalizeAnswer, type Judge, type JudgeAnswer, type JudgeInput } from "./judge";

/** Claude（Haiku）で判定する。1組につき1回、短い入出力で呼ぶ */
export const claudeJudge: Judge = {
  name: "claude",
  judge: async (input: JudgeInput): Promise<JudgeAnswer> => {
    const raw = await askJson<Partial<JudgeAnswer>>(JUDGE_SYSTEM, judgeUser(input), { model: MODEL_FAST, maxTokens: 400, timeoutMs: 60_000, forceAnthropic: true });
    return normalizeAnswer(raw, input);
  },
};
