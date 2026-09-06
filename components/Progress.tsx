"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type State = { status: string; step: string; progress: number; error: string | null };

/**
 * 進捗画面。サーバーレスは1リクエストで長く回せないので、
 * 「1工程進める」エンドポイントを完了まで呼び続ける。
 */
export function Progress({ id, initial }: { id: string; initial: State }) {
  const [s, setS] = useState<State>(initial);
  const router = useRouter();
  const running = useRef(false);

  useEffect(() => {
    if (s.status === "done" || s.status === "failed" || running.current) return;
    running.current = true;
    let stopped = false;

    (async () => {
      let cur = s;
      while (!stopped && cur.status !== "done" && cur.status !== "failed") {
        const res = await fetch(`/api/analysis/${id}/tick`, { method: "POST" });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          cur = { status: "failed", step: "失敗しました", progress: cur.progress, error: j.error ?? "エラーが発生しました" };
        } else {
          cur = await res.json();
        }
        if (!stopped) setS(cur);
      }
      if (!stopped && cur.status === "done") router.replace(`/analysis/${id}/report`);
    })();

    return () => {
      stopped = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const failed = s.status === "failed";

  return (
    <div className="hero">
      <div className="wrap">
        <p className="eyebrow">{failed ? "分析に失敗しました" : "分析中"}</p>
        <h1 style={{ marginTop: 10 }}>
          {failed ? (
            <>やり直してください</>
          ) : (
            <>
              広告戦略を
              <br />
              <span className="gold">組み立てています</span>
            </>
          )}
        </h1>

        <div style={{ maxWidth: 520, margin: "34px auto 0" }}>
          <div className="bar">
            <span style={{ width: `${Math.max(6, s.progress)}%` }} />
          </div>
          <p className="lead" style={{ marginTop: 14 }}>{s.step}</p>
          {s.error && <p style={{ color: "var(--ng)", fontSize: 13, marginTop: 10 }}>{s.error}</p>}
        </div>

        {failed ? (
          <p style={{ marginTop: 28 }}>
            <a className="btn" href="/">最初からやり直す</a>
          </p>
        ) : (
          <p className="note" style={{ justifyContent: "center", marginTop: 26 }}>
            <i className="i">i</i>
            <span>この画面を開いたままにしてください。閉じると分析が止まります。</span>
          </p>
        )}
      </div>
    </div>
  );
}
