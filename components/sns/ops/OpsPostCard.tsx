"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { addOpsImageAction, attachOpsUploadAction, createOpsUploadAction, regenerateOpsImageAction, removeOpsMediaAction, unapproveOpsPostAction, updateOpsPostAction } from "@/app/sns-ops-actions";
import { createClient } from "@/lib/supabase/client";
import { Btn, ErrorNote, GuardNotes, Icon, Input, Textarea, cn } from "@/components/meo/ui";
import { xWeightedLength } from "@/lib/sns-ops/x-api";
import { KIND_LABEL, type OpsPost } from "@/lib/sns-ops/ops-types";

const LEVEL: Record<string, [string, string]> = {
  red: ["要修正", "bg-[#FBEDE9] text-[#A8705A]"],
  yellow: ["要確認", "bg-[#FBF4E4] text-[#8A6A1E]"],
  green: ["問題なし", "bg-[#EAF3EE] text-[#2F6B4A]"],
};

const STATUS: Record<OpsPost["status"], [string, string]> = {
  draft: ["承認待ち", "bg-[#F4F3F0] text-[#6B6862]"],
  approved: ["承認済み・送信待ち", "bg-[#EEF3F8] text-[#3E5C76]"],
  published: ["送信済み", "bg-[#EAF3EE] text-[#2F6B4A]"],
  skipped: ["見送り", "bg-[#F4F3F0] text-[#A5A198]"],
  failed: ["失敗", "bg-[#FBEDE9] text-[#A8705A]"],
};

const chars = (t: string) => Math.ceil(xWeightedLength(t) / 2);

