"use client";

import { useState } from "react";
import { rewriteKitCopyAction } from "@/app/meo-kit-actions";
import { Btn, GuardNotes, Icon, cn } from "@/components/meo/ui";
import type { GuardHit } from "@/lib/types";
import type { Copy } from "@/lib/meo-ops/kit/types";

/** 文字列をクリップボードへ。押したボタンに「コピーしました」を一瞬出す */
export function CopyButton({ text, label = "コピー", size = "sm" }: { text: string; label?: string; size?: "sm" | "md" }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1200);
    } catch {
      // クリップボードが使えない環境では何もしない（文章は画面で選んでコピーできる）
    }
  };
  return (
    <Btn variant="outline" size={size} onClick={copy}>
      <Icon name={done ? "check" : "file"} className="h-3.5 w-3.5" />
      {done ? "コピーしました" : label}
    </Btn>
  );
}

/**
 * 貼るだけの文章。文字数はコードで数える（上限を超えたら赤）。
 * 「短く／やわらかく／別案」で作り直すと、その場で言葉のチェックも通す。
 */
export function CopyBox({ c, storeId, onChange, note }: { c: Copy; storeId: string; onChange?: (c: Copy) => void; note?: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [hits, setHits] = useState<GuardHit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const rewrite = async (mode: "短く" | "やわらかく" | "別案") => {
    setBusy(mode);
    setError(null);
    try {
      const r = await rewriteKitCopyAction(storeId, c.text, mode, c.limit);
      onChange?.({ ...c, text: r.text, count: r.count, over: r.over });
      setHits(r.hits);
    } catch (e) {
      setError(e instanceof Error ? e.message : "作り直せませんでした");
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-semibold text-[#2E2D29]">
          {c.field}
          {note && <span className="ml-1 font-normal text-[#A5A198]">（{note}）</span>}
        </span>
        <span className={cn("tabular-nums", c.over ? "font-bold text-[#B5523B]" : "text-[#8B877F]")}>
          {c.count ?? 0}
          {c.limit ? ` / ${c.limit}` : ""}文字{c.over ? "　上限超過" : ""}
        </span>
      </div>
      <div className="whitespace-pre-wrap rounded-xl border border-[#E8E5E0] bg-[#FAF9F7] p-3 text-sm leading-relaxed text-[#2E2D29]">{c.text || "（空）"}</div>
      <GuardNotes hits={hits} />
      {error && <p className="text-xs text-[#B5523B]">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <CopyButton text={c.text} />
        {onChange &&
          (["短く", "やわらかく", "別案"] as const).map((m) => (
            <Btn key={m} variant="ghost" size="sm" disabled={!!busy} onClick={() => rewrite(m)}>
              {busy === m ? <Icon name="loader" /> : null}
              {busy === m ? "作り直し中" : m}
            </Btn>
          ))}
      </div>
    </div>
  );
}

/** 今 → こう変える → なぜ */
export function BeforeAfter({ c, storeId, onChange, beforeLabel = "今" }: { c: Copy; storeId: string; onChange?: (c: Copy) => void; beforeLabel?: string }) {
  return (
    <div className="space-y-3 rounded-xl border border-[#F0EDE8] p-3">
      <div>
        <p className="text-[11px] font-semibold text-[#8B877F]">{beforeLabel}</p>
        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-[#6B6862]">{c.before?.trim() ? c.before : "（今の文言は読み取れませんでした）"}</p>
      </div>
      <div className="flex items-center gap-1 text-[11px] font-semibold text-[#8A5340]">
        <Icon name="arrowRight" className="h-3.5 w-3.5" />
        こう変える
      </div>
      <CopyBox c={c} storeId={storeId} onChange={onChange} />
      {c.why && (
        <p className="rounded-lg bg-[#F4F3F0] px-3 py-2 text-xs leading-relaxed text-[#6B6862]">
          <span className="font-semibold text-[#2E2D29]">なぜ：</span>
          {c.why}
        </p>
      )}
    </div>
  );
}
