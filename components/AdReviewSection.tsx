import type { AdReview } from "@/lib/ad-review";
import type { AdCampaignRow } from "@/lib/ads/performance";
import { RealBadge } from "./RealBadge";

/**
 * レポートの分析データタブ「広告の実績分析」（2026-10-06 新設）。
 * 分析の開始時点で読んだ、連携済みの広告アカウントの直近30日の実績と、それを元にしたAIの評価・所見・施策案。
 * 実績を読めた分析（status: ok）だけに出す。出稿・入札・予算の変更はしない（提案のみ）。
 */

const yen = (n: number) => `${Math.round(n).toLocaleString("ja-JP")}円`;
const r1 = (n: number) => Math.round(n * 10) / 10;
const pct = (a: number, b: number) => (b > 0 ? `${r1((a / b) * 100)}%` : "—");

// lib/ad-review.ts の totalsOf と同じ計算。あちらはAIの呼び出しを含むので、ブラウザ側の部品からは読み込まない
const totalsOf = (rows: AdCampaignRow[]) =>
  rows.reduce(
    (a, c) => ({
      cost: a.cost + (c.cost || 0),
      impressions: a.impressions + (c.impressions || 0),
      clicks: a.clicks + (c.clicks || 0),
      conversions: a.conversions + (c.conversions || 0),
    }),
    { cost: 0, impressions: 0, clicks: 0, conversions: 0 }
  );

const CELL = { padding: "8px 10px", textAlign: "right", whiteSpace: "nowrap" } as const;
const HEAD = { ...CELL, fontSize: 12, color: "var(--muted)", fontWeight: 500 } as const;
const NAME = { ...CELL, textAlign: "left", whiteSpace: "normal", minWidth: 160 } as const;

export function AdReviewSection({ review }: { review: AdReview | null }) {
  if (!review || review.status !== "ok") return null;
  const ok = review.accounts.filter((a) => !a.error);
  const failed = review.accounts.filter((a) => a.error);

  return (
    <>
      <div className="sec-head">
        <div>
          <h2 id="sec-adreview">
            広告の実績分析<RealBadge label="広告アカウントの実データで分析" />
          </h2>
          <div className="sub">
            連携した広告アカウントの実績（{review.period.from}〜{review.period.to}）をもとにしています
          </div>
        </div>
        <span className="rule" />
      </div>

      <div className="rows measure">
        <div className="rh">アカウント別の実績</div>
        <div className="r" style={{ display: "block", overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ ...HEAD, textAlign: "left" }}>媒体・アカウント</th>
                <th style={HEAD}>費用</th>
                <th style={HEAD}>表示</th>
                <th style={HEAD}>クリック</th>
                <th style={HEAD}>CTR</th>
                <th style={HEAD}>CV</th>
                <th style={HEAD}>CVR</th>
                <th style={HEAD}>CPA</th>
              </tr>
            </thead>
            <tbody>
              {ok.map((a, i) => {
                const t = totalsOf(a.campaigns);
                return (
                  <tr key={i} style={{ borderTop: "1px solid var(--line)" }}>
                    <td style={NAME}>
                      {a.platformName}
                      <br />
                      <small style={{ color: "var(--muted)" }}>{a.accountName}</small>
                    </td>
                    <td style={CELL}>{yen(t.cost)}</td>
                    <td style={CELL}>{t.impressions.toLocaleString("ja-JP")}</td>
                    <td style={CELL}>{t.clicks.toLocaleString("ja-JP")}</td>
                    <td style={CELL}>{pct(t.clicks, t.impressions)}</td>
                    <td style={CELL}>{r1(t.conversions)}</td>
                    <td style={CELL}>{pct(t.conversions, t.clicks)}</td>
                    <td style={CELL}>{t.conversions > 0 ? yen(t.cost / t.conversions) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {failed.length > 0 && (
            <p style={{ fontSize: 12, color: "var(--ng)", marginTop: 8 }}>
              実績を取得できなかったアカウント：
              {failed.map((a) => `${a.platformName}${a.accountName ? `「${a.accountName}」` : ""}`).join("・")}
            </p>
          )}
        </div>
      </div>

      {review.analysisError ? (
        <div className="note">
          <i className="i">i</i>
          <span>実績は取得できましたが、分析（所見・施策案）を作れませんでした。</span>
        </div>
      ) : (
        <>
          {(review.findings?.length ?? 0) > 0 && (
            <div className="rows measure" style={{ marginTop: 14 }}>
              <div className="rh">所見</div>
              {review.findings!.map((f, i) => (
                <div className="r" key={i}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <small style={{ color: "var(--text)", fontSize: 13 }}>{f}</small>
                  </div>
                </div>
              ))}
            </div>
          )}
          {(review.measures?.length ?? 0) > 0 && (
            <div className="rows measure" style={{ marginTop: 14 }}>
              <div className="rh">施策案</div>
              {review.measures!.map((m, i) => (
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
                  {m.flags && m.flags.length > 0 && (
                    <small style={{ display: "block", marginTop: 6, color: "var(--ng)" }}>
                      法令上の注意：{m.flags.map((f) => `「${f.text}」（${f.law}）${f.suggestion ? `→ ${f.suggestion}` : ""}`).join("／")}
                    </small>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="note">
            <i className="i">i</i>
            <span>施策案は提案です。入札・予算・配信の変更は、内容をご確認のうえ広告の管理画面で行ってください。</span>
          </div>
        </>
      )}
    </>
  );
}
