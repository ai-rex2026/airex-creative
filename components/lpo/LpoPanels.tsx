"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/Loading";
import { SpeedView } from "./SpeedView";
import {
  buildLpoAction,
  deleteHeatmapAction,
  deleteLpoAction,
  fetchClarityAction,
  measureSpeedAction,
  reanalyzeHeatmapAction,
  rebuildPlanAction,
  removeClarityAction,
  saveClarityTokenAction,
  togglePlanItemAction,
  uploadHeatmapAction,
} from "@/app/lpo-actions";
import { HEATMAP_KIND_LABEL, planItems, type HeatmapAnalysis, type LpoHeatmap, type LpoProject } from "@/lib/lpo-ops/types";

/** LPO運用の画面（2026-11-11）。タブ：LP改善／表示速度改善／ヒートマップ分析／効果 */

const fmt = (iso: string) => (iso ? new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function useRun() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  async function run(label: string, fn: () => Promise<unknown>) {
    if (busy) return;
    setErr(null);
    setMsg(null);
    setBusy(label);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(null);
    }
  }
  return { busy, err, msg, setErr, setMsg, run };
}

function Notice({ err, msg }: { err: string | null; msg: string | null }) {
  return (
    <>
      {err && (
        <div className="alert" style={{ marginTop: 10 }}>
          {err}
        </div>
      )}
      {msg && (
        <div className="note" style={{ marginTop: 10 }}>
          <i className="i">i</i>
          <span>{msg}</span>
        </div>
      )}
    </>
  );
}

