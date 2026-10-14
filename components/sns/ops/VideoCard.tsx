"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { approveVideoAction, attachRenderedVideoAction, changeVideoVoiceAction, createVideoUploadAction, prepareVideoAction, skipVideoAction, unapproveVideoAction, updateVideoAction } from "@/app/sns-media-actions";
import { Btn, Checkbox, Dialog, ErrorNote, GuardNotes, Icon, Input, Label, Select, Textarea, cn } from "@/components/meo/ui";
import { canRender, renderVideo } from "@/components/sns/ops/render-video";
import { uploadLarge } from "@/components/sns/ops/upload";
import { FORMAT_SPEC, VOICES, sceneReady, sceneSeconds, totalSeconds, type Material, type SnsVideo, type VideoScene } from "@/lib/sns-ops/video-types";

const STATUS: Record<SnsVideo["status"], [string, string]> = {
  draft: ["台本", "bg-[#F4F3F0] text-[#6B6862]"],
  ready: ["書き出し前", "bg-[#FBF4E4] text-[#8A6A1E]"],
  rendered: ["承認待ち", "bg-[#EEF3F8] text-[#3E5C76]"],
  approved: ["承認済み・送信中", "bg-[#EEF3F8] text-[#3E5C76]"],
  published: ["公開済み", "bg-[#EAF3EE] text-[#2F6B4A]"],
  skipped: ["見送り", "bg-[#F4F3F0] text-[#A5A198]"],
  failed: ["失敗", "bg-[#FBEDE9] text-[#A8705A]"],
};
const LEVEL: Record<string, [string, string]> = {
  red: ["要修正", "bg-[#FBEDE9] text-[#A8705A]"],
  yellow: ["要確認", "bg-[#FBF4E4] text-[#8A6A1E]"],
  green: ["問題なし", "bg-[#EAF3EE] text-[#2F6B4A]"],
};

const PRIVACY: Record<SnsVideo["platform"], { value: string; label: string }[]> = {
  tiktok: [
    { value: "", label: "公開範囲を選んでください" },
    { value: "PUBLIC_TO_EVERYONE", label: "全員に公開" },
    { value: "MUTUAL_FOLLOW_FRIENDS", label: "相互フォローの友達" },
    { value: "FOLLOWER_OF_CREATOR", label: "フォロワー" },
    { value: "SELF_ONLY", label: "自分だけ（監査前のアプリはこれだけ）" },
  ],
  youtube: [
    { value: "private", label: "非公開（確認前のアプリはこれに固定）" },
    { value: "unlisted", label: "限定公開" },
    { value: "public", label: "公開" },
  ],
  instagram: [{ value: "public", label: "公開（リール）" }],
};

