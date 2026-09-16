"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { retryAnalysis } from "@/app/actions";

type State = { status: string; step: string; progress: number; error: string | null };

/** 進捗はサーバー側のワーカーが進める。ここは状態を見に行くだけ */
export function Waiting({ id, site, initial }: { id: string; site: string; initial: State }) {
  const [s, setS] = useState<State>(initial);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  // 監視は status を見て張り直す。やり直したあとにまた進捗を追えるようにするため
  useEffect(() => {
    if (s.status === "done" || s.status === "failed") return;
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
  }, [id, s.status]);

  const failed = s.status === "failed";

  return (
    <div className="panel">
      {!failed && <div className="spinner" />}
      <h2>{failed ? "分析に失敗しました" : "レポートを作成中です"}</h2>
      <p style={{ color: "var(--faint)", marginTop: 6 }}>{site}</p>
      <p>
        {failed
          ? s.error ?? "もう一度お試しください。"
          : "AIがサイトを分析しています。サイトの規模によりますが、全体でおよそ20〜40分かかります（混み合う時間帯や大きなサイトでは1時間ほどかかることもあります）。この画面を閉じても分析は続き、分析一覧からいつでも開き直せます。"}
      </p>
      <div style={{ maxWidth: 380, margin: "22px auto 0" }}>
        <div className="bar"><span style={{ width: `${Math.max(6, s.progress)}%` }} /></div>
        <p style={{ marginTop: 10, fontSize: 12.5, color: "var(--muted)" }}>{s.step}</p>
      </div>
      <p style={{ marginTop: 24, display: "flex", gap: 10, justifyContent: "center" }}>
        {/* 失敗したときに戻るしかないと、そこで詰む。途中から続けられるようにする */}
        {failed && (
          <button
            className="btn"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              retryAnalysis(id)
                .then(() => setS((x) => ({ ...x, status: "queued", step: "順番待ちです", error: null })))
                .catch((e) => setS((x) => ({ ...x, error: e instanceof Error ? e.message : String(e) })))
                .finally(() => setBusy(false));
            }}
          >
            {busy ? "やり直しています…" : "続きからやり直す"}
          </button>
        )}
        <Link className="btn ghost" href="/analysis">分析一覧に戻る</Link>
      </p>
    </div>
  );
}
