"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toPng } from "html-to-image";
import JSZip from "jszip";
import { Spinner } from "@/components/Loading";
import { LAYOUT_LABEL, STYLE_LABEL, StudioBanner, resolveLayout, resolveStyle, type BannerLayout, type TextStyle } from "./StudioBanner";
import type { BannerCopy } from "@/lib/types";
import {
  deleteBannerProjectAction,
  deleteMaterialAction,
  deleteVisualAction,
  editPatternCopyAction,
  reviewBannerAction,
  editCopyAction,
  generateBasesAction,
  makeVideoAction,
  pollBannerAction,
  prepareBannerAction,
  regenerateCopiesAction,
  regeneratePatternsAction,
  resizeVisualAction,
  updateBannerInputAction,
  uploadMaterialAction,
} from "@/app/banner-actions";
import {
  ARCHETYPES,
  BANNER_SIZES,
  toPatternCopy,
  fromPatternCopy,
  type BannerPattern,
  type BannerReview,
  type PatternCopy,
  FAL_PRICE,
  PATTERN_COUNT,
  VIDEO_ASPECTS,
  assetUrl,
  nearestAspect,
  aspectValue,
  type BannerProject,
  type BannerSize,
  type BannerVisual,
} from "@/lib/banner-studio/types";
import { renderBannerVideo, canRenderBannerVideo } from "./render-banner-video";

/** 広告運用 ＞ バナー制作の作業画面（2026-11-11） */

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const GUARD_LABEL = { green: "法令チェック：問題なし", yellow: "法令チェック：要確認", red: "法令チェック：NG" } as const;

function useRun() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function run(label: string, fn: () => Promise<unknown>) {
    if (busy) return;
    setErr(null);
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
  return { busy, err, setErr, run };
}

/** ブラウザで縮めてから送る（長辺2000px・JPEG） */
async function shrink(file: File): Promise<File> {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  if (s === 1 && file.size < 3_000_000) return file;
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  c.getContext("2d")?.drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, file.type === "image/png" ? "image/png" : "image/jpeg", 0.9));
  if (!blob) return file;
  return new File([blob], file.name, { type: blob.type });
}

function Scaled({ w, h, box, children }: { w: number; h: number; box: number; children: React.ReactNode }) {
  const scale = Math.min(box / w, box / h);
  return (
    <div style={{ width: w * scale, height: h * scale, overflow: "hidden", borderRadius: 6, border: "1px solid var(--line)", background: "#f4f3f0" }}>
      <div style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: w, height: h }}>{children}</div>
    </div>
  );
}