/** 案1件（投稿・リプライ・引用・リポスト・DM 返信）。選んでまとめて承認できる */
export function OpsPostCard({ post, selected, onSelect }: { post: OpsPost; selected: boolean; onSelect: (v: boolean) => void }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(post.body);
  const [thread, setThread] = useState(post.thread);
  const [tags, setTags] = useState(post.hashtags.join(" "));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imgPrompt, setImgPrompt] = useState("");
  const [showAddImg, setShowAddImg] = useState(false);
  const editable = post.status === "draft" || post.status === "failed" || post.status === "approved";
  const [lv, lvCls] = post.guard ? (LEVEL[post.guard.level] ?? LEVEL.green) : ["チェック前", "bg-[#F4F3F0] text-[#6B6862]"];
  const [st, stCls] = STATUS[post.status];

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy(null);
    }
  };

  const upload = (file: File) =>
    run("upload", async () => {
      const { path, token } = await createOpsUploadAction(post.id, file.type);
      const { error: upErr } = await createClient().storage.from("sns-media").uploadToSignedUrl(path, token, file, { contentType: file.type });
      if (upErr) throw new Error(`アップロードできませんでした：${upErr.message}`);
      await attachOpsUploadAction(post.id, path, "");
    });

  return (
    <div className={cn("rounded-2xl border bg-white p-4", selected ? "border-[#C9A84C]" : "border-[#E8E5E0]", post.status === "skipped" && "opacity-60")}>
      <div className="flex flex-wrap items-center gap-2">
        {editable && post.status !== "approved" && <input type="checkbox" checked={selected} onChange={(e) => onSelect(e.target.checked)} className="h-4 w-4 accent-[#2E2D29]" aria-label="選ぶ" />}
        <span className="rounded-full bg-[#2E2D29] px-2 py-0.5 text-[10px] font-semibold text-white">{KIND_LABEL[post.kind]}</span>
        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", stCls)}>{st}</span>
        {post.kind !== "repost" && <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", lvCls)}>表現チェック：{lv}</span>}
        {post.pattern && <span className="rounded-full bg-[#FBF8F3] px-2 py-0.5 text-[10px] text-[#8A5340]">型：{post.pattern}</span>}
        {post.scheduledAt && post.status === "approved" && <span className="text-[10px] text-[#3E5C76]">予約 {new Date(post.scheduledAt).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>}
        <span className="ml-auto text-[10px] text-[#A5A198]">{new Date(post.createdAt).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
      </div>

      {post.target && (post.target.text || post.target.lastMessage) && (
        <div className="mt-2 rounded-lg border-l-4 border-[#E8E5E0] bg-[#FAF9F7] px-3 py-2 text-xs text-[#6B6862]">
          <p className="font-semibold text-[#2E2D29]">
            {post.kind === "dm" ? `DM：${post.target.senderName ?? ""}` : `@${post.target.author ?? ""}`}
            {post.target.url && (
              <a href={post.target.url} target="_blank" rel="noreferrer" className="ml-2 font-normal text-[#3E5C76] underline">
                元の投稿
              </a>
            )}
            {post.kind !== "dm" && post.kind !== "repost" && <span className="ml-2 font-normal text-[#A5A198]">{post.target.summoned ? "（API で送れます）" : "（X の画面から送ります）"}</span>}
          </p>
          <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap">{post.target.text ?? post.target.lastMessage}</p>
        </div>
      )}

      {editing ? (
        <div className="mt-3 space-y-2">
          <Textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
          <p className={cn("text-[10px]", chars(body) > 140 ? "text-[#A8705A]" : "text-[#A5A198]")}>{chars(body)} / 140字</p>
          {post.kind === "post" && (
            <>
              {thread.map((t, i) => (
                <div key={i}>
                  <Textarea rows={3} value={t} onChange={(e) => setThread(thread.map((x, k) => (k === i ? e.target.value : x)))} placeholder={`続き${i + 1}（リプライに書く）`} />
                  <p className={cn("text-[10px]", chars(t) > 140 ? "text-[#A8705A]" : "text-[#A5A198]")}>続き{i + 1}：{chars(t)} / 140字</p>
                </div>
              ))}
              {thread.length < 6 && (
                <button type="button" className="text-xs text-[#6B6862] underline" onClick={() => setThread([...thread, ""])}>
                  ＋ 続き（リプライ）を足す
                </button>
              )}
              <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="ハッシュタグ（空白区切り・#なし）" />
            </>
          )}
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" size="sm" onClick={() => setEditing(false)}>やめる</Btn>
            <Btn size="sm" disabled={busy !== null} onClick={() => run("save", async () => { await updateOpsPostAction(post.id, { body, thread, hashtags: tags.split(/\s+/).filter(Boolean) }); setEditing(false); })}>
              {busy === "save" ? <Icon name="loader" /> : null}保存（表現チェックをやり直す）
            </Btn>
          </div>
        </div>
      ) : (
        post.kind !== "repost" && (
          <div className="mt-3 space-y-2">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-[#2E2D29]">
              {post.body}
              {post.hashtags.length > 0 && <span className="text-[#3E5C76]">{"\n"}{post.hashtags.map((h) => `#${h}`).join(" ")}</span>}
            </p>
            {post.thread.map((t, i) => (
              <p key={i} className="ml-4 whitespace-pre-wrap border-l-2 border-[#E8E5E0] pl-3 text-sm leading-relaxed text-[#2E2D29]">
                <span className="mr-1 text-[10px] text-[#A5A198]">続き{i + 1}</span>
                {t}
              </p>
            ))}
          </div>
        )
      )}

      {post.media.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {post.media.map((m) => (
            <div key={m.key} className="rounded-lg border border-[#F0EDE8] p-1">
              <div className="relative aspect-video overflow-hidden rounded bg-[#F4F3F0]">
                {m.signedUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.signedUrl} alt={m.alt} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center p-1 text-center text-[10px] text-[#A5A198]">{busy === `img-${m.key}` ? "作っています…" : m.error ?? "未作成"}</div>
                )}
              </div>
              {editable && (
                <div className="mt-1 flex gap-2 text-[10px]">
                  {m.prompt && (
                    <button type="button" disabled={busy !== null} className="text-[#6B6862] underline disabled:opacity-40" onClick={() => run(`img-${m.key}`, () => regenerateOpsImageAction(post.id, m.key))}>
                      作り直す
                    </button>
                  )}
                  <button type="button" disabled={busy !== null} className="text-[#6B6862] underline disabled:opacity-40" onClick={() => run("rm", () => removeOpsMediaAction(post.id, m.key))}>
                    外す
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {post.guard && post.guard.hits.length > 0 && <div className="mt-3"><GuardNotes hits={post.guard.hits.filter((h) => h.text || h.reason)} /></div>}
      {post.reason && <p className="mt-2 text-[11px] text-[#8B877F]">AI のねらい：{post.reason}</p>}
      {post.errorMessage && post.status !== "published" && <div className="mt-2"><ErrorNote>前回の送信で止まりました：{post.errorMessage}</ErrorNote></div>}
      {post.metrics && (
        <p className="mt-2 text-xs text-[#2E2D29]">
          結果：表示 {post.metrics.impressions ?? "–"}・いいね {post.metrics.likes ?? 0}・リポスト {post.metrics.reposts ?? 0}・返信 {post.metrics.replies ?? 0}・ブックマーク {post.metrics.bookmarks ?? "–"}
        </p>
      )}
      {post.status === "published" && post.externalIds[0] && post.kind !== "dm" && (
        <a href={`https://x.com/i/status/${post.externalIds[0]}`} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-[#3E5C76] underline">
          X で見る <Icon name="external" className="h-3 w-3" />
        </a>
      )}
      {error && <div className="mt-2"><ErrorNote>{error}</ErrorNote></div>}

      {editable && !editing && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#F0EDE8] pt-3">
          {post.kind !== "repost" && (
            <Btn variant="outline" size="sm" onClick={() => setEditing(true)}>
              直す
            </Btn>
          )}
          {(post.kind === "post" || post.kind === "quote" || post.kind === "reply") && post.media.length < 4 && (
            <>
              <Btn variant="outline" size="sm" disabled={busy !== null} onClick={() => setShowAddImg((v) => !v)}>
                <Icon name="imagePlus" className="h-3.5 w-3.5" /> 画像を作る
              </Btn>
              <label className={cn("inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg border border-[#E0DBD1] bg-white px-3 text-xs text-[#2E2D29] hover:bg-[#FAF9F7]", busy !== null && "pointer-events-none opacity-50")}>
                {busy === "upload" ? <Icon name="loader" /> : <Icon name="image" className="h-3.5 w-3.5" />} 手持ちの画像
                <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
              </label>
            </>
          )}
          {post.status === "approved" && (
            <Btn variant="ghost" size="sm" disabled={busy !== null} onClick={() => run("un", () => unapproveOpsPostAction(post.id))}>
              承認を取り消す
            </Btn>
          )}
        </div>
      )}
      {showAddImg && (
        <div className="mt-2 flex gap-2">
          <Input value={imgPrompt} onChange={(e) => setImgPrompt(e.target.value)} placeholder="どんな画像か（日本語でも可。文字は入れません）" />
          <Btn size="sm" className="h-10 shrink-0" disabled={busy !== null || !imgPrompt.trim()} onClick={() => run("add", async () => { await addOpsImageAction(post.id, imgPrompt, ""); setImgPrompt(""); setShowAddImg(false); })}>
            {busy === "add" ? <Icon name="loader" /> : null}作る
          </Btn>
        </div>
      )}
    </div>
  );
}
