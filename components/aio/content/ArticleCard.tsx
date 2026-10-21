"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  deleteAioArticleAction,
  finishAioArticleAction,
  markAioNotePostedAction,
  regenerateAioImageAction,
  sendAioArticleToWpAction,
  updateAioArticleAction,
} from "@/app/aio-content-actions";
import { Btn, Card, Checkbox, Dialog, ErrorNote, GuardNotes, Icon, Input, Label, Textarea, cn } from "@/components/meo/ui";
import { bodyChars, mdToHtml } from "@/lib/aio/md";
import type { AioArticle, AioArticleImage, AioWpInfo } from "@/lib/aio/content-types";

const LEVEL: Record<string, [string, string]> = {
  red: ["要修正", "bg-[#FBEDE9] text-[#A8705A]"],
  yellow: ["要確認", "bg-[#FBF4E4] text-[#8A6A1E]"],
  green: ["問題なし", "bg-[#EAF3EE] text-[#2F6B4A]"],
};

async function copyRich(html: string, plain: string) {
  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard.write) {
      await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([plain], { type: "text/plain" }) })]);
      return true;
    }
  } catch {
    /* テキストだけで続ける */
  }
  await navigator.clipboard.writeText(plain);
  return true;
}

function imageLabel(img: AioArticleImage, idx: number) {
  return img.role === "eyecatch" ? "アイキャッチ" : `本文の画像${idx}`;
}

