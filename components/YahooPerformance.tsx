"use client";

import { useState, useTransition } from "react";
import { yahooPerformance, type YahooAdPerformance as Perf } from "@/app/ad-performance-actions";

const ymd = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const yen = (n: number) => Math.round(n).toLocaleString("ja-JP");
const num = (n: number) => Math.round(n * 10) / 10;
const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(2)}%` : "—");

const CELL = { padding: "8px 10px", textAlign: "right", whiteSpace: "nowrap" } as const;
const HEAD = { ...CELL, fontSize: 12, color: "var(--muted)", fontWeight: 500 } as const;

/** 選んだヤフーLINE広告アカウントの、キャンペーン別の実績（読み取りのみ）。期間は初期値が直近30日 */
export function YahooPerformance() {
  const today = new Date();
  const start = new Date();
  start.setDate(today.getDate() - 29);
  const [from, setFrom] = useState(ymd(start));
  const [to, setTo] = useState(ymd(today));
  const [data, setData] = useState<{ results: Perf[]; error?: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const load = () => startTransition(async () => setData(await yahooPerformance(from, to)));

  return (
    <section style={{ margin: "28px auto 0", maxWidth: 960, padding: "0 16px" }}>
      <h2 style={{ fontSize: 16, color: "var(--head)", margin: "0 0 10px" }}>広告実績（ヤフーLINE広告・キャンペーン別）</h2>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
        <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        <span>〜</span>
        <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        <button className="btn sm" onClick={load} disabled={pending || !from || !to}>
          {pending ? "取得中…" : "実績を取得"}
        </button>
      </div>

      {data?.error && <p style={{ color: "var(--ng)", fontSize: 13 }}>{data.error}</p>}

      {data?.results.map((r) => {
        const t = r.campaigns.reduce(
          (a, c) => ({
            cost: a.cost + c.cost,
            impressions: a.impressions + c.impressions,
            clicks: a.clicks + c.clicks,
            conversions: a.conversions + c.conversions,
            conversionsValue: a.conversionsValue + c.conversionsValue,
          }),
          { cost: 0, impressions: 0, clicks: 0, conversions: 0, conversionsValue: 0 }
        );
        return (
          <div key={r.account.id} style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 14, margin: "0 0 6px" }}>
              {r.account.name} <span style={{ color: "var(--faint)", fontWeight: 400 }}>ID: {r.account.id}</span>
            </h3>
            {r.error ? (
              <p style={{ color: "var(--ng)", fontSize: 13 }}>取得できませんでした：{r.error}</p>
            ) : r.campaigns.length === 0 ? (
              <p style={{ color: "var(--muted)", fontSize: 13 }}>この期間の実績はありません</p>
            ) : (
              <>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--line)" }}>
                        <th style={{ ...HEAD, textAlign: "left" }}>キャンペーン</th>
                        <th style={HEAD}>費用</th>
                        <th style={HEAD}>表示回数</th>
                        <th style={HEAD}>クリック</th>
                        <th style={HEAD}>CTR</th>
                        <th style={HEAD}>CV</th>
                        <th style={HEAD}>CV値</th>
                        <th style={HEAD}>CPA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.campaigns.map((c) => (
                        <tr key={c.id} style={{ borderBottom: "1px solid var(--line)" }}>
                          <td style={{ ...CELL, textAlign: "left", whiteSpace: "normal" }}>
                            {c.name}
                            {c.status && <span style={{ color: "var(--faint)", marginLeft: 6, fontSize: 11 }}>{c.status}</span>}
                          </td>
                          <td style={CELL}>{yen(c.cost)}</td>
                          <td style={CELL}>{c.impressions.toLocaleString("ja-JP")}</td>
                          <td style={CELL}>{c.clicks.toLocaleString("ja-JP")}</td>
                          <td style={CELL}>{pct(c.clicks, c.impressions)}</td>
                          <td style={CELL}>{num(c.conversions)}</td>
                          <td style={CELL}>{yen(c.conversionsValue)}</td>
                          <td style={CELL}>{c.conversions > 0 ? yen(c.cost / c.conversions) : "—"}</td>
                        </tr>
                      ))}
                      <tr style={{ fontWeight: 600 }}>
                        <td style={{ ...CELL, textAlign: "left" }}>合計</td>
                        <td style={CELL}>{yen(t.cost)}</td>
                        <td style={CELL}>{t.impressions.toLocaleString("ja-JP")}</td>
                        <td style={CELL}>{t.clicks.toLocaleString("ja-JP")}</td>
                        <td style={CELL}>{pct(t.clicks, t.impressions)}</td>
                        <td style={CELL}>{num(t.conversions)}</td>
                        <td style={CELL}>{yen(t.conversionsValue)}</td>
                        <td style={CELL}>{t.conversions > 0 ? yen(t.cost / t.conversions) : "—"}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <details style={{ marginTop: 8 }}>
                  <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--muted)" }}>日別（アカウント合計）</summary>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5, marginTop: 6 }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid var(--line)" }}>
                          <th style={{ ...HEAD, textAlign: "left" }}>日付</th>
                          <th style={HEAD}>費用</th>
                          <th style={HEAD}>表示回数</th>
                          <th style={HEAD}>クリック</th>
                          <th style={HEAD}>CV</th>
                          <th style={HEAD}>CV値</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.daily.map((d) => (
                          <tr key={d.date} style={{ borderBottom: "1px solid var(--line)" }}>
                            <td style={{ ...CELL, textAlign: "left" }}>{d.date}</td>
                            <td style={CELL}>{yen(d.cost)}</td>
                            <td style={CELL}>{d.impressions.toLocaleString("ja-JP")}</td>
                            <td style={CELL}>{d.clicks.toLocaleString("ja-JP")}</td>
                            <td style={CELL}>{num(d.conversions)}</td>
                            <td style={CELL}>{yen(d.conversionsValue)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </>
            )}
          </div>
        );
      })}
      <p style={{ fontSize: 11.5, color: "var(--faint)" }}>
        読み取りのみ。広告アカウントの設定は変更しません。金額は各アカウントの通貨のままの数値です。レポート生成のため、Google
        広告より数秒〜十数秒ほど時間がかかることがあります。
      </p>
    </section>
  );
}
