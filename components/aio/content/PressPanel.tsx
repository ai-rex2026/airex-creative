"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  createPressReleaseAction,
  deletePressReleaseAction,
  finishPressReleaseAction,
  markPressSubmittedAction,
  regeneratePressImageAction,
  updatePressReleaseAction,
  uploadPressImageAction,
} from "@/app/aio-press-actions";
import { SectionTitle } from "@/components/meo/Workspace";
import { Btn, Card, Dialog, ErrorNote, GuardNotes, Icon, Input, Label, Select, Textarea, cn } from "@/components/meo/ui";
import { shrinkImage } from "@/components/aio/content/shrink-image";
import { bodyWithMarkers, fullSheet, pendingMarks } from "@/lib/aio/press";
import { PRESS_KINDS, PRESS_MAX_VIDEOS, PRESS_MONTHLY_LIMIT, type PressBrief, type PressImage, type PressKind, type PressRelease } from "@/lib/aio/press-types";
import type { AioProject } from "@/lib/aio/types";

/**
 * PR TIMES 向けプレスリリースの入稿内容づくり。
 * 入稿は人が PR TIMES の管理画面で行う。ここでは、項目ごとにそのまま貼れる文面と、画像・動画の挿入位置を用意する。
 */
export function PressPanel({ project, releases }: { project: AioProject; releases: (PressRelease & { images: (PressImage & { signedUrl?: string | null })[] })[] }) {
  return (
    <div className="space-y-5">
      <PressForm project={project} />
      <div className="space-y-4">
        {releases.length === 0 ? (
          <Card>
            <p className="text-sm text-[#6B6862]">まだプレスリリースがありません。上のフォームから作ると、PR TIMES の入稿画面にそのまま貼れる形で表示されます。</p>
          </Card>
        ) : (
          releases.map((r) => <PressCard key={r.id} release={r} />)
        )}
      </div>
    </div>
  );
}