/** 記事1本：プレビュー・画像・編集・表現チェック・公開（WordPress は承認で／note は貼って人が投稿） */
export function ArticleCard({ article, wp }: { article: AioArticle; wp: AioWpInfo | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [approving, setApproving] = useState(false);
  const [posting, setPosting] = useState(false);

  const [levelText, levelCls] = article.guard ? (LEVEL[article.guard.level] ?? LEVEL.green) : ["チェック前", "bg-[#F4F3F0] text-[#6B6862]"];
  const eye = article.images.find((i) => i.role === "eyecatch");
  const inlineImgs = article.images.filter((i) => i.role === "inline");
  const missing = !article.guard || article.images.some((i) => !i.path && !i.hasText);
  const previewHtml = mdToHtml(
    article.bodyMd,
    inlineImgs.filter((i) => i.signedUrl).map((i) => ({ afterH2: i.afterH2, src: i.signedUrl!, alt: i.alt }))
  );
  const isNote = article.channel === "note";

  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    setError(null);
    setDone(null);
    try {
      const r = (await fn()) as { ok?: boolean; error?: string; failed?: number; imageErrors?: string[] } | undefined;
      // Server Action は失敗を値で返す（本番では throw した文面が画面に届かないため）
      if (r && r.ok === false) throw new Error(r.error || "うまくいきませんでした");
      if (r && r.failed) throw new Error(`画像を${r.failed}枚作れませんでした${r.imageErrors?.length ? `：${r.imageErrors.join(" / ")}` : ""}`);
      if (ok) setDone(ok);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy(null);
    }
  };

  const copyForNote = () =>
    run(
      "copy-note",
      async () => {
        let n = 0;
        const html = mdToHtml(
          article.bodyMd,
          inlineImgs.map((i) => ({ afterH2: i.afterH2, src: "", alt: i.alt, placeholder: `［ここに「本文の画像${++n}」を入れる］` }))
        );
        const tags = article.hashtags.length ? `\n\n${article.hashtags.map((t) => `#${t}`).join(" ")}` : "";
        await copyRich(html, article.bodyMd + tags);
      },
      "本文をコピーしました。note の編集画面で、タイトル欄にタイトル、本文欄に貼り付けてください（見出し・箇条書きはそのまま入ります）"
    );

  return (
    <Card className={cn(article.status === "published" && "border-[#CFE3D6]")}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-semibold", levelCls)}>表現チェック：{levelText}</span>
        {article.status === "published" ? (
          <span className="rounded-full bg-[#EAF3EE] px-2.5 py-0.5 text-[11px] font-semibold text-[#2F6B4A]">公開済み</span>
        ) : article.wpPostId ? (
          <span className="rounded-full bg-[#F4F3F0] px-2.5 py-0.5 text-[11px] text-[#6B6862]">WordPress に下書きあり</span>
        ) : (
          <span className="rounded-full bg-[#F4F3F0] px-2.5 py-0.5 text-[11px] text-[#6B6862]">下書き</span>
        )}
        <span className="text-[11px] text-[#A5A198]">{bodyChars(article.bodyMd).toLocaleString()}字</span>
        <span className="ml-auto text-[11px] text-[#A5A198]">{new Date(article.createdAt).toLocaleDateString("ja-JP")}</span>
      </div>

      <div className="mt-3 flex gap-4">
        {eye?.signedUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={eye.signedUrl} alt={eye.alt} className="hidden h-24 w-40 shrink-0 rounded-lg object-cover sm:block" />
        ) : (
          <div className="hidden h-24 w-40 shrink-0 items-center justify-center rounded-lg bg-[#F4F3F0] sm:flex">
            <Icon name="image" className="h-6 w-6 text-[#C9C5BC]" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold leading-snug text-[#2E2D29]">{article.title}</p>
          {article.metaDescription && <p className="mt-1 text-xs leading-relaxed text-[#6B6862]">{article.metaDescription}</p>}
          <div className="mt-1.5 flex flex-wrap gap-1">
            {article.target && <span className="rounded-full bg-[#FBF8F3] px-2 py-0.5 text-[10px] text-[#8A5340]">答える問い：{article.target}</span>}
            {article.keywords.map((k) => (
              <span key={k} className="rounded-full bg-[#F4F3F0] px-2 py-0.5 text-[10px] text-[#6B6862]">{k}</span>
            ))}
            {isNote && article.hashtags.map((h) => <span key={h} className="rounded-full bg-[#EEF3F8] px-2 py-0.5 text-[10px] text-[#3E5C76]">#{h}</span>)}
          </div>
          {article.publishedUrl && (
            <a href={article.publishedUrl} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-xs text-[#3E5C76] underline">
              公開した記事を開く <Icon name="external" className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>

      {article.guard && article.guard.hits.length > 0 && (
        <div className="mt-3">
          <GuardNotes hits={article.guard.hits} />
        </div>
      )}
      {article.errorMessage && (
        <div className="mt-3">
          <ErrorNote>前回の送信で止まりました：{article.errorMessage}</ErrorNote>
        </div>
      )}

      {/* 画像 */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        {article.images.map((img) => {
          const idx = inlineImgs.indexOf(img) + 1;
          return <ImageTile key={img.key} img={img} label={imageLabel(img, idx)} busy={busy === `img-${img.key}`} disabled={busy !== null} onRegenerate={(p) => run(`img-${img.key}`, () => regenerateAioImageAction(article.id, img.key, p), "画像を作り直しました")} />;
        })}
      </div>

      {missing && (
        <div className="mt-3 flex items-center gap-3 rounded-xl bg-[#FBF8F3] px-3 py-2">
          <p className="flex-1 text-xs text-[#8A5340]">{!article.guard ? "表現チェックと画像がまだです。" : "まだ作れていない画像があります。"}</p>
          <Btn size="sm" variant="gold" disabled={busy !== null} onClick={() => run("finish", () => finishAioArticleAction(article.id), "仕上げました")}>
            {busy === "finish" ? <Icon name="loader" /> : <Icon name="sparkles" className="h-3.5 w-3.5" />}
            {busy === "finish" ? "仕上げています（1〜2分）" : "仕上げる"}
          </Btn>
        </div>
      )}

      {/* プレビュー */}
      <button type="button" className="mt-3 flex items-center gap-1 text-xs text-[#6B6862] underline" onClick={() => setOpen((v) => !v)}>
        <Icon name={open ? "chevronUp" : "chevronDown"} className="h-3.5 w-3.5" />
        {open ? "プレビューを閉じる" : "ページのプレビューを見る"}
      </button>
      {open && (
        <article className="mt-2 rounded-xl border border-[#F0EDE8] bg-white p-5 text-sm leading-relaxed text-[#2E2D29] [&_a]:text-[#3E5C76] [&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:border-[#E8E5E0] [&_blockquote]:pl-3 [&_blockquote]:text-[#6B6862] [&_figure]:my-4 [&_h2]:mb-2 [&_h2]:mt-6 [&_h2]:border-b [&_h2]:border-[#E8E5E0] [&_h2]:pb-1 [&_h2]:text-lg [&_h2]:font-bold [&_h3]:mb-1 [&_h3]:mt-4 [&_h3]:font-bold [&_img]:rounded-lg [&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_table]:my-3 [&_table]:w-full [&_table]:text-xs [&_td]:border [&_td]:border-[#E8E5E0] [&_td]:p-1.5 [&_th]:border [&_th]:border-[#E8E5E0] [&_th]:bg-[#FAF9F7] [&_th]:p-1.5 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5">
          {eye?.signedUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={eye.signedUrl} alt={eye.alt} className="mb-4 w-full rounded-lg" />
          )}
          <h1 className="mb-4 text-xl font-bold leading-snug text-[#2E2D29]">{article.title}</h1>
          <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
        </article>
      )}

      {error && (
        <div className="mt-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      {done && <p className="mt-3 rounded-xl bg-[#EAF3EE] px-3 py-2 text-xs text-[#2F6B4A]">{done}</p>}

      {/* 操作 */}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#F0EDE8] pt-3">
        <Btn variant="outline" size="sm" disabled={busy !== null} onClick={() => setEditing(true)}>
          <Icon name="file" className="h-3.5 w-3.5" /> 直す
        </Btn>
        {isNote ? (
          <>
            <Btn variant="outline" size="sm" disabled={busy !== null} onClick={copyForNote}>
              <Icon name="file" className="h-3.5 w-3.5" /> note に貼る形でコピー
            </Btn>
            <Btn variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(article.title).then(() => setDone("タイトルをコピーしました"))}>
              タイトルをコピー
            </Btn>
            {article.hashtags.length > 0 && (
              <Btn variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(article.hashtags.map((t) => `#${t}`).join(" ")).then(() => setDone("ハッシュタグをコピーしました"))}>
                ハッシュタグをコピー
              </Btn>
            )}
            <a href="https://note.com/notes/new" target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1 rounded-lg border border-[#E0DBD1] bg-white px-3 text-xs text-[#2E2D29] hover:bg-[#FAF9F7]">
              note の編集画面を開く <Icon name="external" className="h-3 w-3" />
            </a>
          </>
        ) : (
          <>
            <Btn
              variant="outline"
              size="sm"
              onClick={() => {
                const html = mdToHtml(article.bodyMd, []);
                void copyRich(html, html).then(() => setDone("HTML をコピーしました（画像は含みません）"));
              }}
            >
              HTML をコピー
            </Btn>
            {wp && article.status !== "published" && (
              <Btn variant="outline" size="sm" disabled={busy !== null || !article.guard} onClick={() => run("wp-draft", () => sendAioArticleToWpAction(article.id, "draft"), "WordPress に下書きとして送りました（まだ公開されていません）。WordPress の管理画面でも確認できます")}>
                {busy === "wp-draft" ? <Icon name="loader" /> : <Icon name="send" className="h-3.5 w-3.5" />}
                {article.wpPostId ? "WordPress の下書きを更新" : "WordPress に下書きとして送る"}
              </Btn>
            )}
          </>
        )}
        <div className="ml-auto flex gap-2">
          <Btn variant="ghost" size="sm" disabled={busy !== null} onClick={() => confirm("この記事を削除しますか？") && run("delete", () => deleteAioArticleAction(article.id))}>
            削除
          </Btn>
          {isNote ? (
            <Btn variant={article.status === "published" ? "ghost" : "gold"} size="sm" disabled={busy !== null} onClick={() => (article.status === "published" ? run("unpost", () => markAioNotePostedAction(article.id, null)) : setPosting(true))}>
              <Icon name="check" className="h-3.5 w-3.5" />
              {article.status === "published" ? "未投稿に戻す" : "投稿した（URLを記録）"}
            </Btn>
          ) : wp ? (
            <Btn variant="gold" size="sm" disabled={busy !== null || !article.guard || article.guard.level === "red"} onClick={() => setApproving(true)}>
              {busy === "wp-publish" ? <Icon name="loader" /> : <Icon name="checkCircle" className="h-3.5 w-3.5" />}
              {article.status === "published" ? "承認して更新" : "承認して公開"}
            </Btn>
          ) : (
            <span className="self-center text-[11px] text-[#A5A198]">WordPress と連携すると、承認ボタンで公開できます</span>
          )}
        </div>
      </div>

      {editing && <EditDialog article={article} onClose={() => setEditing(false)} onSaved={(lv) => { setEditing(false); setDone(`保存しました（表現チェック：${LEVEL[lv]?.[0] ?? lv}）`); router.refresh(); }} />}
      {approving && wp && (
        <ApproveDialog
          article={article}
          wp={wp}
          onClose={() => setApproving(false)}
          onApprove={() => {
            setApproving(false);
            void run("wp-publish", () => sendAioArticleToWpAction(article.id, "publish"), article.status === "published" ? "WordPress の記事を更新しました" : "WordPress で公開しました");
          }}
        />
      )}
      {posting && <PostedDialog onClose={() => setPosting(false)} onSave={(url) => { setPosting(false); void run("posted", () => markAioNotePostedAction(article.id, url), "投稿済みにしました。効果のタブで数字を入れると改善案に使えます"); }} />}
    </Card>
  );
}

function ImageTile({ img, label, busy, disabled, onRegenerate }: { img: AioArticleImage; label: string; busy: boolean; disabled: boolean; onRegenerate: (prompt?: string) => void }) {
  const [edit, setEdit] = useState(false);
  const [prompt, setPrompt] = useState(img.prompt);
  return (
    <div className="rounded-lg border border-[#F0EDE8] p-1.5">
      <div className="relative aspect-video overflow-hidden rounded-md bg-[#F4F3F0]">
        {img.signedUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img.signedUrl} alt={img.alt} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center p-2 text-center text-[10px] text-[#A5A198]">{busy ? "作っています…" : img.error ? img.error : "未作成"}</div>
        )}
      </div>
      <p className="mt-1 truncate text-[10px] text-[#6B6862]">{label}</p>
      <div className="mt-1 flex flex-wrap gap-1">
        {img.signedUrl && (
          <a href={`${img.signedUrl}&download=${img.key}.png`} className="text-[10px] text-[#3E5C76] underline">
            保存
          </a>
        )}
        <button type="button" disabled={disabled} className="text-[10px] text-[#6B6862] underline disabled:opacity-40" onClick={() => setEdit((v) => !v)}>
          {busy ? "作り直し中…" : "作り直す"}
        </button>
      </div>
      {edit && (
        <div className="mt-1 space-y-1">
          <Textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} className="text-[11px]" />
          <p className="text-[10px] text-[#A5A198]">英語で場面を説明します（文字は描かせません）</p>
          <Btn size="sm" variant="outline" disabled={disabled} onClick={() => { setEdit(false); onRegenerate(prompt); }}>
            この説明で作り直す
          </Btn>
        </div>
      )}
    </div>
  );
}

function EditDialog({ article, onClose, onSaved }: { article: AioArticle; onClose: () => void; onSaved: (level: string) => void }) {
  const [title, setTitle] = useState(article.title);
  const [meta, setMeta] = useState(article.metaDescription);
  const [slug, setSlug] = useState(article.slug);
  const [body, setBody] = useState(article.bodyMd);
  const [tags, setTags] = useState(article.hashtags.join(" "));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const lv = await updateAioArticleAction(article.id, { title, metaDescription: meta, slug, bodyMd: body, hashtags: tags.split(/[\s,、]+/).filter(Boolean) });
      onSaved(lv);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存できませんでした");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="記事を直す" description="保存すると表現チェックをやり直します" className="max-w-3xl">
      <div className="space-y-3">
        <div>
          <Label>タイトル</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        {article.channel !== "note" ? (
          <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
            <div>
              <Label>説明文（検索結果に出る）</Label>
              <Input value={meta} onChange={(e) => setMeta(e.target.value)} />
            </div>
            <div>
              <Label>スラッグ（URL）</Label>
              <Input value={slug} onChange={(e) => setSlug(e.target.value)} />
            </div>
          </div>
        ) : (
          <div>
            <Label>ハッシュタグ（空白区切り）</Label>
            <Input value={tags} onChange={(e) => setTags(e.target.value)} />
          </div>
        )}
        <div>
          <Label>本文（Markdown。## が見出し）</Label>
          <Textarea rows={18} value={body} onChange={(e) => setBody(e.target.value)} className="font-mono text-xs" />
          <p className="mt-1 text-[11px] text-[#A5A198]">{bodyChars(body).toLocaleString()}字</p>
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="flex justify-end gap-2">
          <Btn variant="ghost" onClick={onClose}>やめる</Btn>
          <Btn onClick={save} disabled={saving}>
            {saving ? <Icon name="loader" /> : <Icon name="save" className="h-4 w-4" />}
            {saving ? "保存とチェック中" : "保存する"}
          </Btn>
        </div>
      </div>
    </Dialog>
  );
}

function ApproveDialog({ article, wp, onClose, onApprove }: { article: AioArticle; wp: AioWpInfo; onClose: () => void; onApprove: () => void }) {
  const [ok, setOk] = useState(false);
  const yellow = article.guard?.level === "yellow";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={article.status === "published" ? "WordPress の記事を更新しますか？" : "WordPress で公開しますか？"} description="承認するとすぐにサイトに反映されます">
      <div className="space-y-3 text-sm">
        <dl className="space-y-1 rounded-xl bg-[#FAF9F7] p-3 text-xs">
          <div className="flex gap-2"><dt className="w-20 shrink-0 text-[#8B877F]">サイト</dt><dd className="text-[#2E2D29]">{wp.siteName || wp.baseUrl}</dd></div>
          <div className="flex gap-2"><dt className="w-20 shrink-0 text-[#8B877F]">タイトル</dt><dd className="text-[#2E2D29]">{article.title}</dd></div>
          <div className="flex gap-2"><dt className="w-20 shrink-0 text-[#8B877F]">スラッグ</dt><dd className="text-[#2E2D29]">{article.slug || "（WordPress の既定）"}</dd></div>
          <div className="flex gap-2"><dt className="w-20 shrink-0 text-[#8B877F]">画像</dt><dd className="text-[#2E2D29]">{article.images.filter((i) => i.path).length}枚（アイキャッチ・本文中）</dd></div>
        </dl>
        {yellow && <p className="rounded-xl bg-[#FBF4E4] px-3 py-2 text-xs text-[#8A6A1E]">表現チェックで「要確認」の箇所があります。内容を確かめてから承認してください。</p>}
        <label className="flex items-start gap-2 text-xs text-[#2E2D29]">
          <Checkbox checked={ok} onChange={setOk} />
          <span>本文・画像・表現チェックの指摘を確認し、公開して問題ないことを確かめました</span>
        </label>
        <div className="flex justify-end gap-2">
          <Btn variant="ghost" onClick={onClose}>やめる</Btn>
          <Btn variant="gold" disabled={!ok} onClick={onApprove}>
            <Icon name="checkCircle" className="h-4 w-4" />
            {article.status === "published" ? "承認して更新" : "承認して公開"}
          </Btn>
        </div>
      </div>
    </Dialog>
  );
}

function PostedDialog({ onClose, onSave }: { onClose: () => void; onSave: (url: string) => void }) {
  const [url, setUrl] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="note に投稿した記事のURL" description="URL を記録すると、数字の取り込みと改善案で記事を見分けられます">
      <div className="space-y-3">
        <Input placeholder="https://note.com/アカウント名/n/…" value={url} onChange={(e) => setUrl(e.target.value)} />
        <div className="flex justify-end gap-2">
          <Btn variant="ghost" onClick={onClose}>やめる</Btn>
          <Btn variant="gold" disabled={!/^https:\/\/note\.com\//.test(url.trim())} onClick={() => onSave(url.trim())}>
            投稿済みにする
          </Btn>
        </div>
      </div>
    </Dialog>
  );
}
