"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toPng } from "html-to-image";
import JSZip from "jszip";
import { Spinner } from "@/components/Loading";
import { Banner, pickFacts } from "@/components/Banner";
import type { SizePreset } from "@/lib/sizes";
import type { BannerCopy } from "@/lib/types";
import {
  deleteBannerProjectAction,
  deleteMaterialAction,
  deleteVisualAction,
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
  BANNER_SIZES,
  FAL_PRICE,
  PATTERN_COUNT,
  VIDEO_ASPECTS,
  assetUrl,
  nearestAspect,
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

  const [copyIdx, setCopyIdx] = useState(() => Math.max(0, project.copies.findIndex((c) => c.guard?.level !== "red")));
  const copy: BannerCopy | null = project.copies[copyIdx] ?? null;
  const bases = visuals.filter((v) => v.kind === "base");
  const doneBases = bases.filter((v) => v.status === "done");
  const [picked, setPicked] = useState<string[]>([]);
  const [sizes, setSizes] = useState<string[]>(["meta-1x1", "meta-4x5", "meta-9x16", "google-1200x628", "google-300x250"]);
  const [cropOnly, setCropOnly] = useState(false);
  const chosenBases = doneBases.filter((b) => picked.includes(b.id));
  const chosenSizes = BANNER_SIZES.filter((s) => sizes.includes(s.id));
  const service = d ? (d.product.split(/[。、（(]/)[0] ?? "").trim().slice(0, 14) : "";
  const facts = d ? pickFacts(d.strengths) : [];

  /** そのサイズに使う絵（同じ縦横比の作り直しがあればそれ、無ければ元の絵を切り抜く） */
  function visualFor(base: BannerVisual, s: BannerSize): { v: BannerVisual | null; waiting: boolean } {
    const a = nearestAspect(s.w, s.h);
    if (cropOnly || a === base.aspect) return { v: base, waiting: false };
    const r = visuals.find((x) => x.kind === "resize" && x.parentId === base.id && x.aspect === a);
    if (r?.status === "done") return { v: r, waiting: false };
    return { v: null, waiting: r?.status === "queued" };
  }

  const neededResizes = (() => {
    if (cropOnly) return 0;
    let n = 0;
    for (const b of chosenBases) {
      const aspects = new Set(chosenSizes.map((s) => nearestAspect(s.w, s.h)).filter((a) => a !== b.aspect));
      for (const a of aspects) if (!visuals.some((x) => x.kind === "resize" && x.parentId === b.id && x.aspect === a && x.status !== "error")) n++;
    }
    return n;
  })();

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
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10, marginTop: 8 }}>
              {project.patterns.map((p) => (
                <div className="tactic" key={p.key}>
                  <div className="top">
                    <b>{p.label}</b>
                    {p.useMaterials && <span className="tag" style={{ marginLeft: 6 }}>素材を使う</span>}
                  </div>
                  <small style={{ display: "block", color: "var(--muted)" }}>{p.concept}</small>
                </div>
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
                    <b style={{ fontSize: 13 }}>{p?.label ?? b.pattern}</b>
                    {b.status === "done" && b.path ? (
                      <Scaled w={1080} h={1080} box={250}>
                        <Banner id={`base-${b.id}`} copy={copy} brand={d.brand} size={{ id: "p", label: "", media: "Meta", w: 1080, h: 1080 }} image={assetUrl(b.path)} layout="overlay" textZone="bottom" service={service} facts={facts} />
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
          <p>使う絵を上で選び、媒体のサイズを選んでください。縦横比が違うサイズは、fal で元の絵を保ったまま作り直してから、文字を組み直します（「切り抜きだけ」にすると fal を使わず、正方形の絵を切り抜きます）。</p>
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
          <label style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 10, fontSize: 13 }}>
            <input type="checkbox" checked={cropOnly} onChange={(e) => setCropOnly(e.target.checked)} />
            切り抜きだけで作る（fal を使わない。縦長・横長では絵の端が切れます）
          </label>
          <p style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {!cropOnly && neededResizes > 0 && (
              <button
                className="btn"
                disabled={!!busy || !usage.falReady || !chosenBases.length}
                onClick={() =>
                  run("fal に依頼しています", async () => {
                    for (const b of chosenBases) {
                      const aspects = [...new Set(chosenSizes.map((s) => nearestAspect(s.w, s.h)))];
                      await resizeVisualAction(project.id, b.id, aspects);
                    }
                  })
                }
              >
                縦横比の違う絵を作る（{neededResizes}枚・約${(FAL_PRICE.image * neededResizes).toFixed(2)}）
              </button>
            )}
            {chosenBases.length > 0 && chosenSizes.length > 0 && (
              <button className="btn ghost" disabled={!!busy} onClick={() => run("書き出しています", downloadZip)}>
                できたものをまとめて保存（ZIP）
              </button>
            )}
          </p>
          {!chosenBases.length && <small style={{ color: "var(--muted)" }}>「3. 基本パターンの絵」で「サイズ展開に使う」に印を付けてください。</small>}
          <div style={{ display: "grid", gap: 18, marginTop: 14 }}>
            {chosenBases.map((b) => (
              <div key={b.id}>
                <p className="eyebrow">{project.patterns.find((x) => x.key === b.pattern)?.label ?? b.pattern}</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 8 }}>
                  {chosenSizes.map((s) => {
                    const { v, waiting } = visualFor(b, s);
                    return (
                      <div key={s.id} style={{ display: "grid", gap: 4 }}>
                        {v?.path ? (
                          <Scaled w={s.w} h={s.h} box={220}>
                            <Banner id={`bs-${b.id}-${s.id}`} copy={copy} brand={d.brand} size={s as unknown as SizePreset} image={assetUrl(v.path)} layout="overlay" textZone="bottom" service={service} facts={facts} />
                          </Scaled>
                        ) : (
                          <div style={{ width: 160, height: 120, display: "grid", placeItems: "center", background: "#f4f3f0", borderRadius: 6, fontSize: 12, color: "var(--muted)", textAlign: "center", padding: 8 }}>
                            {waiting ? <Spinner label="絵を作成中" /> : "縦横比の違う絵がまだありません"}
                          </div>
                        )}
                        <small>
                          {s.media} {s.w}×{s.h}
                        </small>
                        {v?.path && (
                          <button className="link" onClick={() => downloadOne(`bs-${b.id}-${s.id}`, `${s.media}_${s.w}x${s.h}_${b.pattern}.png`)}>
                            保存
                          </button>
                        )}
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
      {d && copy && doneBases.length > 0 && <VideoPanel project={project} visuals={visuals} copy={copy} usageReady={usage.falReady} busy={busy} run={run} setErr={setErr} />}
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
  copy,
  usageReady,
  busy,
  run,
  setErr,
}: {
  project: BannerProject;
  visuals: BannerVisual[];
  copy: BannerCopy;
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
