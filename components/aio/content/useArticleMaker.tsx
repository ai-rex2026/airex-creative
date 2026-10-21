"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createAioArticleAction, finishAioArticleAction } from "@/app/aio-content-actions";
import type { ArticleBrief } from "@/lib/aio/article";
import type { AioChannelKind } from "@/lib/aio/content-types";

export type MakePhase = null | "writing" | "finishing";

/**
 * 記事づくりの2工程（本文を書いて保存 → 表現チェックと画像）を続けて呼ぶ。
 * 工程ごとに保存されるので、2工程目で止まっても記事は残り、カードの「仕上げる」で続きからやり直せる
 */
export function useArticleMaker(projectId: string) {
  const router = useRouter();
  const [phase, setPhase] = useState<MakePhase>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const make = async (kind: AioChannelKind, brief: ArticleBrief | null, plan?: { planId: string; itemId: string }, keywordId?: string | null) => {
    setError(null);
    setNotice(null);
    setPhase("writing");
    let articleId: string | null = null;
    try {
      const created = await createAioArticleAction(projectId, kind, brief, plan, keywordId ?? null);
      if (!created.ok) {
        setError(created.error);
        return null;
      }
      articleId = created.id;
      router.refresh();
      setPhase("finishing");
      const r = await finishAioArticleAction(articleId);
      if (!r.ok) {
        setError(`記事は保存しました。仕上げ（表現チェック・画像）で止まりました：${r.error}。記事のカードの「仕上げる」で続きから再開できます`);
        router.refresh();
        return articleId;
      }
      if (r.failed) setNotice(`画像を${r.failed}枚作れませんでした。${r.imageErrors.length ? `理由：${r.imageErrors.join(" / ")}。` : ""}記事のカードから作り直せます`);
      if (r.guard === "red") setNotice((n) => `${n ? `${n}。` : ""}表現チェックで「要修正」があります。記事のカードで確認してください`);
      router.refresh();
      return articleId;
    } catch (e) {
      setError(e instanceof Error ? e.message : "記事を作れませんでした");
      router.refresh();
      return articleId;
    } finally {
      setPhase(null);
    }
  };

  return { make, phase, error, notice, busy: phase !== null };
}

export function PhaseNote({ phase }: { phase: MakePhase }) {
  if (!phase) return null;
  return (
    <p className="mt-3 text-xs text-[#6B6862]">
      {phase === "writing" ? "① 既存記事のトンマナに合わせて本文を書いています（1〜3分）…" : "② 表現チェックと、文字の入らない画像（アイキャッチ＋本文中）を作っています（1〜2分）…"}
    </p>
  );
}
