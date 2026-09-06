"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type State = { status: string; step: string; progress: number; error: string | null };

/** 進捗はサーバー側のワーカーが進める。ここは状態を見に行くだけ */
export function Waiting({ id, site, initial }: { id: string; site: string; initial: State }) {
  const [s, setS] = useState<State>(initial);
  const router = useRouter();
  const started = useRef(false);

  useEffect(() => {
    if (s.status === "done" || s.status === "failed" || started.current) return;
    started.current = true;
    const timer = setInterval(async () => {
      const res = await fetch(`/api/analysis/${id}/status`, { cache: "no-store" });
      if (!res.ok) return;
      const cur: State = await res.json();
      setS(cur);
      if (cur.status === "done") {
        clearInterval(timer);
        router.replace(`/analysis/${id}/report`);
      }
      if (cur.status === "failed") clearInterval(timer);
    }, 3000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const failed = s.status === "failed";

  return (
    <div className="panel">
      {!failed && <div className="spinner" />}
      <h2>{failed ? "分析に失敗しました" : "レポートを作成中です"}</h2>
      <p style={{ color: "var(--faint)", marginTop: 6 }}>{site}</p>
      <p>
        {failed
          ? s.error ?? "もう一度お試しください。"
          : "AIがサイトを分析しています。全体でおよそ1〜2分かかります。この画面を閉じても分析は続き、分析一覧からいつでも開き直せます。"}
      </p>
      <div style={{ maxWidth: 380, margin: "22px auto 0" }}>
        <div className="bar"><span style={{ width: `${Math.max(6, s.progress)}%` }} /></div>
        <p style={{ marginTop: 10, fontSize: 12.5, color: "var(--muted)" }}>{s.step}</p>
      </div>
      <p style={{ marginTop: 24 }}>
        <Link className="btn" href="/analysis">分析一覧に戻る</Link>
      </p>
    </div>
  );
}