export function LpoHeader({ project }: { project: LpoProject }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h2 style={{ fontSize: 20 }}>{project.name || "（名称未設定）"}</h2>
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
          <a href={project.url} target="_blank" rel="noreferrer">
            {project.url.replace(/^https?:\/\//, "")}
          </a>
          {project.analysisId && (
            <>
              {" "}／ <Link href={`/analysis/${project.analysisId}/report`}>元の分析レポート</Link>
            </>
          )}
        </p>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <Link className="btn ghost sm" href="/lpo">
          一覧へ
        </Link>
        <button
          className="btn ghost sm"
          disabled={busy}
          onClick={async () => {
            if (!window.confirm("この LP を削除します。LP改善・表示速度の記録・ヒートマップの分析も消えます。よろしいですか？")) return;
            setBusy(true);
            await deleteLpoAction(project.id).catch(() => undefined);
            router.push("/lpo");
          }}
        >
          削除
        </button>
      </div>
    </div>
  );
}

// ── LP改善 ─────────────────────

export function PlanPanel({ project }: { project: LpoProject }) {
  const { busy, err, msg, run } = useRun();
  const done = new Set(project.planDone);
  const groups = project.plan?.groups ?? [];
  const total = groups.reduce((s, g) => s + planItems(g).length, 0);
  const doneCount = groups.reduce((s, g) => s + planItems(g).filter((x) => done.has(x.key)).length, 0);

  if (!groups.length) {
    return (
      <div className="panel">
        <h2>LP改善がまだありません</h2>
        <p>{project.buildError ? `前回は作れませんでした（${project.buildError}）。` : ""}LP を読んで、広告の受け皿として直すところを洗い出します（AI を使います）。</p>
        <p style={{ marginTop: 14 }}>
          <button className="btn" disabled={!!busy} onClick={() => run("LP を読んで改善点を洗い出しています（1〜2分）", () => buildLpoAction(project.id))}>
            {busy ? <Spinner label={busy} /> : "LP改善を作る"}
          </button>
        </p>
        <Notice err={err} msg={msg} />
      </div>
    );
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <p style={{ flex: 1, fontSize: 13, color: "var(--muted)" }}>
          広告を出す前に直すと、同じ予算で獲得数が変わります。直したものに印を付けて管理できます（{doneCount}/{total} 済み）。
        </p>
        <button
          className="btn ghost sm"
          disabled={!!busy}
          onClick={() => {
            if (window.confirm("LP改善を作り直します（AI を使います）。同じ文言の指摘は「済み」の印が残ります。")) run("作り直しています（1〜2分）", () => rebuildPlanAction(project.id));
          }}
        >
          {busy ? <Spinner label={busy} /> : "作り直す"}
        </button>
      </div>
      <div className="measure" style={{ display: "grid", gap: 12 }}>
        {groups.map((g, i) => (
          <div className="tactic" key={i}>
            <div className="top">
              <b>{g.area}</b>
            </div>
            <ul style={{ listStyle: "none", paddingLeft: 0 }}>
              {planItems(g).map((x) => (
                <li key={x.key} style={{ display: "flex", gap: 8, alignItems: "flex-start", opacity: done.has(x.key) ? 0.55 : 1 }}>
                  <input
                    type="checkbox"
                    checked={done.has(x.key)}
                    disabled={!!busy}
                    onChange={(e) => run("保存しています", () => togglePlanItemAction(project.id, x.key, e.target.checked))}
                    style={{ marginTop: 4 }}
                    aria-label="済みにする"
                  />
                  <span style={{ textDecoration: done.has(x.key) ? "line-through" : undefined }}>
                    {x.text}
                    {x.severity && (
                      <span className={`tag${x.severity === "重" ? " warn" : ""}`} style={{ marginLeft: 8 }}>
                        {x.severity}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <Notice err={err} msg={msg} />
    </>
  );
}

// ── 表示速度改善 ─────────────────────

export function SpeedPanel({ project }: { project: LpoProject }) {
  const { busy, err, msg, setMsg, run } = useRun();
  const hist = project.speedHistory;
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <p style={{ flex: 1, fontSize: 13, color: "var(--muted)" }}>PageSpeed Insights（モバイル）の実測です。直したあとに測り直すと、下の推移に記録されます。</p>
        <button
          className="btn sm"
          disabled={!!busy}
          onClick={() =>
            run("表示速度を測っています（1〜3分）", async () => {
              const r = await measureSpeedAction(project.id);
              if (!r.ok) setMsg(`測定できませんでした：${r.reason}（前回の結果は残しています）`);
            })
          }
        >
          {busy ? <Spinner label={busy} /> : "測り直す"}
        </button>
      </div>
      <Notice err={err} msg={msg} />
      {project.speed ? (
        <SpeedView speed={project.speed} />
      ) : (
        <div className="note">
          <i className="i">i</i>
          <span>まだ測っていません。「測り直す」で測れます。</span>
        </div>
      )}
      {hist.length > 1 && <SpeedHistory project={project} />}
    </>
  );
}

function SpeedHistory({ project }: { project: LpoProject }) {
  const hist = project.speedHistory;
  const ids = [...new Map(hist.flatMap((h) => h.metrics.map((m) => [m.id, m.label] as const))).entries()];
  return (
    <div className="rows measure" style={{ marginTop: 16, overflowX: "auto" }}>
      <div className="rh">表示速度の推移</div>
      <table style={{ width: "100%", fontSize: 12.5, borderCollapse: "collapse", minWidth: 480 }}>
        <thead>
          <tr style={{ textAlign: "left", color: "var(--muted)" }}>
            <th style={{ padding: "6px 8px", fontWeight: 400 }}>測った日時</th>
            <th style={{ padding: "6px 8px", fontWeight: 400 }}>スコア</th>
            {ids.map(([id, label]) => (
              <th key={id} style={{ padding: "6px 8px", fontWeight: 400 }}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...hist].reverse().map((h, i) => (
            <tr key={i} style={{ borderTop: "1px solid var(--line)" }}>
              <td style={{ padding: "6px 8px" }}>{fmt(h.at)}</td>
              <td style={{ padding: "6px 8px" }}>{h.score ?? "—"}</td>
              {ids.map(([id]) => (
                <td key={id} style={{ padding: "6px 8px" }}>
                  {h.metrics.find((m) => m.id === id)?.value ?? "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── ヒートマップ分析 ─────────────────────

/**
 * 縦長のヒートマップ画像を、上から順に AI が読める大きさの画像に分ける（ブラウザの canvas）。
 * 幅は最大1200px、1枚の高さは最大1800px、最大8枚。それでも足りなければ全体を縮める。
 * 送れる大きさ（Vercel の1リクエスト 4.5MB）に収めるため、合計 3.8MB を超えたら画質・幅を下げて作り直す
 */
const MAX_TOTAL_BYTES = 3_800_000;
async function sliceImage(file: File): Promise<Blob[]> {
  for (const [maxW, q] of [[1200, 0.85], [1200, 0.7], [1000, 0.6], [800, 0.55], [640, 0.5]] as const) {
    const tiles = await sliceOnce(file, maxW, q);
    if (tiles.reduce((n, t) => n + t.size, 0) <= MAX_TOTAL_BYTES) return tiles;
  }
  throw new Error("画像が大きすぎて送れません。ページの一部ずつキャプチャして取り込んでください");
}

async function sliceOnce(file: File, maxW: number, quality: number): Promise<Blob[]> {
  const bmp = await createImageBitmap(file);
  let w = Math.min(maxW, bmp.width);
  let scale = w / bmp.width;
  const TILE_H = 1800;
  const MAX = 8;
  if ((bmp.height * scale) / TILE_H > MAX) {
    scale = (TILE_H * MAX) / bmp.height;
    w = Math.round(bmp.width * scale);
  }
  const h = Math.round(bmp.height * scale);
  const count = Math.max(1, Math.ceil(h / TILE_H));
  const out: Blob[] = [];
  for (let i = 0; i < count; i++) {
    const th = Math.min(TILE_H, h - i * TILE_H);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = th;
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("画像を読み込めませんでした");
    ctx.drawImage(bmp, 0, (i * TILE_H) / scale, bmp.width, th / scale, 0, 0, w, th);
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", quality));
    if (!blob) throw new Error("画像を変換できませんでした");
    out.push(blob);
  }
  bmp.close();
  return out;
}

export function HeatmapPanel({
  project,
  heatmaps,
  clarity,
  signed,
}: {
  project: LpoProject;
  heatmaps: LpoHeatmap[];
  clarity: { lastFetchAt: string | null } | null;
  signed: Record<string, string>;
}) {
  const { busy, err, msg, setMsg, setErr, run } = useRun();
  const [token, setToken] = useState("");
  const [kind, setKind] = useState("scroll");
  const [tool, setTool] = useState("");
  const [file, setFile] = useState<File | null>(null);

  return (
    <>
      <div className="measure" style={{ display: "grid", gap: 14 }}>
        <div className="tactic">
          <div className="top">
            <b>Microsoft Clarity と連携</b>
            {clarity && <span className="tag ok" style={{ marginLeft: 8 }}>連携済み</span>}
          </div>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: "6px 0 10px" }}>
            この LP の直近3日の数字（スクロール深度・滞在時間・反応しない所のクリック・連打・すぐ戻る など）を取り込み、改善案を出します。Clarity の API は1日の回数に上限があるため、取得は1日1回までです。ヒートマップの画像そのものは API で取れないので、画像は下の「画像を取り込む」から入れてください。
          </p>
          {clarity ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <button
                className="btn sm"
                disabled={!!busy}
                onClick={() =>
                  run("Clarity から取得して、改善案を書いています（1分ほど）", async () => {
                    const r = await fetchClarityAction(project.id);
                    if (r.ok) setMsg(r.message);
                    else setErr(r.message);
                  })
                }
              >
                {busy?.startsWith("Clarity") ? <Spinner label={busy} /> : "Clarity から取得して分析する"}
              </button>
              {clarity.lastFetchAt && <small style={{ color: "var(--muted)" }}>前回の取得：{fmt(clarity.lastFetchAt)}</small>}
              <button
                className="btn ghost sm"
                disabled={!!busy}
                onClick={() => {
                  if (window.confirm("Clarity の連携を外します（保存したトークンを消します）。")) run("外しています", () => removeClarityAction(project.id));
                }}
              >
                連携を外す
              </button>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              <small style={{ color: "var(--muted)" }}>
                Clarity の該当プロジェクトで「設定 → データのエクスポート → 新しい API トークンを生成」を押し、表示されたトークンを下に貼ってください（プロジェクトの管理者だけが発行できます）。トークンは暗号化して保存し、画面には二度と表示しません。
              </small>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input className="input" style={{ flex: 1, minWidth: 220 }} type="password" autoComplete="off" placeholder="Clarity の API トークン" value={token} onChange={(e) => setToken(e.target.value)} disabled={!!busy} />
                <button
                  className="btn sm"
                  disabled={!!busy || !token.trim()}
                  onClick={() =>
                    run("保存しています", async () => {
                      await saveClarityTokenAction(project.id, token);
                      setToken("");
                    })
                  }
                >
                  連携する
                </button>
              </div>
              <a href="https://clarity.microsoft.com/projects" target="_blank" rel="noreferrer" style={{ fontSize: 12.5 }}>
                Clarity を開く
              </a>
            </div>
          )}
        </div>

        <div className="tactic">
          <div className="top">
            <b>ヒートマップの画像を取り込む</b>
          </div>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: "6px 0 10px" }}>
            Hotjar・Ptengine・Clarity などのヒートマップ画面のキャプチャ（ページ全体）を入れると、AI が読み取って改善案を出します。縦に長い画像は上から順に分けて読ませます。
          </p>
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <select className="input" style={{ width: "auto" }} value={kind} onChange={(e) => setKind(e.target.value)} disabled={!!busy}>
                <option value="scroll">{HEATMAP_KIND_LABEL.scroll}</option>
                <option value="click">{HEATMAP_KIND_LABEL.click}</option>
                <option value="attention">{HEATMAP_KIND_LABEL.attention}</option>
              </select>
              <input className="input" style={{ flex: 1, minWidth: 160 }} placeholder="ツール名（任意。例：Hotjar）" value={tool} onChange={(e) => setTool(e.target.value)} disabled={!!busy} />
            </div>
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} disabled={!!busy} />
            <div>
              <button
                className="btn sm"
                disabled={!!busy || !file}
                onClick={() =>
                  run("画像を読んで、改善案を書いています（1〜2分）", async () => {
                    if (!file) return;
                    const tiles = await sliceImage(file);
                    const form = new FormData();
                    form.set("kind", kind);
                    form.set("tool", tool);
                    tiles.forEach((t, i) => form.append("tiles", new File([t], `tile-${i}.jpg`, { type: "image/jpeg" })));
                    const r = await uploadHeatmapAction(project.id, form);
                    if (!r.ok) setErr(r.message ?? "取り込めませんでした");
                    setFile(null);
                  })
                }
              >
                {busy?.startsWith("画像") ? <Spinner label={busy} /> : "取り込んで分析する"}
              </button>
            </div>
          </div>
        </div>
      </div>
      <Notice err={err} msg={msg} />

      {heatmaps.length === 0 ? (
        <div className="note" style={{ marginTop: 16 }}>
          <i className="i">i</i>
          <span>まだヒートマップの分析がありません。</span>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 16, marginTop: 18 }}>
          {heatmaps.map((h) => (
            <HeatmapCard key={h.id} h={h} signed={signed} busy={busy} run={run} />
          ))}
        </div>
      )}
    </>
  );
}

function HeatmapCard({ h, signed, busy, run }: { h: LpoHeatmap; signed: Record<string, string>; busy: string | null; run: (label: string, fn: () => Promise<unknown>) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="panel" style={{ padding: 16 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <b style={{ flex: 1 }}>
          {h.source === "clarity" ? "Microsoft Clarity（直近3日の数字）" : `${h.tool ? `${h.tool}：` : ""}${HEATMAP_KIND_LABEL[h.kind] ?? "ヒートマップ"}`}
          <small style={{ color: "var(--muted)", fontWeight: 400, marginLeft: 8 }}>{fmt(h.createdAt)}</small>
        </b>
        {(h.error || !h.analysis) && ((h.metrics?.length ?? 0) > 0 || h.images.length > 0) && (
          <button className="btn ghost sm" disabled={!!busy} onClick={() => run("改善案を作り直しています", () => reanalyzeHeatmapAction(h.id))}>
            改善案を作り直す
          </button>
        )}
        <button
          className="btn ghost sm"
          disabled={!!busy}
          onClick={() => {
            if (window.confirm("この分析を削除します。")) run("削除しています", () => deleteHeatmapAction(h.id));
          }}
        >
          削除
        </button>
      </div>
      {h.error && (
        <div className="note warn" style={{ marginTop: 10 }}>
          <i className="i">!</i>
          <span>{h.error}</span>
        </div>
      )}
      {h.metrics && h.metrics.length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: "pointer", fontSize: 13 }}>取得した数字を見る（{h.metrics.length}指標）</summary>
          <div className="rows" style={{ marginTop: 6 }}>
            {h.metrics.map((m, i) => (
              <div className="r" key={i}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b>{m.metric}</b>
                  <small>
                    {Object.entries(m.values)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join("　")}
                  </small>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
      {h.images.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <button className="btn ghost sm" onClick={() => setOpen((v) => !v)}>
            {open ? "画像を閉じる" : `取り込んだ画像を見る（${h.images.length}枚）`}
          </button>
          {open && (
            <div style={{ display: "grid", gap: 0, marginTop: 8, maxWidth: 520 }}>
              {h.images.map((p) =>
                signed[p] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={p} src={signed[p]} alt="ヒートマップ" style={{ width: "100%", display: "block" }} />
                ) : null
              )}
            </div>
          )}
        </div>
      )}
      {h.analysis && <AnalysisView a={h.analysis} />}
    </div>
  );
}

function AnalysisView({ a }: { a: HeatmapAnalysis }) {
  return (
    <div style={{ marginTop: 12 }}>
      {a.findings.length > 0 && (
        <>
          <p className="eyebrow">分かったこと</p>
          <ul style={{ fontSize: 13.5 }}>
            {a.findings.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </>
      )}
      <p className="eyebrow" style={{ marginTop: 10 }}>
        改善案
      </p>
      <div style={{ display: "grid", gap: 10 }}>
        {a.proposals.map((p, i) => (
          <div className="tactic" key={i}>
            <div className="top">
              <b>{p.title}</b>
              <span className={`tag${p.impact === "大" ? " warn" : ""}`} style={{ marginLeft: 8 }}>
                効果 {p.impact}
              </span>
              {p.where && (
                <span className="tag" style={{ marginLeft: 6 }}>
                  {p.where}
                </span>
              )}
            </div>
            <small style={{ display: "block", color: "var(--muted)", margin: "4px 0" }}>根拠：{p.why}</small>
            <ol style={{ fontSize: 13.5 }}>
              {p.steps.map((s, k) => (
                <li key={k}>{s}</li>
              ))}
            </ol>
          </div>
        ))}
      </div>
      <small style={{ display: "block", color: "var(--muted)", marginTop: 8 }}>AI が数字・画像から読み取った案です。効果を約束するものではありません。直す前に画面で確かめてください。</small>
    </div>
  );
}

// ── 効果 ─────────────────────

export function ResultsPanel({ project, heatmaps }: { project: LpoProject; heatmaps: LpoHeatmap[] }) {
  const groups = project.plan?.groups ?? [];
  const total = groups.reduce((s, g) => s + planItems(g).length, 0);
  const done = new Set(project.planDone);
  const doneCount = groups.reduce((s, g) => s + planItems(g).filter((x) => done.has(x.key)).length, 0);
  const first = project.speedHistory[0];
  const last = project.speedHistory[project.speedHistory.length - 1];
  const clarity = heatmaps.filter((h) => h.source === "clarity" && (h.metrics?.length ?? 0) > 0).reverse();
  const metricNames = [...new Set(clarity.flatMap((h) => (h.metrics ?? []).map((m) => m.metric)))];

  return (
    <>
      <div className="kpis" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
        <div className="kpi">
          <b>
            {doneCount}/{total}
          </b>
          <small>LP改善の済み</small>
        </div>
        <div className="kpi">
          <b>{last?.score ?? "—"}</b>
          <small>表示速度スコア（最新）{first && last && first !== last && first.score !== null && last.score !== null ? `　最初から ${last.score - first.score >= 0 ? "+" : ""}${last.score - first.score}` : ""}</small>
        </div>
        <div className="kpi">
          <b>{heatmaps.filter((h) => h.analysis).length}</b>
          <small>ヒートマップの分析</small>
        </div>
      </div>

      {project.speedHistory.length > 1 ? (
        <SpeedHistory project={project} />
      ) : (
        <div className="note" style={{ marginTop: 16 }}>
          <i className="i">i</i>
          <span>表示速度は、直したあとに「表示速度改善」タブで測り直すと、ここで前後を比べられます。</span>
        </div>
      )}

      {clarity.length > 1 ? (
        <div className="rows measure" style={{ marginTop: 16, overflowX: "auto" }}>
          <div className="rh">
            Clarity の数字の推移<small>取得した日ごと（直近3日の値）</small>
          </div>
          {metricNames.map((name) => (
            <div className="r" key={name}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <b>{name}</b>
                {clarity.map((h) => {
                  const m = (h.metrics ?? []).find((x) => x.metric === name);
                  return (
                    <small key={h.id} style={{ display: "block" }}>
                      {fmt(h.createdAt)}：{m ? Object.entries(m.values).map(([k, v]) => `${k} ${v}`).join("　") : "—"}
                    </small>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="note" style={{ marginTop: 12 }}>
          <i className="i">i</i>
          <span>Clarity を連携して取得を重ねると、ここで数字の推移を比べられます。</span>
        </div>
      )}
    </>
  );
}