const fmtSec = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}分${Math.round(s % 60)}秒` : `${Math.round(s)}秒`);

/** 動画1本：台本（場面）の確認・直し → 準備（画像・ナレーション） → ブラウザで書き出し → 承認して投稿 */
export function VideoCard({ video, materials }: { video: SnsVideo; materials: Material[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(video.status !== "published" && video.status !== "skipped");
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [approving, setApproving] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const spec = FORMAT_SPEC[video.format];
  const total = totalSeconds(video.scenes);
  const ready = video.scenes.length > 0 && video.scenes.every(sceneReady);
  const [st, stCls] = STATUS[video.status];
  const [lv, lvCls] = video.guard ? (LEVEL[video.guard.level] ?? LEVEL.green) : ["チェック前", "bg-[#F4F3F0] text-[#6B6862]"];
  const editable = !["approved", "published"].includes(video.status);
  const chapters = video.outline ?? [];

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
      setProgress(null);
    }
  };

  /** 準備は1回で終わらないことがある（長尺は章・画像・音声が多い）。終わるまで繰り返す */
  const prepare = () =>
    run("prep", async () => {
      for (let i = 0; i < 30; i++) {
        const r = await prepareVideoAction(video.id);
        setProgress(`台本 ${r.chaptersDone}/${r.chaptersTotal}章・画像 ${r.images[0]}/${r.images[1]}・ナレーション ${r.voices[0]}/${r.voices[1]}`);
        router.refresh();
        if (r.ready) return "準備ができました。「書き出す」で動画にします";
        if (r.errors.length && i > 0) throw new Error(r.errors.join(" / "));
      }
      return "まだ途中です。もう一度「準備する」を押してください";
    });

  const render = () =>
    run("render", async () => {
      const why = canRender();
      if (why) throw new Error(why);
      const scenes = video.scenes.map((s, i) => {
        const chapterStart = video.format === "long" && (i === 0 || video.scenes[i - 1].chapter !== s.chapter);
        return {
          imageUrl: s.materialType === "image" ? s.materialUrl : s.imageUrl,
          videoUrl: s.materialType === "video" ? s.materialUrl : null,
          audioUrl: s.audioUrl,
          caption: s.caption,
          chapterTitle: chapterStart ? (chapters[s.chapter]?.title ?? null) : null,
          sec: sceneSeconds(s),
        };
      });
      if (scenes.some((s) => !s.imageUrl && !s.videoUrl)) throw new Error("画像の無い場面があります。「準備する」を先に押してください");
      const out = await renderVideo({ width: spec.width, height: spec.height, fps: spec.fps, scenes, layout: video.format, codecs: video.platform === "youtube" ? "relaxed" : "strict" }, (phase, r) => setProgress(`${phase} ${Math.round(r * 100)}%`));
      setPreview(URL.createObjectURL(out.blob));
      setProgress("アップロードしています 0%");
      const up = await createVideoUploadAction(video.id);
      await uploadLarge(out.blob, up, (r) => setProgress(`アップロードしています ${Math.round(r * 100)}%`));
      await attachRenderedVideoAction(video.id, up.path, out.durationSec);
      return `書き出しました（${fmtSec(out.durationSec)}・${(out.blob.size / 1024 / 1024).toFixed(1)}MB）。内容を確認して承認してください`;
    });

  return (
    <div className={cn("rounded-2xl border bg-white p-4", video.status === "skipped" ? "border-[#E8E5E0] opacity-60" : "border-[#E8E5E0]")}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-[#2E2D29] px-2 py-0.5 text-[10px] font-semibold text-white">{spec.label}</span>
        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", stCls)}>{st}</span>
        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", lvCls)}>表現チェック：{lv}</span>
        {video.pattern && <span className="rounded-full bg-[#FBF8F3] px-2 py-0.5 text-[10px] text-[#8A5340]">型：{video.pattern}</span>}
        <span className="text-[10px] text-[#8B877F]">
          {video.scenes.length}場面・約{fmtSec(total)}
          {video.format === "short" && total > 0 && (total < spec.minSec || total > spec.maxSec) ? `（目安 ${spec.minSec}〜${spec.maxSec}秒）` : ""}
        </span>
        <span className="ml-auto text-[10px] text-[#A5A198]">{new Date(video.createdAt).toLocaleDateString("ja-JP")}</span>
      </div>
      <button type="button" className="mt-2 block text-left" onClick={() => setOpen((v) => !v)}>
        <p className="text-base font-semibold text-[#2E2D29]">{video.title || "（無題）"}</p>
        {video.reason && <p className="mt-0.5 text-xs text-[#8B877F]">AI のねらい：{video.reason}</p>}
      </button>

      {video.videoUrl && (
        <video src={video.videoUrl} controls className={cn("mt-3 rounded-lg bg-black", video.format === "short" ? "max-h-[480px]" : "w-full")} />
      )}
      {!video.videoUrl && preview && <video src={preview} controls className={cn("mt-3 rounded-lg bg-black", video.format === "short" ? "max-h-[480px]" : "w-full")} />}
      {video.publishedUrl && (
        <a href={video.publishedUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-[#3E5C76] underline">
          公開した動画を見る <Icon name="external" className="h-3 w-3" />
        </a>
      )}
      {video.metrics && <p className="mt-1 text-xs text-[#2E2D29]">結果：再生 {video.metrics.views ?? "–"}・いいね {video.metrics.likes ?? "–"}・コメント {video.metrics.comments ?? "–"}{video.metrics.shares !== undefined ? `・シェア ${video.metrics.shares ?? "–"}` : ""}</p>}

      {open && (
        <div className="mt-3 space-y-3">
          {video.guard && video.guard.hits.length > 0 && <GuardNotes hits={video.guard.hits.filter((h) => h.text || h.reason)} />}
          {video.format === "long" && chapters.length > 0 && (
            <div className="rounded-xl bg-[#FAF9F7] p-3 text-xs">
              <p className="font-semibold text-[#2E2D29]">章立て</p>
              <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-[#6B6862]">
                {chapters.map((c, i) => (
                  <li key={i}>
                    {c.title}（{c.minutes}分）{video.scenes.some((s) => s.chapter === i) ? "" : " … 台本はまだ"}
                  </li>
                ))}
              </ol>
            </div>
          )}
          <SceneStrip scenes={video.scenes} chapters={chapters.map((c) => c.title)} />
          {video.description && (
            <details className="text-xs">
              <summary className="cursor-pointer text-[#6B6862]">説明文・ハッシュタグ</summary>
              <p className="mt-1 whitespace-pre-wrap text-[#2E2D29]">{video.description}</p>
              {video.hashtags.length > 0 && <p className="mt-1 text-[#3E5C76]">{video.hashtags.map((h) => `#${h}`).join(" ")}</p>}
            </details>
          )}
        </div>
      )}

      {progress && <p className="mt-3 text-xs text-[#6B6862]">{progress}</p>}
      {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
      {video.errorMessage && !error && video.status !== "published" && <div className="mt-3"><ErrorNote>前回の送信で止まりました：{video.errorMessage}</ErrorNote></div>}
      {info && <p className="mt-3 rounded-xl bg-[#EAF3EE] px-3 py-2 text-xs text-[#2F6B4A]">{info}</p>}

      {editable && video.status !== "skipped" && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#F0EDE8] pt-3">
          <Btn variant="outline" size="sm" disabled={busy !== null} onClick={() => setEditing(true)}>台本を直す</Btn>
          <div className="w-44">
            <Select value={video.voice} onChange={(v) => run("voice", async () => { await changeVideoVoiceAction(video.id, v); return "声を変えました。「準備する」でナレーションを作り直します"; })} options={VOICES.map((v) => ({ value: v.id, label: `声：${v.label}` }))} />
          </div>
          {!ready || video.status === "draft" ? (
            <Btn size="sm" disabled={busy !== null} onClick={prepare}>
              {busy === "prep" ? <Icon name="loader" /> : <Icon name="sparkles" className="h-3.5 w-3.5" />}
              {busy === "prep" ? "準備しています" : "準備する（画像・ナレーション）"}
            </Btn>
          ) : (
            <Btn size="sm" disabled={busy !== null} onClick={render}>
              {busy === "render" ? <Icon name="loader" /> : <Icon name="images" className="h-3.5 w-3.5" />}
              {busy === "render" ? "書き出しています（画面を閉じないでください）" : video.status === "rendered" ? "書き出し直す" : "書き出す"}
            </Btn>
          )}
          <div className="ml-auto flex gap-2">
            <Btn variant="ghost" size="sm" disabled={busy !== null} onClick={() => run("skip", () => skipVideoAction(video.id))}>見送る</Btn>
            {video.status === "rendered" && (
              <Btn variant="gold" size="sm" disabled={busy !== null || video.guard?.level === "red"} onClick={() => setApproving(true)}>
                <Icon name="checkCircle" className="h-3.5 w-3.5" /> 承認して投稿
              </Btn>
            )}
          </div>
        </div>
      )}
      {video.status === "approved" && (
        <div className="mt-3 flex items-center gap-2 border-t border-[#F0EDE8] pt-3">
          <p className="flex-1 text-xs text-[#3E5C76]">承認済みです。媒体側の処理が終わりしだい公開されます（30分おきに確認します）</p>
          <Btn variant="ghost" size="sm" disabled={busy !== null} onClick={() => run("un", () => unapproveVideoAction(video.id))}>承認を取り消す</Btn>
        </div>
      )}

      {editing && <ScriptEditor video={video} materials={materials} onClose={() => setEditing(false)} onSaved={(lv) => { setEditing(false); setInfo(`保存しました（表現チェック：${LEVEL[lv]?.[0] ?? lv}）。直した場面は「準備する」で作り直します`); router.refresh(); }} />}
      {approving && (
        <ApproveVideoDialog
          video={video}
          onClose={() => setApproving(false)}
          onApprove={(privacy, sendNow) => {
            setApproving(false);
            void run("approve", async () => {
              const r = await approveVideoAction(video.id, { privacy, sendNow });
              return r.state === "published" ? "公開しました" : r.state === "processing" ? "媒体側で処理中です。終わりしだい公開されます（30分おきに確認します）" : "承認しました。30分以内に自動で送ります";
            });
          }}
        />
      )}
    </div>
  );
}