export function BannerWorkspace({
  project,
  visuals,
  usage,
}: {
  project: BannerProject;
  visuals: BannerVisual[];
  usage: { images: number; videos: number; limit: { images: number; videos: number }; falReady: boolean };
}) {
  const router = useRouter();
  const { busy, err, setErr, run } = useRun();
  const d = project.diagnosis;
  const pending = visuals.filter((v) => v.status === "queued").length;

  // 作成中のものがあれば、数秒おきに進める
  useEffect(() => {
    if (!pending) return;
    let stop = false;
    const tick = async () => {
      if (stop) return;
      try {
        const r = await pollBannerAction(project.id);
        if (r.changed) router.refresh();
      } catch {
        // 次の問い合わせでやり直す
      }
    };
    const h = setInterval(tick, 6000);
    void tick();
    return () => {
      stop = true;
      clearInterval(h);
    };
  }, [pending, project.id, router]);

  // -1 = パターンごとの専用コピー（2026-11-12〜の既定）。0 以上 = 候補コピーを全パターンに使う
  const hasPatternCopy = project.patterns.some((p) => p.copy);
  const firstOk = Math.max(0, project.copies.findIndex((c) => c.guard?.level !== "red"));
  const [copyIdx, setCopyIdx] = useState(() => (hasPatternCopy ? -1 : firstOk));
  const fallback: BannerCopy | null = project.copies[copyIdx >= 0 ? copyIdx : firstOk] ?? null;
  /** そのパターンで使うコピー（法令チェックで NG のコピーは使わない） */
  const copyFor = (p: BannerPattern | undefined): PatternCopy | null => {
    if (copyIdx < 0 && p?.copy && p.copy.guard?.level !== "red") return p.copy;
    return fallback ? toPatternCopy(fallback) : null;
  };
  const copy = !!fallback || hasPatternCopy;
  const logo = (() => {
    const l = project.materials.find((m) => m.kind === "logo");
    return l ? assetUrl(l.path) : null;
  })();
  const patternOf = (key: string) => project.patterns.find((x) => x.key === key);
  const [reviews, setReviews] = useState<Record<string, BannerReview>>(project.reviews);
  const [checking, setChecking] = useState<string | null>(null);
  const bases = visuals.filter((v) => v.kind === "base");
  const doneBases = bases.filter((v) => v.status === "done");
  const [picked, setPicked] = useState<string[]>([]);
  const [sizes, setSizes] = useState<string[]>(["meta-1x1", "meta-4x5", "meta-9x16", "google-1200x628", "google-300x250"]);
  /** 絵ごとのレイアウトの指定（既定は自動。画面の中だけで覚える） */
  const [layouts, setLayouts] = useState<Record<string, BannerLayout | "auto">>({});
  /** 絵ごとの文字の背景の指定（既定は自動） */
  const [styles, setStyles] = useState<Record<string, TextStyle | "auto">>({});
  const chosenBases = doneBases.filter((b) => picked.includes(b.id));
  const chosenSizes = BANNER_SIZES.filter((s) => sizes.includes(s.id));

  /**
   * そのサイズに使う絵とレイアウト（2026-11-12 改善）。
   * 左右分割・上下分割・文字が主役は、正方形の元の絵をそのまま（余白だけ切って）使う。
   * 写真の上に文字カードを置くレイアウトだけ、写真を全面に敷くので、バナーと同じ縦横比の絵があればそれを使う（無ければ上下・左右分割に切り替わる）
   */
  function visualFor(base: BannerVisual, s: BannerSize): { v: BannerVisual | null; aspect: number; layout: BannerLayout; wantsReframe: boolean; waiting: boolean } {
    const pt = patternOf(base.pattern);
    const want = layouts[base.id] ?? "auto";
    const baseAspect = aspectValue(base.aspect);
    const a = nearestAspect(s.w, s.h);
    const wantsCard = !!pt && resolveLayout(pt, s.w, s.h, s.w / s.h, want) === "card" && a !== base.aspect;
    if (wantsCard) {
      const r = visuals.find((x) => x.kind === "resize" && x.parentId === base.id && x.aspect === a);
      if (r?.status === "done") return { v: r, aspect: aspectValue(a), layout: "card", wantsReframe: false, waiting: false };
      return { v: base, aspect: baseAspect, layout: pt ? resolveLayout(pt, s.w, s.h, baseAspect, want) : "band-bottom", wantsReframe: !r || r.status === "error", waiting: r?.status === "queued" };
    }
    return { v: base, aspect: baseAspect, layout: pt ? resolveLayout(pt, s.w, s.h, baseAspect, want) : "band-bottom", wantsReframe: false, waiting: false };
  }

  /** 文字カードにするために、作り直しが要る（縦横比 → 元の絵） */
  const reframeTodo = (() => {
    const todo = new Map<string, Set<string>>();
    for (const b of chosenBases) for (const s of chosenSizes) if (visualFor(b, s).wantsReframe) todo.set(b.id, (todo.get(b.id) ?? new Set()).add(nearestAspect(s.w, s.h)));
    return todo;
  })();
  const neededResizes = [...reframeTodo.values()].reduce((n, x) => n + x.size, 0);

  async function downloadOne(nodeId: string, name: string) {
    const node = document.getElementById(nodeId);
    if (!node) return;
    const url = await toPng(node, { pixelRatio: 1, cacheBust: true });
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
  }

  async function downloadZip() {
    const zip = new JSZip();
    for (const b of chosenBases) {
      for (const s of chosenSizes) {
        const node = document.getElementById(`bs-${b.id}-${s.id}`);
        if (!node) continue;
        const url = await toPng(node, { pixelRatio: 1, cacheBust: true });
        zip.file(`${s.media}/${s.w}x${s.h}_${b.pattern}.png`, url.split(",")[1], { base64: true });
      }
    }
    const blob = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${project.name || "banners"}.zip`;
    a.click();
  }

  /** AI チェック：表示中のバナーを縮小 PNG にして AI に見せる（1枚 AI 1回） */
  async function check(b: BannerVisual, s: BannerSize) {
    const node = document.getElementById(`bs-${b.id}-${s.id}`);
    if (!node) return;
    const key = `${b.id}:${s.id}`;
    setChecking(key);
    try {
      const scale = Math.min(1, 1000 / Math.max(s.w, s.h));
      const dataUrl = await toPng(node, { pixelRatio: scale, cacheBust: true });
      const r = await reviewBannerAction(project.id, { key, dataUrl, size: `${s.media} ${s.label}`, w: s.w, h: s.h, pattern: b.pattern });
      setReviews((v) => ({ ...v, [key]: r }));
    } finally {
      setChecking(null);
    }
  }

  async function checkAll() {
    for (const b of chosenBases) for (const s of chosenSizes) if (visualFor(b, s).v?.path) await check(b, s);
  }

  return (
    <div style={{ display: "grid", gap: 22 }}>
      <Header project={project} />
      {!usage.falReady && (
        <div className="note warn">
          <i className="i">!</i>
          <span>fal の API キー（FAL_KEY）が未設定のため、絵と動画はまだ作れません。コピーと絵のパターン作りは使えます。</span>
        </div>
      )}
      <small style={{ color: "var(--muted)" }}>
        今月の利用：画像 {usage.images}/{usage.limit.images} 枚・動画 {usage.videos}/{usage.limit.videos} 本（fal の料金の目安：画像 1枚 約${FAL_PRICE.image.toFixed(2)}、動画 5秒 約${FAL_PRICE.video5.toFixed(2)}）
      </small>
      {err && <div className="alert">{err}</div>}

      <InputPanel project={project} busy={busy} run={run} />

      {/* 2. コピーと絵のパターン */}
      <section className="panel">
        <h2>2. コピーと絵のパターン</h2>
        {!d || !project.copies.length || !project.patterns.length ? (
          <>
            <p>入れた URL・説明・素材から、売っているもの・お客様・強みを読み取り、コピー（法令チェックつき）と絵の基本パターン（{PATTERN_COUNT}つ）を作ります（AI を使います）。</p>
            {project.error && <p style={{ color: "var(--ng, #a0472f)" }}>前回は作れませんでした（{project.error}）</p>}
            <p style={{ marginTop: 12 }}>
              <button
                className="btn"
                disabled={!!busy}
                onClick={() =>
                  run("読み取って、コピーと絵のパターンを作っています（1〜2分）", async () => {
                    const r = await prepareBannerAction(project.id);
                    if (!r.ok) throw new Error(r.error);
                  })
                }
              >
                {busy?.startsWith("読み取って") ? <Spinner label={busy} /> : "コピーと絵のパターンを作る"}
              </button>
            </p>
          </>
        ) : (
          <>
            <p style={{ fontSize: 13, color: "var(--muted)" }}>
              {d.product}／{d.audience}
            </p>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
              <b style={{ fontSize: 14 }}>使うコピー</b>
              <button className="btn ghost sm" disabled={!!busy} onClick={() => run("コピーを作り直しています", () => regenerateCopiesAction(project.id))}>
                コピーを作り直す
              </button>
            </div>
            <div className="rows" style={{ marginTop: 8 }}>
              {hasPatternCopy && (
                <div className="r" style={{ alignItems: "flex-start" }}>
                  <input type="radio" checked={copyIdx < 0} onChange={() => setCopyIdx(-1)} style={{ marginTop: 4 }} aria-label="パターンごとの専用コピーを使う" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <b>パターンごとの専用コピー（おすすめ）</b>
                    <small>訴求の型に合わせて、対象・見出し・強調（数字や特典）・CTA を書き分けたもの。下の「絵の基本パターン」で直せます</small>
                  </div>
                </div>
              )}
              {project.copies.map((c, i) => (
                <CopyRow key={i} index={i} c={c} selected={i === copyIdx} onSelect={() => setCopyIdx(i)} projectId={project.id} busy={busy} run={run} />
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 18, flexWrap: "wrap" }}>
              <b style={{ fontSize: 14 }}>絵の基本パターン</b>
              <button
                className="btn ghost sm"
                disabled={!!busy}
                onClick={() => {
                  if (window.confirm("絵のパターンを作り直します（作った絵は残ります）。")) run("パターンを作り直しています", () => regeneratePatternsAction(project.id));
                }}
              >
                パターンを作り直す
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10, marginTop: 8 }}>
              {project.patterns.map((p) => (
                <PatternCard key={p.key} p={p} projectId={project.id} busy={busy} run={run} />
              ))}
            </div>
          </>
        )}
      </section>

      {/* 3. 絵を作る（fal） */}
      {d && project.patterns.length > 0 && copy && (
        <section className="panel">
          <h2>3. 基本パターンの絵</h2>
          <p>
            fal で、パターンごとに正方形の絵を1枚ずつ作ります（文字は入れず、コピーは画面で重ねます）。目安：{project.patterns.length}枚で 約${(FAL_PRICE.image * project.patterns.length).toFixed(2)}。
          </p>
          <p style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn" disabled={!!busy || !usage.falReady} onClick={() => run("fal に依頼しています", () => generateBasesAction(project.id))}>
              {busy === "fal に依頼しています" ? <Spinner label={busy} /> : bases.length ? "まだの絵を作る" : "絵を作る"}
            </button>
            {pending > 0 && <Spinner label={`作成中 ${pending}件（数十秒〜数分）`} />}
          </p>
          {bases.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 14, marginTop: 14 }}>
              {bases.map((b) => {
                const p = project.patterns.find((x) => x.key === b.pattern);
                return (
                  <div key={b.id} style={{ display: "grid", gap: 6 }}>
                    <b style={{ fontSize: 13 }}>
                      {p?.label ?? b.pattern}
                      {p?.archetype && <span className="tag" style={{ marginLeft: 6 }}>{ARCHETYPES[p.archetype].label}</span>}
                    </b>
                    {b.status === "done" && b.path ? (
                      <Scaled w={1080} h={1080} box={250}>
                        {p && copyFor(p) ? (
                          <StudioBanner id={`base-${b.id}`} pattern={p} copy={copyFor(p)!} brand={d.brand} w={1080} h={1080} image={assetUrl(b.path)} logo={logo} layout={layouts[b.id] ?? "auto"} textStyle={styles[b.id] ?? "auto"} />
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={assetUrl(b.path)} alt="" style={{ width: 1080, height: 1080, objectFit: "cover" }} />
                        )}
                      </Scaled>
                    ) : b.status === "queued" ? (
                      <div style={{ width: 250, height: 250, display: "grid", placeItems: "center", background: "#f4f3f0", borderRadius: 6 }}>
                        <Spinner label="作成中" />
                      </div>
                    ) : (
                      <div className="note warn">
                        <i className="i">!</i>
                        <span>{b.error}</span>
                      </div>
                    )}
                    {b.textWarning && <small style={{ color: "#a0472f" }}>{b.textWarning}</small>}
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {b.status === "done" && (
                        <label style={{ fontSize: 13, display: "flex", gap: 4, alignItems: "center" }}>
                          <input type="checkbox" checked={picked.includes(b.id)} onChange={(e) => setPicked((v) => (e.target.checked ? [...v, b.id] : v.filter((x) => x !== b.id)))} />
                          サイズ展開に使う
                        </label>
                      )}
                      <button
                        className="btn ghost sm"
                        disabled={!!busy}
                        onClick={() => {
                          if (window.confirm("この絵を削除します（サイズ違い・動画も消えます）。")) run("削除しています", () => deleteVisualAction(b.id));
                        }}
                      >
                        削除
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {bases.some((b) => b.status === "error") && (
            <p style={{ marginTop: 10 }}>
              <small style={{ color: "var(--muted)" }}>作れなかった絵は削除してから「まだの絵を作る」でやり直せます。</small>
            </p>
          )}
        </section>
      )}

      {/* 4. サイズ展開 */}
      {d && copy && doneBases.length > 0 && (
        <section className="panel">
          <h2>4. 媒体のサイズに展開</h2>
          <p>使う絵を上で選び、媒体のサイズを選んでください。写真と文字は面を分けて置き（左右・上下）、正方形の絵をそのまま使うので、fal の追加の費用はかかりません。「写真の上に文字カード」を縦長・横長で使うときだけ、その縦横比の絵を作り直せます。</p>
          <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
            {[...new Set(BANNER_SIZES.map((s) => s.media))].map((m) => (
              <div key={m} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", fontSize: 13 }}>
                <b style={{ width: 64 }}>{m}</b>
                {BANNER_SIZES.filter((s) => s.media === m).map((s) => (
                  <label key={s.id} style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    <input type="checkbox" checked={sizes.includes(s.id)} onChange={(e) => setSizes((v) => (e.target.checked ? [...v, s.id] : v.filter((x) => x !== s.id)))} />
                    {s.label} {s.w}×{s.h}
                  </label>
                ))}
              </div>
            ))}
          </div>
          <p style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {neededResizes > 0 && (
              <button
                className="btn"
                disabled={!!busy || !usage.falReady || !chosenBases.length}
                onClick={() =>
                  run("fal に依頼しています", async () => {
                    for (const [baseId, aspects] of reframeTodo) await resizeVisualAction(project.id, baseId, [...aspects]);
                  })
                }
              >
                文字カード用に縦横比の違う絵を作る（{neededResizes}枚・約${(FAL_PRICE.image * neededResizes).toFixed(2)}）
              </button>
            )}
            {chosenBases.length > 0 && chosenSizes.length > 0 && (
              <button className="btn ghost" disabled={!!busy} onClick={() => run("書き出しています", downloadZip)}>
                できたものをまとめて保存（ZIP）
              </button>
            )}
            {chosenBases.length > 0 && chosenSizes.length > 0 && (
              <button className="btn ghost" disabled={!!busy || !!checking} onClick={() => run("AI がチェックしています", checkAll)}>
                {busy === "AI がチェックしています" ? <Spinner label={busy} /> : "表示中を AI でチェック"}
              </button>
            )}
          </p>
          {!chosenBases.length && <small style={{ color: "var(--muted)" }}>「3. 基本パターンの絵」で「サイズ展開に使う」に印を付けてください。</small>}
          <div style={{ display: "grid", gap: 18, marginTop: 14 }}>
            {chosenBases.map((b) => (
              <div key={b.id}>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <p className="eyebrow" style={{ margin: 0 }}>
                    {patternOf(b.pattern)?.label ?? b.pattern}
                  </p>
                  <select
                    className="input"
                    style={{ width: "auto", fontSize: 13 }}
                    value={layouts[b.id] ?? "auto"}
                    onChange={(e) => setLayouts((v) => ({ ...v, [b.id]: e.target.value as BannerLayout | "auto" }))}
                    aria-label="レイアウト"
                  >
                    <option value="auto">レイアウト：自動（型とサイズに合わせる）</option>
                    {(Object.keys(LAYOUT_LABEL) as BannerLayout[]).map((k) => (
                      <option key={k} value={k}>
                        {LAYOUT_LABEL[k]}
                      </option>
                    ))}
                  </select>
                  <select
                    className="input"
                    style={{ width: "auto", fontSize: 13 }}
                    value={styles[b.id] ?? "auto"}
                    onChange={(e) => setStyles((v) => ({ ...v, [b.id]: e.target.value as TextStyle | "auto" }))}
                    aria-label="文字の背景"
                  >
                    <option value="auto">文字の背景：自動（型に合わせる）</option>
                    {(Object.keys(STYLE_LABEL) as TextStyle[]).map((k) => (
                      <option key={k} value={k}>
                        {STYLE_LABEL[k]}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 8 }}>
                  {chosenSizes.map((s) => {
                    const { v, waiting, aspect, layout, wantsReframe } = visualFor(b, s);
                    const pt = patternOf(b.pattern);
                    const pc = copyFor(pt);
                    const key = `${b.id}:${s.id}`;
                    const rv = reviews[key];
                    return (
                      <div key={s.id} style={{ display: "grid", gap: 4 }}>
                        {v?.path && pt && pc ? (
                          <Scaled w={s.w} h={s.h} box={220}>
                            <StudioBanner id={`bs-${b.id}-${s.id}`} pattern={pt} copy={pc} brand={d.brand} w={s.w} h={s.h} image={assetUrl(v.path)} imageAspect={aspect} logo={logo} layout={layout} textStyle={styles[b.id] ?? "auto"} />
                          </Scaled>
                        ) : (
                          <div style={{ width: 160, height: 120, display: "grid", placeItems: "center", background: "#f4f3f0", borderRadius: 6, fontSize: 12, color: "var(--muted)", textAlign: "center", padding: 8 }}>
                            {waiting ? <Spinner label="絵を作成中" /> : "縦横比の違う絵がまだありません"}
                          </div>
                        )}
                        <small>
                          {s.media} {s.w}×{s.h}・{LAYOUT_LABEL[layout]}
                          {pt ? `・${STYLE_LABEL[resolveStyle(pt, layout, styles[b.id] ?? "auto")]}` : ""}
                        </small>
                        {(wantsReframe || waiting) && <small style={{ color: "var(--muted)" }}>{waiting ? "文字カード用の絵を作成中" : "文字カードにするには、上のボタンで絵を作ります"}</small>}
                        {v?.path && (
                          <div style={{ display: "flex", gap: 10 }}>
                            <button className="link" onClick={() => downloadOne(`bs-${b.id}-${s.id}`, `${s.media}_${s.w}x${s.h}_${b.pattern}.png`)}>
                              保存
                            </button>
                            <button className="link" disabled={!!checking || !!busy} onClick={() => check(b, s).catch((e) => setErr(errText(e)))}>
                              {checking === key ? "チェック中…" : rv ? "もう一度チェック" : "AI チェック"}
                            </button>
                          </div>
                        )}
                        {rv && <ReviewView r={rv} />}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 5. 動画 */}
      {d && copy && doneBases.length > 0 && (
        <VideoPanel
          project={project}
          visuals={visuals}
          copyFor={(key) => {
            const c = copyFor(patternOf(key));
            return c ? fromPatternCopy(c) : null;
          }}
          usageReady={usage.falReady}
          busy={busy}
          run={run}
          setErr={setErr}
        />
      )}
    </div>
  );
}

function Header({ project }: { project: BannerProject }) {
  const router = useRouter();
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h2 style={{ fontSize: 20 }}>{project.name || "（名称未設定）"}</h2>
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>広告運用 ＞ バナー制作</p>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <Link className="btn ghost sm" href="/ads/banners">
          一覧へ
        </Link>
        <button
          className="btn ghost sm"
          onClick={async () => {
            if (!window.confirm("この制作を削除します。素材・絵・動画も消えます。よろしいですか？")) return;
            await deleteBannerProjectAction(project.id).catch(() => undefined);
            router.push("/ads/banners");
          }}
        >
          削除
        </button>
      </div>
    </div>
  );
}

function InputPanel({ project, busy, run }: { project: BannerProject; busy: string | null; run: (l: string, f: () => Promise<unknown>) => Promise<void> }) {
  const [name, setName] = useState(project.name);
  const [url, setUrl] = useState(project.url);
  const [desc, setDesc] = useState(project.description);
  const [kind, setKind] = useState("product");
  const [file, setFile] = useState<File | null>(null);
  const dirty = name !== project.name || url !== project.url || desc !== project.description;
  return (
    <section className="panel">
      <h2>1. 商品・サービスと素材</h2>
      <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
        <input className="input" placeholder="名前（例：〇〇 初回限定）" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input" placeholder="LP・サイトの URL（任意）" value={url} onChange={(e) => setUrl(e.target.value)} />
        <textarea className="input" rows={4} placeholder="商品・サービスの説明（誰に・何を・強み・価格や条件など。URL が無いときは必須）" value={desc} onChange={(e) => setDesc(e.target.value)} />
        {dirty && (
          <div>
            <button className="btn sm" disabled={!!busy} onClick={() => run("保存しています", () => updateBannerInputAction(project.id, { name, url, description: desc }))}>
              保存する（URL・説明を変えると、コピーと絵のパターンは作り直しになります）
            </button>
          </div>
        )}
      </div>
      <p className="eyebrow" style={{ marginTop: 16 }}>
        素材（任意・6点まで）
      </p>
      <small style={{ color: "var(--muted)", display: "block" }}>商品写真を入れると、その商品をそのまま使った絵を作ります（商品の形・色・ラベルは変えないよう指示します）。</small>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
        {project.materials.map((m) => (
          <div key={m.path} style={{ display: "grid", gap: 4, justifyItems: "center" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={assetUrl(m.path)} alt={m.name} style={{ width: 90, height: 90, objectFit: "cover", borderRadius: 6, border: "1px solid var(--line)" }} />
            <small>{m.kind === "product" ? "商品写真" : m.kind === "logo" ? "ロゴ" : "写真"}</small>
            <button className="link" disabled={!!busy} onClick={() => run("削除しています", () => deleteMaterialAction(project.id, m.path))}>
              削除
            </button>
          </div>
        ))}
      </div>
      {project.materials.length < 6 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
          <select className="input" style={{ width: "auto" }} value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="product">商品写真</option>
            <option value="photo">写真（店舗・人・使用シーン）</option>
            <option value="logo">ロゴ（絵には使わず参考のみ）</option>
          </select>
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <button
            className="btn sm"
            disabled={!!busy || !file}
            onClick={() =>
              run("素材を取り込んでいます", async () => {
                if (!file) return;
                const f = await shrink(file);
                const form = new FormData();
                form.set("file", f);
                form.set("kind", kind);
                form.set("name", file.name);
                await uploadMaterialAction(project.id, form);
                setFile(null);
              })
            }
          >
            取り込む
          </button>
        </div>
      )}
    </section>
  );
}

function CopyRow({
  index,
  c,
  selected,
  onSelect,
  projectId,
  busy,
  run,
}: {
  index: number;
  c: BannerCopy;
  selected: boolean;
  onSelect: () => void;
  projectId: string;
  busy: string | null;
  run: (l: string, f: () => Promise<unknown>) => Promise<void>;
}) {
  const [edit, setEdit] = useState(false);
  const [h1, setH1] = useState(c.headline[0]);
  const [h2, setH2] = useState(c.headline[1]);
  const [rt, setRt] = useState(c.ribbonTop ?? "");
  const [cta, setCta] = useState(c.cta);
  const level = c.guard?.level ?? "green";
  return (
    <div className="r" style={{ alignItems: "flex-start", opacity: level === "red" ? 0.6 : 1 }}>
      <input type="radio" checked={selected} disabled={level === "red"} onChange={onSelect} style={{ marginTop: 4 }} aria-label="このコピーを使う" />
      <div style={{ flex: 1, minWidth: 0 }}>
        {edit ? (
          <div style={{ display: "grid", gap: 6 }}>
            <input className="input" value={h1} onChange={(e) => setH1(e.target.value)} placeholder="見出し1行目" />
            <input className="input" value={h2} onChange={(e) => setH2(e.target.value)} placeholder="見出し2行目" />
            <input className="input" value={rt} onChange={(e) => setRt(e.target.value)} placeholder="条件・限定（任意）" />
            <input className="input" value={cta} onChange={(e) => setCta(e.target.value)} placeholder="ボタンの文言" />
            <div style={{ display: "flex", gap: 6 }}>
              <button
                className="btn sm"
                disabled={!!busy}
                onClick={() =>
                  run("法令チェックをかけて保存しています", async () => {
                    await editCopyAction(projectId, index, { headline: [h1, h2], ribbonTop: rt, ribbonBottom: c.ribbonBottom, body: c.body, cta });
                    setEdit(false);
                  })
                }
              >
                保存（法令チェック）
              </button>
              <button className="btn ghost sm" onClick={() => setEdit(false)}>
                やめる
              </button>
            </div>
          </div>
        ) : (
          <>
            <b>{c.headline.join(" ")}</b>
            <small>
              {c.ribbonTop ? `${c.ribbonTop}／` : ""}ボタン：{c.cta}
            </small>
          </>
        )}
        {c.guard && c.guard.hits.length > 0 && <small style={{ display: "block", color: "#a0472f" }}>{c.guard.hits.map((h) => `「${h.text}」${h.reason ?? ""}`).join("　")}</small>}
      </div>
      <span className={`tag${level === "red" ? " warn" : level === "yellow" ? " warn" : " ok"}`}>{GUARD_LABEL[level]}</span>
      {!edit && (
        <button className="btn ghost sm" onClick={() => setEdit(true)}>
          直す
        </button>
      )}
    </div>
  );
}

function VideoPanel({
  project,
  visuals,
  copyFor,
  usageReady,
  busy,
  run,
  setErr,
}: {
  project: BannerProject;
  visuals: BannerVisual[];
  copyFor: (patternKey: string) => BannerCopy | null;
  usageReady: boolean;
  busy: string | null;
  run: (l: string, f: () => Promise<unknown>) => Promise<void>;
  setErr: (s: string | null) => void;
}) {
  const d = project.diagnosis!;
  const sources = visuals.filter((v) => (v.kind === "base" || v.kind === "resize") && v.status === "done" && VIDEO_ASPECTS.some((a) => a.aspect === v.aspect));
  const videos = visuals.filter((v) => v.kind === "video");
  const [progress, setProgress] = useState<Record<string, number>>({});
  const label = (v: BannerVisual) => `${project.patterns.find((x) => x.key === v.pattern)?.label ?? v.pattern}（${VIDEO_ASPECTS.find((a) => a.aspect === v.aspect)?.label ?? v.aspect}）`;

  async function exportVideo(v: BannerVisual) {
    const why = canRenderBannerVideo();
    if (why) return setErr(why);
    const a = VIDEO_ASPECTS.find((x) => x.aspect === v.aspect) ?? VIDEO_ASPECTS[0];
    setProgress((p) => ({ ...p, [v.id]: 0 }));
    try {
      const copy = copyFor(v.pattern);
      if (!copy) throw new Error("使えるコピーがありません");
      const blob = await renderBannerVideo({ src: assetUrl(v.path!), width: a.w, height: a.h, copy, brand: d.brand }, (r) => setProgress((p) => ({ ...p, [v.id]: r })));
      const el = document.createElement("a");
      el.href = URL.createObjectURL(blob);
      el.download = `${project.name || "video"}_${v.aspect.replace(":", "x")}_${v.pattern}.mp4`;
      el.click();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setProgress((p) => {
        const n = { ...p };
        delete n[v.id];
        return n;
      });
    }
  }

  return (
    <section className="panel">
      <h2>5. 短い動画（5秒）</h2>
      <p>
        絵を fal で5秒の動画にします（文字なし）。できた動画に、選んだコピーを重ねて MP4 で書き出します（パソコンの Chrome）。目安：1本 約${FAL_PRICE.video5.toFixed(2)}。縦・横の動画にしたいときは、先に「4. 媒体のサイズに展開」でその縦横比の絵を作ってください（9:16・4:5・16:9）。
      </p>
      <div className="rows" style={{ marginTop: 10 }}>
        {sources.map((s) => (
          <div className="r" key={s.id}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <b>{label(s)}</b>
            </div>
            <button
              className="btn ghost sm"
              disabled={!!busy || !usageReady || videos.some((v) => v.parentId === s.id && v.status === "queued")}
              onClick={() => run("fal に動画を依頼しています", () => makeVideoAction(project.id, s.id))}
            >
              {videos.some((v) => v.parentId === s.id && v.status === "queued") ? "作成中" : "動画にする"}
            </button>
          </div>
        ))}
      </div>
      {videos.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14, marginTop: 14 }}>
          {videos.map((v) => (
            <div key={v.id} style={{ display: "grid", gap: 6 }}>
              <b style={{ fontSize: 13 }}>{label(v)}</b>
              {v.status === "done" && v.path ? (
                <video src={assetUrl(v.path)} controls muted playsInline loop style={{ width: "100%", maxHeight: 360, background: "#000", borderRadius: 6 }} />
              ) : v.status === "queued" ? (
                <div style={{ height: 160, display: "grid", placeItems: "center", background: "#f4f3f0", borderRadius: 6 }}>
                  <Spinner label="動画を作成中（1〜5分）" />
                </div>
              ) : (
                <div className="note warn">
                  <i className="i">!</i>
                  <span>{v.error}</span>
                </div>
              )}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {v.status === "done" && (
                  <button className="btn sm" disabled={v.id in progress} onClick={() => exportVideo(v)}>
                    {v.id in progress ? `書き出し中 ${Math.round((progress[v.id] ?? 0) * 100)}%` : "コピーを重ねて書き出す（MP4）"}
                  </button>
                )}
                <button
                  className="btn ghost sm"
                  disabled={!!busy}
                  onClick={() => {
                    if (window.confirm("この動画を削除します。")) run("削除しています", () => deleteVisualAction(v.id));
                  }}
                >
                  削除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ReviewView({ r }: { r: BannerReview }) {
  const [open, setOpen] = useState(false);
  const ng = r.checks.filter((c) => !c.ok);
  const tone = r.score >= 75 ? "ok" : r.score >= 60 ? "" : " warn";
  return (
    <div style={{ maxWidth: 240, fontSize: 12 }}>
      <button className="link" onClick={() => setOpen((v) => !v)} style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <span className={`tag${tone ? ` ${tone.trim()}` : ""}`}>AI チェック {r.score}点</span>
        {ng.length > 0 && <span style={{ color: "#a0472f" }}>要改善 {ng.length}</span>}
      </button>
      {open && (
        <div style={{ marginTop: 4, display: "grid", gap: 3 }}>
          {r.checks.map((c, i) => (
            <div key={i} style={{ color: c.ok ? "var(--muted)" : "#a0472f" }}>
              {c.ok ? "○" : "×"} {c.item}
              {!c.ok && c.note ? `：${c.note}` : ""}
            </div>
          ))}
          {r.fixes.length > 0 && (
            <div style={{ marginTop: 4 }}>
              <b>直し方</b>
              {r.fixes.map((f, i) => (
                <div key={i}>・{f}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PatternCard({ p, projectId, busy, run }: { p: BannerPattern; projectId: string; busy: string | null; run: (l: string, f: () => Promise<unknown>) => Promise<void> }) {
  const [edit, setEdit] = useState(false);
  const c = p.copy;
  const [f, setF] = useState<Omit<PatternCopy, "guard">>(() => ({
    target: c?.target ?? "",
    headline: c?.headline ?? ["", ""],
    emphasis: c?.emphasis ?? "",
    emphasisLabel: c?.emphasisLabel ?? "",
    sub: c?.sub ?? "",
    cta: c?.cta ?? "",
  }));
  const level = c?.guard?.level ?? "green";
  const field = (k: "target" | "emphasis" | "emphasisLabel" | "sub" | "cta", ph: string) => (
    <input className="input" value={f[k]} placeholder={ph} onChange={(e) => setF((v) => ({ ...v, [k]: e.target.value }))} />
  );
  return (
    <div className="tactic">
      <div className="top" style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <b>{p.label}</b>
        {p.archetype && <span className="tag">{ARCHETYPES[p.archetype].label}</span>}
        {p.useMaterials && <span className="tag">素材を使う</span>}
      </div>
      <small style={{ display: "block", color: "var(--muted)" }}>{p.concept}</small>
      {c && !edit && (
        <div style={{ marginTop: 6, fontSize: 13 }}>
          {c.target && <div style={{ color: "var(--muted)" }}>{c.target}</div>}
          <b>{c.headline.join(" ")}</b>
          {c.emphasis && (
            <div>
              強調：{c.emphasis}
              {c.emphasisLabel ? `（${c.emphasisLabel}）` : ""}
            </div>
          )}
          {c.sub && <div style={{ color: "var(--muted)" }}>{c.sub}</div>}
          <div>ボタン：{c.cta}</div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4 }}>
            <span className={`tag${level === "green" ? " ok" : " warn"}`}>{GUARD_LABEL[level]}</span>
            <button className="btn ghost sm" onClick={() => setEdit(true)}>
              直す
            </button>
          </div>
          {c.guard && c.guard.hits.length > 0 && (
            <small style={{ display: "block", color: "#a0472f" }}>{c.guard.hits.map((h) => `「${h.text}」${h.reason ?? ""}`).join("　")}</small>
          )}
          {level === "red" && <small style={{ display: "block", color: "#a0472f" }}>NG のため、このパターンには候補コピーを使います。直すと使えるようになります。</small>}
        </div>
      )}
      {c && edit && (
        <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
          {field("target", "対象（例：40代の乾燥肌の方へ）")}
          <input className="input" value={f.headline[0]} placeholder="見出し1行目" onChange={(e) => setF((v) => ({ ...v, headline: [e.target.value, v.headline[1]] }))} />
          <input className="input" value={f.headline[1]} placeholder="見出し2行目" onChange={(e) => setF((v) => ({ ...v, headline: [v.headline[0], e.target.value] }))} />
          {field("emphasis", "強調（数字・特典。事実だけ）")}
          {field("emphasisLabel", "強調の説明")}
          {field("sub", "補足")}
          {field("cta", "ボタンの文言")}
          <div style={{ display: "flex", gap: 6 }}>
            <button
              className="btn sm"
              disabled={!!busy}
              onClick={() =>
                run("法令チェックをかけて保存しています", async () => {
                  await editPatternCopyAction(projectId, p.key, f);
                  setEdit(false);
                })
              }
            >
              保存（法令チェック）
            </button>
            <button className="btn ghost sm" onClick={() => setEdit(false)}>
              やめる
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
