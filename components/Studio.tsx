"use client";

import { useEffect, useState } from "react";
import { toPng } from "html-to-image";
import JSZip from "jszip";
import { runCopies, runDiagnosis, runLp } from "@/app/actions";
import { SIZES } from "@/lib/sizes";
import type { BannerCopy, Diagnosis, GuardVerdict } from "@/lib/types";
import { INDUSTRY_LABEL } from "@/lib/types";
import { Banner } from "./Banner";

const STORE = "airex-studio-v1";

type Saved = { d?: Diagnosis; copies?: BannerCopy[] };

export function Studio() {
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [d, setD] = useState<Diagnosis | null>(null);
  const [copies, setCopies] = useState<BannerCopy[]>([]);
  const [picked, setPicked] = useState<number[]>([]);
  const [sizes, setSizes] = useState<string[]>(["meta-1x1", "meta-4x5", "google-lb"]);
  const [lp, setLp] = useState<{ html: string; guard: GuardVerdict } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) {
        const s: Saved = JSON.parse(raw);
        if (s.d) setD(s.d);
        if (s.copies) setCopies(s.copies);
      }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify({ d: d ?? undefined, copies } satisfies Saved));
    } catch {}
  }, [d, copies]);

  async function guarded(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const chosen = picked.map((i) => copies[i]).filter(Boolean);
  const chosenSizes = SIZES.filter((s) => sizes.includes(s.id));

  async function download(nodeId: string, name: string) {
    const node = document.getElementById(nodeId);
    if (!node) return;
    const dataUrl = await toPng(node, { pixelRatio: 1, cacheBust: true });
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = name;
    a.click();
  }

  async function downloadZip() {
    const zip = new JSZip();
    for (const [ci, c] of chosen.entries()) {
      for (const s of chosenSizes) {
        const node = document.getElementById(`bn-${ci}-${s.id}`);
        if (!node) continue;
        const dataUrl = await toPng(node, { pixelRatio: 1, cacheBust: true });
        zip.file(`${s.media}/${s.w}x${s.h}_${ci + 1}.png`, dataUrl.split(",")[1], { base64: true });
      }
    }
    if (lp) zip.file("lp/index.html", lp.html);
    const blob = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "airex-creative.zip";
    a.click();
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 text-neutral-900">
      <header className="mb-8">
        <h1 className="text-2xl font-black tracking-tight">AI-REX Studio</h1>
        <p className="mt-1 text-sm text-neutral-600">
          URLを入れると、訴求軸 → コピー → 法令チェック → バナー → LP まで一気に作ります。
        </p>
      </header>

      {err && (
        <div className="mb-6 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{err}</div>
      )}

      {/* 1. 診断 */}
      <Section n={1} title="診断">
        <div className="flex flex-col gap-3">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/lp"
            className="w-full rounded-lg border border-neutral-300 px-4 py-3 text-sm"
          />
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="（任意）商品説明・補足。URLが無い場合はここだけでも可"
            rows={3}
            className="w-full rounded-lg border border-neutral-300 px-4 py-3 text-sm"
          />
          <button
            onClick={() =>
              guarded("診断中", async () => {
                const res = await runDiagnosis({ url: url || undefined, text: text || undefined });
                setD(res);
                setCopies([]);
                setPicked([]);
                setLp(null);
              })
            }
            disabled={!!busy}
            className="w-fit rounded-full bg-neutral-900 px-6 py-2.5 text-sm font-bold text-white disabled:opacity-40"
          >
            {busy === "診断中" ? "診断中…" : "診断する"}
          </button>
        </div>

        {d && (
          <div className="mt-6 grid gap-4 rounded-xl border border-neutral-200 bg-neutral-50 p-5 text-sm md:grid-cols-2">
            <Field label="商材">{d.product}</Field>
            <Field label="ターゲット">{d.audience}</Field>
            <Field label="業種（表現規制）">{INDUSTRY_LABEL[d.industry]}</Field>
            <Field label="ブランド色">
              <span className="inline-flex items-center gap-2">
                <span className="inline-block h-4 w-4 rounded" style={{ background: d.brand.accent }} />
                <input
                  value={d.brand.accent}
                  onChange={(e) => setD({ ...d, brand: { ...d.brand, accent: e.target.value } })}
                  className="w-24 rounded border border-neutral-300 px-2 py-1"
                />
              </span>
            </Field>
            <Field label="強み">{d.strengths.join(" / ")}</Field>
            <Field label="買わない理由">{d.objections.join(" / ")}</Field>
            <div className="md:col-span-2">
              <div className="text-xs font-bold text-neutral-500">訴求軸</div>
              <ul className="mt-2 grid gap-2 md:grid-cols-2">
                {d.angles.map((a) => (
                  <li key={a.id} className="rounded-lg border border-neutral-200 bg-white px-3 py-2">
                    <b>{a.name}</b>
                    <span className="block text-xs text-neutral-500">{a.why}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </Section>

      {/* 2. コピー */}
      {d && (
        <Section n={2} title="コピー生成・法令チェック">
          <button
            onClick={() =>
              guarded("コピー生成中", async () => {
                const res = await runCopies(d, 2);
                setCopies(res);
                setPicked(res.map((_, i) => i).slice(0, 3));
              })
            }
            disabled={!!busy}
            className="rounded-full bg-neutral-900 px-6 py-2.5 text-sm font-bold text-white disabled:opacity-40"
          >
            {busy === "コピー生成中" ? "生成中…" : `訴求軸 ${d.angles.length} 本 × 2案を作る`}
          </button>

          {copies.length > 0 && (
            <ul className="mt-5 grid gap-3">
              {[...copies.entries()]
                .sort((a, b) => (b[1].score ?? 0) - (a[1].score ?? 0))
                .map(([i, c]) => (
                  <li
                    key={i}
                    className={`rounded-xl border p-4 ${picked.includes(i) ? "border-neutral-900 bg-white" : "border-neutral-200 bg-neutral-50"}`}
                  >
                    <label className="flex cursor-pointer items-start gap-3">
                      <input
                        type="checkbox"
                        checked={picked.includes(i)}
                        onChange={(e) =>
                          setPicked((p) => (e.target.checked ? [...p, i] : p.filter((x) => x !== i)))
                        }
                        className="mt-1"
                      />
                      <div className="flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <b className="text-base">{c.headline.join("")}</b>
                          <GuardBadge g={c.guard} />
                          {typeof c.score === "number" && (
                            <span className="rounded-full bg-neutral-900 px-2 py-0.5 text-xs font-bold text-white">
                              勝ち筋 {c.score}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-sm text-neutral-600">{c.body}</p>
                        <p className="mt-1 text-xs text-neutral-500">
                          {c.ribbonTop} / {c.ribbonBottom} / CTA: {c.cta}
                        </p>
                        {c.scoreReason && <p className="mt-1 text-xs text-neutral-500">評価: {c.scoreReason}</p>}
                        {c.guard && c.guard.hits.length > 0 && (
                          <ul className="mt-2 space-y-1 text-xs text-red-700">
                            {c.guard.hits.map((h, k) => (
                              <li key={k}>
                                「{h.text}」— {h.law}：{h.reason} → {h.suggestion}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </label>
                  </li>
                ))}
            </ul>
          )}
        </Section>
      )}

      {/* 3. バナー */}
      {d && chosen.length > 0 && (
        <Section n={3} title="バナー書き出し">
          <div className="flex flex-wrap gap-2">
            {SIZES.map((s) => (
              <button
                key={s.id}
                onClick={() =>
                  setSizes((v) => (v.includes(s.id) ? v.filter((x) => x !== s.id) : [...v, s.id]))
                }
                className={`rounded-full border px-3 py-1.5 text-xs font-bold ${
                  sizes.includes(s.id) ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300"
                }`}
              >
                {s.media} {s.w}×{s.h}
              </button>
            ))}
          </div>

          <div className="mt-3 text-xs text-neutral-500">
            選択 {chosen.length} 案 × {chosenSizes.length} サイズ ＝ {chosen.length * chosenSizes.length} 枚
          </div>

          <button
            onClick={() => guarded("ZIP作成中", downloadZip)}
            disabled={!!busy}
            className="mt-3 rounded-full bg-neutral-900 px-6 py-2.5 text-sm font-bold text-white disabled:opacity-40"
          >
            {busy === "ZIP作成中" ? "書き出し中…" : "全部まとめてZIPで保存"}
          </button>

          <div className="mt-6 space-y-8">
            {chosen.map((c, ci) => (
              <div key={ci}>
                <div className="mb-2 text-sm font-bold">{c.headline.join("")}</div>
                <div className="flex flex-wrap gap-6">
                  {chosenSizes.map((s) => {
                    const scale = Math.min(240 / s.w, 300 / s.h);
                    return (
                      <div key={s.id}>
                        <div
                          style={{ width: s.w * scale, height: s.h * scale }}
                          className="overflow-hidden rounded-lg border border-neutral-200"
                        >
                          <div style={{ transform: `scale(${scale})`, transformOrigin: "top left" }}>
                            <Banner id={`bn-${ci}-${s.id}`} copy={c} brand={d.brand} size={s} />
                          </div>
                        </div>
                        <button
                          onClick={() => download(`bn-${ci}-${s.id}`, `${s.media}_${s.w}x${s.h}_${ci + 1}.png`)}
                          className="mt-1 text-xs text-neutral-600 underline"
                        >
                          {s.w}×{s.h} を保存
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* 4. LP */}
      {d && chosen.length > 0 && (
        <Section n={4} title="リンク先LP">
          <button
            onClick={() =>
              guarded("LP生成中", async () => {
                setLp(await runLp(d, chosen[0]));
              })
            }
            disabled={!!busy}
            className="rounded-full bg-neutral-900 px-6 py-2.5 text-sm font-bold text-white disabled:opacity-40"
          >
            {busy === "LP生成中" ? "生成中…" : `「${chosen[0].headline.join("")}」に合わせたLPを作る`}
          </button>

          {lp && (
            <div className="mt-4">
              <div className="mb-2 flex items-center gap-3">
                <GuardBadge g={lp.guard} />
                <button
                  onClick={() => {
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(new Blob([lp.html], { type: "text/html" }));
                    a.download = "lp.html";
                    a.click();
                  }}
                  className="text-xs text-neutral-600 underline"
                >
                  index.html を保存
                </button>
              </div>
              <iframe srcDoc={lp.html} className="h-[560px] w-full rounded-xl border border-neutral-200" />
            </div>
          )}
        </Section>
      )}
    </div>
  );
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="mb-3 flex items-center gap-2 text-lg font-black">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-neutral-900 text-xs text-white">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-bold text-neutral-500">{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function GuardBadge({ g }: { g?: GuardVerdict }) {
  if (!g) return null;
  const map = {
    green: ["問題なし", "bg-emerald-100 text-emerald-800"],
    yellow: ["要確認", "bg-amber-100 text-amber-800"],
    red: ["修正必要", "bg-red-100 text-red-800"],
  } as const;
  const [label, cls] = map[g.level];
  return <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${cls}`}>法令 {label}</span>;
}