// ── 作る ─────────────────────
function PressForm({ project }: { project: AioProject }) {
  const router = useRouter();
  const [kind, setKind] = useState<PressKind>("service");
  const [announcement, setAnnouncement] = useState("");
  const [facts, setFacts] = useState("");
  const [releaseDate, setReleaseDate] = useState("");
  const [note, setNote] = useState("");
  const [company, setCompany] = useState(project.name);
  const [department, setDepartment] = useState("");
  const [person, setPerson] = useState("");
  const [email, setEmail] = useState("");
  const [tel, setTel] = useState("");
  const [videos, setVideos] = useState("");
  const [phase, setPhase] = useState<null | "writing" | "finishing">(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setNotice(null);
    setPhase("writing");
    try {
      const brief: PressBrief = {
        kind,
        announcement,
        facts,
        releaseDate,
        contact: { company, department, person, email, tel },
        videos: videos
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
          .slice(0, PRESS_MAX_VIDEOS)
          .map((l) => {
            const [url, ...rest] = l.split(/\s+/);
            return { url, title: rest.join(" ") };
          }),
        note,
      };
      const created = await createPressReleaseAction(project.id, brief);
      if (!created.ok) {
        setError(created.error);
        return;
      }
      router.refresh();
      setPhase("finishing");
      const r = await finishPressReleaseAction(created.id);
      if (!r.ok) setError(`入稿内容は保存しました。画像づくりで止まりました：${r.error}。カードの「画像を作る」で続きから再開できます`);
      else if (r.failed) setNotice(`画像を${r.failed}枚作れませんでした。${r.imageErrors.length ? `理由：${r.imageErrors.join(" / ")}。` : ""}カードから作り直すか、自分の画像をアップロードできます`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "プレスリリースを作れませんでした");
    } finally {
      setPhase(null);
    }
  };

  const busy = phase !== null;
  return (
    <Card>
      <SectionTitle>PR TIMES に入稿するプレスリリースを作る</SectionTitle>
      <p className="mt-1 text-xs leading-relaxed text-[#8B877F]">
        入力した事実だけで、タイトル案・リード文・本文・会社概要・画像・動画の位置までを作ります。入力にない数字・日付は書かず、【要確認】の印で残します。入稿は PR TIMES の管理画面で、人が行います（今月あと{PRESS_MONTHLY_LIMIT}本まで作れます）。
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="pr-kind">リリースの種類</Label>
          <Select id="pr-kind" className="mt-1" value={kind} onChange={(v) => setKind(v as PressKind)} options={PRESS_KINDS.map((k) => ({ value: k.kind, label: k.label }))} />
        </div>
        <div>
          <Label htmlFor="pr-date">配信を希望する日（任意）</Label>
          <Input id="pr-date" className="mt-1" type="date" value={releaseDate} onChange={(e) => setReleaseDate(e.target.value)} />
        </div>
      </div>
      <div className="mt-3">
        <Label htmlFor="pr-ann">何を発表しますか（必須）</Label>
        <Textarea id="pr-ann" className="mt-1" rows={3} value={announcement} onChange={(e) => setAnnouncement(e.target.value)} placeholder="例: 飲食店向けの予約管理サービス「〇〇」の提供を開始する。小規模店舗の電話対応の負担を減らすことが目的" />
      </div>
      <div className="mt-3">
        <Label htmlFor="pr-facts">確かな事実（数字・日付・価格・対象・実績など）</Label>
        <Textarea id="pr-facts" className="mt-1" rows={4} value={facts} onChange={(e) => setFacts(e.target.value)} placeholder={"例:\n提供開始日: 2026年11月1日\n月額: 9,800円（税込）\n対象: 席数30席以下の飲食店\n先行導入: 12店舗"} />
        <p className="mt-1 text-[11px] text-[#A5A198]">ここに書いた数字・日付だけを使います。書いていないものは【要確認】として残します。</p>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="pr-video">本文に入れたい動画のURL（YouTubeなど・1行に1本・最大{PRESS_MAX_VIDEOS}本。URLのあとに題名を入れられます）</Label>
          <Textarea id="pr-video" className="mt-1" rows={3} value={videos} onChange={(e) => setVideos(e.target.value)} placeholder={"https://www.youtube.com/watch?v=xxxx サービス紹介動画"} />
        </div>
        <div>
          <Label htmlFor="pr-note">補足（任意）</Label>
          <Textarea id="pr-note" className="mt-1" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="例: 導入の手軽さを中心に。競合との比較は書かない" />
        </div>
      </div>
      <p className="mt-4 text-xs font-semibold text-[#2E2D29]">問い合わせ先（PR TIMES の問い合わせ欄に使います）</p>
      <div className="mt-2 grid gap-3 sm:grid-cols-3">
        <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="会社名" />
        <Input value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="部署（任意）" />
        <Input value={person} onChange={(e) => setPerson(e.target.value)} placeholder="担当者名" />
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="メールアドレス" />
        <Input value={tel} onChange={(e) => setTel(e.target.value)} placeholder="電話番号" />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Btn onClick={submit} disabled={busy || announcement.trim().length < 10}>
          {busy ? <Icon name="loader" /> : <Icon name="sparkles" className="h-3.5 w-3.5" />}
          {phase === "writing" ? "入稿内容を作っています（1〜3分）…" : phase === "finishing" ? "画像を作っています（1〜2分）…" : "入稿内容を作る"}
        </Btn>
        {phase && <p className="text-xs text-[#6B6862]">{phase === "writing" ? "① タイトル案・リード・本文・会社概要を作り、表現チェックを通しています" : "② 文字の入らない画像（メイン画像＋本文中）を作っています"}</p>}
      </div>
      {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
      {notice && <p className="mt-3 text-xs text-[#8A5340]">{notice}</p>}
    </Card>
  );
}

// ── 1本分 ─────────────────────
const LEVEL: Record<string, [string, string]> = {
  red: ["要修正", "bg-[#FBEDE9] text-[#A8705A]"],
  yellow: ["要確認", "bg-[#FBF4E4] text-[#8A6A1E]"],
  green: ["問題なし", "bg-[#EAF3EE] text-[#2F6B4A]"],
};

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1800);
    } catch {
      setCopied(null);
    }
  };
  return { copied, copy };
}