function SceneStrip({ scenes, chapters }: { scenes: VideoScene[]; chapters: string[] }) {
  const [all, setAll] = useState(false);
  const list = all ? scenes : scenes.slice(0, 8);
  return (
    <div>
      <div className="grid gap-2 sm:grid-cols-2">
        {list.map((s, i) => {
          const showChapter = chapters.length > 0 && (i === 0 || list[i - 1]?.chapter !== s.chapter);
          const thumb = s.materialUrl && s.materialType === "image" ? s.materialUrl : s.imageUrl;
          return (
            <div key={s.key} className="flex gap-2 rounded-lg border border-[#F0EDE8] p-2">
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded bg-[#F4F3F0]">
                {thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumb} alt="" className="h-full w-full object-cover" />
                ) : s.materialType === "video" ? (
                  <div className="flex h-full items-center justify-center text-[10px] text-[#6B6862]">動画</div>
                ) : (
                  <div className="flex h-full items-center justify-center p-1 text-center text-[9px] text-[#A5A198]">{s.error ?? "画像は準備で作ります"}</div>
                )}
              </div>
              <div className="min-w-0 flex-1 text-xs">
                {showChapter && <p className="text-[10px] font-semibold text-[#8A5340]">{chapters[s.chapter]}</p>}
                <p className="font-semibold text-[#2E2D29]">{s.caption || "（テロップなし）"}</p>
                <p className="line-clamp-2 text-[#6B6862]">{s.narration}</p>
                <div className="mt-0.5 flex items-center gap-2 text-[10px] text-[#A5A198]">
                  <span>{sceneSeconds(s)}秒</span>
                  {s.audioUrl ? <audio src={s.audioUrl} controls className="h-6 w-36" /> : <span>ナレーションは準備で作ります</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {scenes.length > 8 && (
        <button type="button" className="mt-2 text-xs text-[#6B6862] underline" onClick={() => setAll((v) => !v)}>
          {all ? "閉じる" : `残り${scenes.length - 8}場面も見る`}
        </button>
      )}
    </div>
  );
}

function ScriptEditor({ video, materials, onClose, onSaved }: { video: SnsVideo; materials: Material[]; onClose: () => void; onSaved: (level: string) => void }) {
  const [title, setTitle] = useState(video.title);
  const [description, setDescription] = useState(video.description);
  const [tags, setTags] = useState(video.hashtags.join(" "));
  const [scenes, setScenes] = useState(video.scenes.map((s) => ({ key: s.key, narration: s.narration, caption: s.caption, materialId: s.materialId, imagePrompt: s.imagePrompt })));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const visuals = materials.filter((m) => m.kind !== "text");
  const options = [{ value: "", label: "AI で画像を作る" }, ...visuals.map((m) => ({ value: m.id, label: `${m.kind === "video" ? "動画" : "写真"}：${(m.title || m.body || m.id).slice(0, 30)}` }))];
  const set = (i: number, patch: Partial<(typeof scenes)[number]>) => setScenes(scenes.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="台本を直す" description="ナレーション・素材を変えた場面は、保存後の「準備する」で作り直します" className="max-w-3xl">
      <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
        <div>
          <Label>タイトル</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <Label>説明文</Label>
          <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div>
          <Label>ハッシュタグ（空白区切り）</Label>
          <Input value={tags} onChange={(e) => setTags(e.target.value)} />
        </div>
        {scenes.map((s, i) => (
          <div key={s.key} className="rounded-xl border border-[#F0EDE8] p-3">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-[#A5A198]">場面{i + 1}</span>
              <button type="button" className="ml-auto text-[10px] text-[#A8705A] underline" onClick={() => setScenes(scenes.filter((_, k) => k !== i))}>
                この場面を消す
              </button>
            </div>
            <Input className="mt-1" value={s.caption} onChange={(e) => set(i, { caption: e.target.value })} placeholder="テロップ（16字以内が目安）" />
            <Textarea className="mt-1" rows={2} value={s.narration} onChange={(e) => set(i, { narration: e.target.value })} placeholder="ナレーション" />
            <div className="mt-1 grid gap-2 sm:grid-cols-2">
              <Select value={s.materialId ?? ""} onChange={(v) => set(i, { materialId: v || null })} options={options} />
              {!s.materialId && <Input value={s.imagePrompt ?? ""} onChange={(e) => set(i, { imagePrompt: e.target.value })} placeholder="AI 画像の説明（文字は入れません）" />}
            </div>
          </div>
        ))}
      </div>
      {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
      <div className="mt-3 flex justify-end gap-2">
        <Btn variant="ghost" onClick={onClose}>やめる</Btn>
        <Btn
          disabled={saving || !scenes.length}
          onClick={async () => {
            setSaving(true);
            setError(null);
            try {
              onSaved(await updateVideoAction(video.id, { title, description, hashtags: tags.split(/\s+/).filter(Boolean), scenes }));
            } catch (e) {
              setError(e instanceof Error ? e.message : "保存できませんでした");
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? <Icon name="loader" /> : null}保存（表現チェックをやり直す）
        </Btn>
      </div>
    </Dialog>
  );
}

function ApproveVideoDialog({ video, onClose, onApprove }: { video: SnsVideo; onClose: () => void; onApprove: (privacy: string, sendNow: boolean) => void }) {
  const opts = PRIVACY[video.platform];
  const [privacy, setPrivacy] = useState(opts[0].value);
  const [ok, setOk] = useState(false);
  const name = video.platform === "tiktok" ? "TikTok" : video.platform === "youtube" ? "YouTube" : "Instagram（リール）";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`${name}に投稿しますか？`} description="承認すると、選んだ公開範囲で投稿します">
      <div className="space-y-3 text-sm">
        <dl className="space-y-1 rounded-xl bg-[#FAF9F7] p-3 text-xs">
          <div className="flex gap-2"><dt className="w-16 shrink-0 text-[#8B877F]">タイトル</dt><dd className="text-[#2E2D29]">{video.title}</dd></div>
          <div className="flex gap-2"><dt className="w-16 shrink-0 text-[#8B877F]">長さ</dt><dd className="text-[#2E2D29]">{video.durationSec ? fmtSec(video.durationSec) : "–"}</dd></div>
        </dl>
        {opts.length > 1 && (
          <div>
            <Label>公開範囲</Label>
            <Select value={privacy} onChange={setPrivacy} options={opts} />
          </div>
        )}
        {video.guard?.level === "yellow" && <p className="rounded-xl bg-[#FBF4E4] px-3 py-2 text-xs text-[#8A6A1E]">表現チェックで「要確認」の箇所があります。内容を確かめてから承認してください。</p>}
        <p className="text-[11px] leading-relaxed text-[#8B877F]">AI で作った画像・音声を含む動画です。{video.platform === "youtube" ? "YouTube には「改変・合成されたコンテンツ」として申告します。" : video.platform === "tiktok" ? "TikTok には「AI 生成コンテンツ」として申告します。" : ""}</p>
        <label className="flex items-start gap-2 text-xs text-[#2E2D29]">
          <Checkbox checked={ok} onChange={setOk} />
          <span>動画・台本・表現チェックの指摘を確認し、この内容と公開範囲で投稿して問題ないことを確かめました{video.platform === "tiktok" ? "（TikTok の音楽の利用に関する確認にも同意します）" : ""}</span>
        </label>
        <div className="flex flex-wrap justify-end gap-2">
          <Btn variant="ghost" onClick={onClose}>やめる</Btn>
          <Btn variant="outline" disabled={!ok || (opts.length > 1 && !privacy)} onClick={() => onApprove(privacy, false)}>承認して30分以内に送る</Btn>
          <Btn variant="gold" disabled={!ok || (opts.length > 1 && !privacy)} onClick={() => onApprove(privacy, true)}>
            <Icon name="send" className="h-4 w-4" /> 承認して今すぐ送る
          </Btn>
        </div>
      </div>
    </Dialog>
  );
}
