"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { addTextMaterialAction, aiMaterialAction, attachMaterialAction, createMaterialUploadAction, deleteMaterialAction, importMaterialsAction, updateMaterialAction } from "@/app/sns-media-actions";
import { Btn, Card, ErrorNote, Icon, Input, Select, Textarea, cn } from "@/components/meo/ui";
import { SectionTitle } from "@/components/meo/Workspace";
import { uploadLarge } from "@/components/sns/ops/upload";
import type { Material } from "@/lib/sns-ops/video-types";

const SOURCE: Record<Material["source"], string> = { upload: "手持ち", gbp: "Google マップ（自社）", x: "X", instagram: "Instagram", ai: "AI", note: "メモ" };

async function videoDuration(file: File): Promise<number | null> {
  return new Promise((ok) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      ok(Number.isFinite(v.duration) ? Math.round(v.duration * 10) / 10 : null);
      URL.revokeObjectURL(v.src);
    };
    v.onerror = () => ok(null);
    v.src = URL.createObjectURL(file);
  });
}

/** 素材（写真・動画・事実のメモ）。動画・投稿の台本はここから選ぶ */
export function MaterialsPanel({ materials }: { materials: Material[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [note, setNote] = useState({ title: "", body: "" });
  const [ai, setAi] = useState({ prompt: "", aspect: "9:16" as "9:16" | "16:9" | "4:5" | "1:1" });
  const [filter, setFilter] = useState<"all" | "image" | "video" | "text">("all");

  const run = async (key: string, fn: () => Promise<string | void>) => {
    setBusy(key);
    setError(null);
    setInfo(null);
    try {
      const m = await fn();
      if (m) setInfo(m);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy(null);
    }
  };

  const upload = (files: FileList) =>
    run("upload", async () => {
      let n = 0;
      for (const f of Array.from(files).slice(0, 20)) {
        const kind = f.type.startsWith("video/") ? "video" : "image";
        const up = await createMaterialUploadAction(f.type);
        await uploadLarge(f, { bucket: "sns-media", ...up }, (r) => setInfo(`${f.name}：${Math.round(r * 100)}%`));
        await attachMaterialAction(up.path, { kind, title: f.name.replace(/\.[^.]+$/, "").slice(0, 60), body: "", durationSec: kind === "video" ? await videoDuration(f) : null });
        n++;
      }
      return `${n}件を素材に足しました`;
    });

  const list = materials.filter((m) => filter === "all" || m.kind === filter);

  return (
    <div className="space-y-5">
      <Card>
        <SectionTitle>素材を集める</SectionTitle>
        <p className="mt-1 text-xs leading-relaxed text-[#8B877F]">
          動画・投稿の台本は、ここにある写真・動画・メモから AI が選んで組み立てます。説明（何の写真か）を書いておくと、合う場面に使われます。Google マップの写真は、自社がビジネスプロフィールに載せたものだけを取り込みます（お客様が投稿した写真は著作権と Google の規約上、使いません）。
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {(
            [
              ["gbp", "Google マップ（自社の写真）"],
              ["x", "X の自分の投稿"],
              ["instagram", "Instagram の自分の投稿"],
            ] as const
          ).map(([src, label]) => (
            <Btn key={src} variant="outline" size="sm" disabled={busy !== null} onClick={() => run(src, () => importMaterialsAction(src))}>
              {busy === src ? <Icon name="loader" /> : <Icon name="refresh" className="h-3.5 w-3.5" />}
              {label}から取り込む
            </Btn>
          ))}
          <label className={cn("inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg bg-[#2E2D29] px-3 text-xs font-semibold text-white", busy !== null && "pointer-events-none opacity-50")}>
            {busy === "upload" ? <Icon name="loader" /> : <Icon name="imagePlus" className="h-3.5 w-3.5" />} 写真・動画をアップロード
            <input type="file" multiple accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime" className="hidden" onChange={(e) => e.target.files?.length && upload(e.target.files)} />
          </label>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 rounded-xl bg-[#FAF9F7] p-3">
            <p className="text-xs font-semibold text-[#2E2D29]">事実・データのメモ（台本の根拠になります）</p>
            <Input value={note.title} onChange={(e) => setNote({ ...note, title: e.target.value })} placeholder="見出し（例：料金、こだわり、よくある質問）" />
            <Textarea rows={3} value={note.body} onChange={(e) => setNote({ ...note, body: e.target.value })} placeholder="事実・数字・話したいこと（ここに無い事実は台本で使いません）" />
            <div className="flex justify-end">
              <Btn size="sm" disabled={busy !== null || !note.body.trim()} onClick={() => run("note", async () => { await addTextMaterialAction(note.title, note.body); setNote({ title: "", body: "" }); return "メモを足しました"; })}>
                メモを足す
              </Btn>
            </div>
          </div>
          <div className="space-y-2 rounded-xl bg-[#FAF9F7] p-3">
            <p className="text-xs font-semibold text-[#2E2D29]">AI で写真を作る（文字は入れません）</p>
            <Textarea rows={3} value={ai.prompt} onChange={(e) => setAi({ ...ai, prompt: e.target.value })} placeholder="どんな写真か（例：木のカウンターに並んだ焼き菓子、朝の柔らかい光）" />
            <div className="flex items-center justify-between gap-2">
              <div className="w-40">
                <Select value={ai.aspect} onChange={(v) => setAi({ ...ai, aspect: v as typeof ai.aspect })} options={[{ value: "9:16", label: "縦（9:16）" }, { value: "16:9", label: "横（16:9）" }, { value: "4:5", label: "Instagram（4:5）" }, { value: "1:1", label: "正方形" }]} />
              </div>
              <Btn size="sm" disabled={busy !== null || !ai.prompt.trim()} onClick={() => run("ai", async () => { await aiMaterialAction(ai.prompt, ai.aspect); setAi({ ...ai, prompt: "" }); return "写真を作りました"; })}>
                {busy === "ai" ? <Icon name="loader" /> : null}作る
              </Btn>
            </div>
          </div>
        </div>
        {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
        {info && <p className="mt-3 rounded-xl bg-[#EAF3EE] px-3 py-2 text-xs text-[#2F6B4A]">{info}</p>}
      </Card>

      <Card>
        <div className="flex items-center justify-between gap-3">
          <SectionTitle>素材（{materials.length}件）</SectionTitle>
          <div className="w-36">
            <Select value={filter} onChange={(v) => setFilter(v as typeof filter)} options={[{ value: "all", label: "すべて" }, { value: "image", label: "写真" }, { value: "video", label: "動画" }, { value: "text", label: "メモ" }]} />
          </div>
        </div>
        {list.length === 0 ? (
          <p className="mt-3 text-xs text-[#8B877F]">まだ素材がありません</p>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {list.map((m) => (
              <MaterialTile key={m.id} m={m} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function MaterialTile({ m }: { m: Material }) {
  const router = useRouter();
  const [edit, setEdit] = useState(false);
  const [title, setTitle] = useState(m.title);
  const [body, setBody] = useState(m.body);
  return (
    <div className="rounded-xl border border-[#F0EDE8] p-2 text-xs">
      <div className="aspect-square overflow-hidden rounded-lg bg-[#F4F3F0]">
        {m.kind === "image" && m.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={m.url} alt={m.title} className="h-full w-full object-cover" />
        ) : m.kind === "video" && m.url ? (
          <video src={m.url} muted className="h-full w-full object-cover" />
        ) : (
          <p className="line-clamp-6 p-2 text-[11px] leading-relaxed text-[#2E2D29]">{m.body}</p>
        )}
      </div>
      <p className="mt-1 truncate font-semibold text-[#2E2D29]">{m.title || "（説明なし）"}</p>
      <p className="text-[10px] text-[#A5A198]">{SOURCE[m.source]}{m.kind === "video" && m.meta.durationSec ? `・${m.meta.durationSec}秒` : ""}</p>
      {edit ? (
        <div className="mt-1 space-y-1">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="何の写真・動画か" />
          <Textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="説明（場面選びに使います）" />
          <div className="flex gap-2">
            <button type="button" className="text-[#3E5C76] underline" onClick={async () => { await updateMaterialAction(m.id, title, body); setEdit(false); router.refresh(); }}>保存</button>
            <button type="button" className="text-[#6B6862] underline" onClick={() => setEdit(false)}>やめる</button>
          </div>
        </div>
      ) : (
        <div className="mt-1 flex gap-2 text-[10px]">
          <button type="button" className="text-[#6B6862] underline" onClick={() => setEdit(true)}>説明を書く</button>
          <button type="button" className="text-[#A8705A] underline" onClick={async () => { if (confirm("この素材を消しますか？")) { await deleteMaterialAction(m.id); router.refresh(); } }}>消す</button>
        </div>
      )}
    </div>
  );
}
