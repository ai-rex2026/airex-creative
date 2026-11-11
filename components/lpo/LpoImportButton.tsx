"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createLpoFromAnalysisAction } from "@/app/lpo-actions";

/** レポートの LP改善から、LPO運用へ取り込む（2026-11-11。AI・計測は呼ばない） */
export function LpoImportButton({ analysisId }: { analysisId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="no-print" style={{ margin: "-4px 0 12px" }}>
      <button
        className="btn ghost sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          try {
            const { id } = await createLpoFromAnalysisAction(analysisId);
            router.push(`/lpo/${id}`);
          } catch (e) {
            setErr(e instanceof Error ? e.message : String(e));
            setBusy(false);
          }
        }}
      >
        {busy ? "取り込んでいます…" : "LPO運用で管理する（ヒートマップ分析・速度の推移）→"}
      </button>
      {err && <small style={{ display: "block", color: "var(--ng, #a0472f)", marginTop: 4 }}>{err}</small>}
    </div>
  );
}
