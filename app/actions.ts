"use server";

import { diagnose } from "@/lib/diagnose";
import { generateCopies, scoreCopies } from "@/lib/copy";
import { generateLp } from "@/lib/lp";
import { hasAnthropic } from "@/lib/anthropic";
import type { BannerCopy, Diagnosis } from "@/lib/types";

function assertKey() {
  if (!hasAnthropic()) throw new Error("ANTHROPIC_API_KEY が未設定です");
}

export async function runDiagnosis(input: { url?: string; text?: string }): Promise<Diagnosis> {
  assertKey();
  return diagnose(input);
}

export async function runCopies(d: Diagnosis, perAngle: number): Promise<BannerCopy[]> {
  assertKey();
  const copies = await generateCopies(d, perAngle);
  return scoreCopies(d, copies);
}

export async function runLp(d: Diagnosis, copy: BannerCopy) {
  assertKey();
  return generateLp(d, copy);
}
