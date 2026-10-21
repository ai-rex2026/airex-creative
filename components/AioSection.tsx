import type { ReportAio } from "@/lib/report-aio-types";
import { RealBadge } from "./RealBadge";

/**
 * レポートの分析データタブ「AI検索での見え方（AIO）」（2026-10-21 新設。lib/report-aio.ts）。
 * 見込み客が打ちそうな問いを実際に Gemini（Google検索つき）へ投げ、自社が候補に挙がったか・
 * 自社サイトが引用されたかと、AIに引用されやすくするための施策を出す。
 * AIの回答は問い・時期で変わるため、結果は「その時点の1回の実測」として出し、因果は主張しない。
 */

const KIND: Record<string, string> = { recommend: "おすすめ型", issue: "課題型", select: "選定・比較型" };

function topDomains(aio: ReportAio) {
  const m = new Map<string, number>();
  for (const p of aio.prompts) for (const c of p.cited ?? []) if (c.domain && !(c.domain === aio.ownDomain || c.domain.endsWith(`.${aio.ownDomain}`))) m.set(c.domain, (m.get(c.domain) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
}

export function AioSection({ data, isGuest = false }: { data: ReportAio | null | undefined; isGuest?: boolean }) {
  const head = (badge: boolean) => (
    <div className="sec-head">
      <div>
        <h2 id="sec-aio">AI検索での見え方（AIO）{badge && <RealBadge label="Geminiへの実測で分析" />}</h2>
        <div className="sub">見込み客が打ちそうな問いを Gemini（Google検索つき）に実際に投げ、候補に挙がるかを見ています</div>
      </div>
      <span className="rule" />
    </div>
  );

  if (!data) {
    return (
      <>
        {head(false)}
        <div className="measure"><p className="sub">この分析の作成時にはAI検索の実測がありません。{!isGuest && "レポート上部のお知らせの「追加する」から測れます。"}</p></div>
      </>
    );
  }
  if (data.skipped) {
    return (
      <>
        {head(false)}
        <div className="measure">
          <p className="sub">{data.skipped}</p>
          {isGuest && <p style={{ marginTop: 8 }}><a className="btn" href="/login?mode=signup">会員登録する<span className="arw">→</span></a></p>}
        </div>
      </>
    );
  }

  const ok = data.prompts.filter((p) => p.status === "ok");
  const hit = ok.filter((p) => p.rank != null).length;
  const domains = topDomains(data);

  return (
    <>
      {head(ok.length > 0)}
      {data.stage !== "done" && <div className="alert">AI検索での見え方を測っています。しばらくしてから開き直してください。</div>}
      <div className="rows measure">
        <div className="rh">
          実測の結果：{ok.length}問中 {hit}問で候補に挙がりました
          <span style={{ color: "var(--muted)", fontWeight: 400 }}>（照合した名前：{data.ownNames.join("／") || "—"}）</span>
        </div>
        {data.prompts.map((p, i) => (
          <div className="r" key={i} style={{ display: "block" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
              <span className="tag">{KIND[p.kind] ?? p.kind}</span>
              <b style={{ flex: 1, fontWeight: 500 }}>{p.text}</b>
              {p.status === "ok" ? (
                <span className={`tag${p.rank != null ? " ok" : " ng"}`}>{p.rank != null ? `${p.rank}番目に挙がった` : "挙がらなかった"}</span>
              ) : p.status === "error" ? (
                <span className="tag">測定できませんでした</span>
              ) : (
                <span className="tag">測定中</span>
              )}
              {p.ownCited && <span className="tag ok">自社サイトを引用</span>}
            </div>
            {p.status === "ok" && (
              <small style={{ display: "block", marginTop: 4 }}>
                AIが挙げた候補：{(p.listed ?? []).length ? (p.listed ?? []).map((n, j) => (j + 1 === p.rank ? `【${n}】` : n)).join("、") : "（候補を読み取れませんでした）"}
              </small>
            )}
            {p.status === "error" && p.error && <small style={{ display: "block", marginTop: 4 }}>理由：{p.error}</small>}
            {p.status === "ok" && (p.cited ?? []).length > 0 && (
              <details style={{ marginTop: 4 }}>
                <summary style={{ fontSize: 12, color: "var(--muted)", cursor: "pointer" }}>引用元（{(p.cited ?? []).length}件）・AIの回答</summary>
                <ul style={{ margin: "6px 0 0 18px", fontSize: 12, color: "var(--muted)", lineHeight: 1.7 }}>
                  {(p.cited ?? []).map((c, j) => (
                    <li key={j}>
                      <a href={c.url} target="_blank" rel="noopener noreferrer">{c.domain || c.title || c.url}</a>
                      {c.title && c.title !== c.domain ? `　${c.title}` : ""}
                    </li>
                  ))}
                </ul>
                {p.answer && <p style={{ marginTop: 6, fontSize: 12, color: "var(--muted)", whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{p.answer}</p>}
              </details>
            )}
          </div>
        ))}
      </div>

      {domains.length > 0 && (
        <div className="rows measure" style={{ marginTop: 10 }}>
          <div className="rh">AIが引用元に使ったサイト（自社以外・多い順）</div>
          <div className="r">
            <small style={{ color: "var(--text)", fontSize: 13 }}>{domains.map(([d, n]) => `${d}（${n}）`).join("、")}</small>
          </div>
        </div>
      )}

      {(data.findings ?? []).length > 0 && (
        <div className="rows measure" style={{ marginTop: 10 }}>
          <div className="rh">所見</div>
          {(data.findings ?? []).map((f, i) => (
            <div className="r" key={i}><small style={{ color: "var(--text)", fontSize: 13 }}>{f}</small></div>
          ))}
        </div>
      )}

      {(data.measures ?? []).length > 0 && (
        <div className="rows measure" style={{ marginTop: 10 }}>
          <div className="rh">AIに引用されやすくするための施策</div>
          {(data.measures ?? []).map((m, i) => (
            <div className="r" key={i} style={{ display: "block" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                <b style={{ flex: 1 }}>{m.title}</b>
                <span className={`tag${m.impact === "大" ? " ok" : ""}`}>効果 {m.impact}</span>
              </div>
              <small style={{ display: "block", marginTop: 4 }}>{m.why}</small>
              {m.steps?.length > 0 && (
                <ol style={{ margin: "8px 0 0 18px", fontSize: 12.5, color: "var(--muted)", lineHeight: 1.7 }}>
                  {m.steps.map((s, j) => <li key={j}>{s}</li>)}
                </ol>
              )}
            </div>
          ))}
        </div>
      )}
      {data.analysisError && <div className="alert" style={{ marginTop: 10 }}>施策を作成できませんでした（{data.analysisError}）。実測の結果だけを表示しています。</div>}
      <p className="sub" style={{ marginTop: 8 }}>
        ※AIの回答は問いの書き方・時期・利用者によって変わります。この結果は{ok[0]?.at ? ` ${new Date(ok[0].at).toLocaleDateString("ja-JP")} 時点の` : ""}1回の実測で、施策を行えば候補に挙がることを約束するものではありません。
      </p>
    </>
  );
}