function Field({ id, label, text, hint, copied, onCopy, multiline }: { id: string; label: string; text: string; hint?: string; copied: string | null; onCopy: (k: string, t: string) => void; multiline?: boolean }) {
  if (!text) return null;
  return (
    <div className="rounded-xl border border-[#F0EDE8] p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-[#2E2D29]">{label}</p>
        <button type="button" className="text-xs text-[#3E5C76] underline" onClick={() => onCopy(id, text)}>
          {copied === id ? "コピーしました" : "コピー"}
        </button>
      </div>
      {hint && <p className="mt-0.5 text-[11px] text-[#A5A198]">{hint}</p>}
      <p className={cn("mt-1.5 text-sm leading-relaxed text-[#4A4843]", multiline ? "whitespace-pre-wrap" : "")}>{text}</p>
    </div>
  );
}

function PressCard({ release }: { release: PressRelease & { images: (PressImage & { signedUrl?: string | null })[] } }) {
  const router = useRouter();
  const { copied, copy } = useCopy();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const c = release.content;
  const [levelText, levelCls] = release.guard ? (LEVEL[release.guard.level] ?? LEVEL.green) : ["チェック前", "bg-[#F4F3F0] text-[#6B6862]"];
  const eye = release.images.find((i) => i.role === "eyecatch");
  const inline = release.images.filter((i) => i.role === "inline");
  const missing = !release.guard || release.images.some((i) => !i.path && !i.hasText);
  const pending = pendingMarks(release);

  const run = async (key: string, fn: () => Promise<{ ok: boolean; error?: string; failed?: number; imageErrors?: string[] }>, ok?: string) => {
    setBusy(key);
    setError(null);
    setDone(null);
    try {
      const r = await fn();
      if (!r.ok) throw new Error(r.error || "うまくいきませんでした");
      if (r.failed) throw new Error(`画像を${r.failed}枚作れませんでした${r.imageErrors?.length ? `：${r.imageErrors.join(" / ")}` : ""}`);
      if (ok) setDone(ok);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", levelCls)}>表現チェック：{levelText}</span>
            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", release.status === "submitted" ? "bg-[#EAF3EE] text-[#2F6B4A]" : "bg-[#F4F3F0] text-[#57544E]")}>{release.status === "submitted" ? "入稿済み" : "入稿前"}</span>
            {pending.length > 0 && <span className="rounded-full bg-[#FBF4E4] px-2 py-0.5 text-[11px] font-semibold text-[#8A6A1E]">【要確認】{pending.length}件</span>}
          </div>
          <h3 className="mt-2 font-semibold text-[#2E2D29]">{c.title}</h3>
          <p className="mt-0.5 text-[11px] text-[#A5A198]">{new Date(release.createdAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })} 作成</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Btn size="sm" variant="outline" onClick={() => copy("all", fullSheet(release))}>
            <Icon name="file" className="h-3.5 w-3.5" />
            {copied === "all" ? "コピーしました" : "全文をコピー"}
          </Btn>
          <Btn size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
            {open ? "たたむ" : "入稿内容を開く"}
          </Btn>
        </div>
      </div>

      {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
      {done && <p className="mt-3 text-xs text-[#2F6B4A]">{done}</p>}

      {open && (
        <div className="mt-4 space-y-3">
          {release.guard && release.guard.hits.length > 0 && <GuardNotes hits={release.guard.hits} />}
          {pending.length > 0 && (
            <div className="rounded-xl bg-[#FBF4E4] p-3 text-xs leading-relaxed text-[#8A6A1E]">
              <p className="font-semibold">入稿前に、次の【要確認】を埋めてください（「直す」から編集できます）</p>
              <p className="mt-1">{pending.join(" / ")}</p>
            </div>
          )}

          <div className="grid gap-3">
            {c.titleOptions.length > 1 && (
              <Field id="titles" label="タイトル案（上が採用中）" text={c.titleOptions.map((t, i) => `${i + 1}. ${t}`).join("\n")} copied={copied} onCopy={copy} multiline />
            )}
            <Field id="title" label="タイトル" text={c.title} copied={copied} onCopy={copy} />
            <Field id="subtitle" label="サブタイトル" text={c.subtitle} hint="PR TIMES の入稿画面にサブタイトル欄があれば使います" copied={copied} onCopy={copy} />
            <Field id="lead" label="リード文" text={c.lead} copied={copied} onCopy={copy} multiline />
            <Field id="body" label="本文（画像・動画の入れる位置を［ ］で示しています）" text={bodyWithMarkers(release)} copied={copied} onCopy={copy} multiline />
            <Field id="keywords" label="キーワード" text={c.keywords.join("、")} copied={copied} onCopy={copy} />
            <Field id="company" label="会社概要" text={c.companyProfile} copied={copied} onCopy={copy} multiline />
            <Field id="contact" label="問い合わせ先" text={c.contactText} copied={copied} onCopy={copy} multiline />
            <Field id="links" label="関連リンク" text={c.relatedLinks.map((l) => `${l.label}：${l.url}`).join("\n")} copied={copied} onCopy={copy} multiline />
          </div>

          <div>
            <p className="text-xs font-semibold text-[#2E2D29]">画像（メイン画像と、本文に入れる画像）</p>
            <p className="mt-0.5 text-[11px] text-[#A5A198]">画像を保存して PR TIMES の入稿画面でアップロードし、本文の［ ］の位置に入れてください。自分の画像に差し替えることもできます。画像の中には文字を入れません。</p>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {eye && <PressImageTile releaseId={release.id} img={eye} label="メイン画像" busy={busy} onRun={run} copied={copied} onCopy={copy} />}
              {inline.map((img, k) => (
                <PressImageTile key={img.key} releaseId={release.id} img={img} label={`画像${k + 1}（見出し${(img.afterH2 ?? 0) + 1}の後）`} busy={busy} onRun={run} copied={copied} onCopy={copy} />
              ))}
            </div>
            {missing && (
              <div className="mt-3 flex items-center gap-3 rounded-xl bg-[#FBF8F3] px-3 py-2">
                <p className="flex-1 text-xs text-[#8A5340]">{!release.guard ? "表現チェックと画像がまだです。" : "まだ作れていない画像があります。"}</p>
                <Btn size="sm" variant="gold" disabled={busy !== null} onClick={() => run("finish", () => finishPressReleaseAction(release.id), "仕上げました")}>
                  {busy === "finish" ? <Icon name="loader" /> : <Icon name="sparkles" className="h-3.5 w-3.5" />}
                  {busy === "finish" ? "作っています（1〜2分）" : "画像を作る"}
                </Btn>
              </div>
            )}
          </div>

          {c.videos.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-[#2E2D29]">動画</p>
              <p className="mt-0.5 text-[11px] text-[#A5A198]">動画の挿入方法（URL の貼り付けなど）は PR TIMES の入稿画面で確認してください。入れる位置は本文の［ここに動画…］です。</p>
              <ul className="mt-2 space-y-1">
                {c.videos.map((v, k) => (
                  <li key={v.url} className="flex flex-wrap items-center gap-2 text-sm text-[#4A4843]">
                    <span className="text-xs text-[#6B6862]">動画{k + 1}（見出し{v.afterH2 + 1}の後）</span>
                    <a href={v.url} target="_blank" rel="noreferrer" className="break-all text-xs text-[#3E5C76] underline">{v.title || v.url}</a>
                    <button type="button" className="text-xs text-[#3E5C76] underline" onClick={() => copy(`v${k}`, v.url)}>{copied === `v${k}` ? "コピーしました" : "URLをコピー"}</button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-xl border border-[#F0EDE8] p-3">
            <p className="text-xs font-semibold text-[#2E2D29]">入稿前のチェック</p>
            <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-xs leading-relaxed text-[#6B6862]">
              <li>【要確認】の印がすべて埋まっている（本文・会社概要・問い合わせ先）</li>
              <li>数字・日付・固有名詞が事実と合っている</li>
              <li>表現チェックの指摘に対応した</li>
              <li>画像と動画が入る位置を確認した</li>
              <li>PR TIMES の掲載基準・配信条件を満たしている（新しい情報であること等は、PR TIMES の案内で確認してください）</li>
              {c.todo.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>

          <div className="flex flex-wrap gap-2 border-t border-[#F0EDE8] pt-3">
            <Btn size="sm" variant="outline" disabled={busy !== null} onClick={() => setEditing(true)}>
              直す
            </Btn>
            <Btn size="sm" variant="outline" disabled={busy !== null} onClick={() => run("submitted", () => markPressSubmittedAction(release.id, release.status !== "submitted"), release.status === "submitted" ? "入稿前に戻しました" : "入稿済みにしました")}>
              {release.status === "submitted" ? "入稿前に戻す" : "PR TIMES に入稿した（印を付ける）"}
            </Btn>
            <Btn
              size="sm"
              variant="ghost"
              disabled={busy !== null}
              onClick={() => {
                if (window.confirm("このプレスリリースを削除します。よろしいですか？")) void run("delete", () => deletePressReleaseAction(release.id));
              }}
            >
              削除
            </Btn>
          </div>
        </div>
      )}
      {editing && (
        <PressEditDialog
          release={release}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            setDone("保存しました。表現チェックをやり直しました");
            router.refresh();
          }}
        />
      )}
    </Card>
  );
}

function PressImageTile({
  releaseId,
  img,
  label,
  busy,
  onRun,
  copied,
  onCopy,
}: {
  releaseId: string;
  img: PressImage & { signedUrl?: string | null };
  label: string;
  busy: string | null;
  onRun: (key: string, fn: () => Promise<{ ok: boolean; error?: string }>, ok?: string) => Promise<void>;
  copied: string | null;
  onCopy: (k: string, t: string) => void;
}) {
  const [edit, setEdit] = useState(false);
  const [prompt, setPrompt] = useState(img.prompt);
  const mine = busy === `img-${img.key}`;
  const disabled = busy !== null;
  const upload = async (file: File | undefined) => {
    if (!file) return;
    const form = new FormData();
    form.set("file", await shrinkImage(file));
    await onRun(`img-${img.key}`, () => uploadPressImageAction(releaseId, img.key, form), "画像を差し替えました");
  };
  return (
    <div className="rounded-lg border border-[#F0EDE8] p-1.5">
      <div className="relative aspect-video overflow-hidden rounded-md bg-[#F4F3F0]">
        {img.signedUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img.signedUrl} alt={img.alt} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center p-2 text-center text-[10px] text-[#A5A198]">{mine ? "作っています…" : img.error ? img.error : "未作成"}</div>
        )}
      </div>
      <p className="mt-1 truncate text-[10px] text-[#6B6862]">
        {label}
        {img.source === "upload" ? "（自分の画像）" : ""}
      </p>
      <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
        {img.signedUrl && (
          <a href={`${img.signedUrl}&download=${img.key}`} className="text-[10px] text-[#3E5C76] underline">
            保存
          </a>
        )}
        {img.caption && (
          <button type="button" className="text-[10px] text-[#3E5C76] underline" onClick={() => onCopy(`cap-${img.key}`, img.caption ?? "")}>
            {copied === `cap-${img.key}` ? "コピーしました" : "説明文をコピー"}
          </button>
        )}
        <button type="button" disabled={disabled} className="text-[10px] text-[#6B6862] underline disabled:opacity-40" onClick={() => setEdit((v) => !v)}>
          {mine ? "処理中…" : "作り直す・差し替える"}
        </button>
      </div>
      {edit && (
        <div className="mt-1 space-y-1">
          <Textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} className="text-[11px]" />
          <p className="text-[10px] text-[#A5A198]">英語で場面を説明します（文字は描かせません）</p>
          <Btn
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => {
              setEdit(false);
              void onRun(`img-${img.key}`, () => regeneratePressImageAction(releaseId, img.key, prompt), "画像を作り直しました");
            }}
          >
            この説明でAIで作り直す
          </Btn>
          <label className={cn("block cursor-pointer text-[11px] text-[#3E5C76] underline", disabled && "pointer-events-none opacity-40")}>
            自分の画像をアップロードして差し替える
            <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={disabled} onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
        </div>
      )}
    </div>
  );
}

function PressEditDialog({ release, onClose, onSaved }: { release: PressRelease; onClose: () => void; onSaved: () => void }) {
  const c = release.content;
  const [title, setTitle] = useState(c.title);
  const [subtitle, setSubtitle] = useState(c.subtitle);
  const [lead, setLead] = useState(c.lead);
  const [body, setBody] = useState(c.bodyMd);
  const [keywords, setKeywords] = useState(c.keywords.join("、"));
  const [company, setCompany] = useState(c.companyProfile);
  const [contact, setContact] = useState(c.contactText);
  const [captions, setCaptions] = useState<Record<string, string>>(Object.fromEntries(release.images.map((i) => [i.key, i.caption ?? ""])));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const r = await updatePressReleaseAction(release.id, {
        title,
        subtitle,
        lead,
        bodyMd: body,
        keywords: keywords.split(/[、,]/).map((k) => k.trim()).filter(Boolean),
        companyProfile: company,
        contactText: contact,
        todo: c.todo,
        images: release.images.map((i) => ({ key: i.key, alt: i.alt, caption: captions[i.key] ?? "" })),
      });
      if (!r.ok) throw new Error(r.error);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存できませんでした");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="入稿内容を直す" description="【要確認】の印を事実で置き換えてください。保存すると表現チェックをやり直します" className="max-w-2xl">
      <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
        <div>
          <Label htmlFor="pe-title">タイトル</Label>
          <Input id="pe-title" className="mt-1" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="pe-sub">サブタイトル</Label>
          <Input id="pe-sub" className="mt-1" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="pe-lead">リード文</Label>
          <Textarea id="pe-lead" className="mt-1" rows={4} value={lead} onChange={(e) => setLead(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="pe-body">本文（見出しは ## ）</Label>
          <Textarea id="pe-body" className="mt-1 font-mono text-xs" rows={14} value={body} onChange={(e) => setBody(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="pe-kw">キーワード（「、」区切り）</Label>
          <Input id="pe-kw" className="mt-1" value={keywords} onChange={(e) => setKeywords(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="pe-co">会社概要</Label>
          <Textarea id="pe-co" className="mt-1" rows={5} value={company} onChange={(e) => setCompany(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="pe-ct">問い合わせ先</Label>
          <Textarea id="pe-ct" className="mt-1" rows={4} value={contact} onChange={(e) => setContact(e.target.value)} />
        </div>
        {release.images.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-[#2E2D29]">画像の説明文（日本語）</p>
            {release.images.map((i) => (
              <Input key={i.key} value={captions[i.key] ?? ""} onChange={(e) => setCaptions((m) => ({ ...m, [i.key]: e.target.value }))} placeholder={i.role === "eyecatch" ? "メイン画像の説明" : `${i.key} の説明`} />
            ))}
          </div>
        )}
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Btn variant="outline" onClick={onClose} disabled={saving}>
          キャンセル
        </Btn>
        <Btn onClick={save} disabled={saving || !title.trim() || body.trim().length < 200}>
          {saving ? <Icon name="loader" /> : null}
          保存する
        </Btn>
      </div>
    </Dialog>
  );
}
