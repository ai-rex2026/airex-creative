"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  deleteSnsPostAction,
  generateSnsDraftsAction,
  markSnsPostPublishedAction,
  publishSnsPostAction,
  saveSnsSettingsAction,
  skipSnsPostAction,
  updateSnsPostAction,
} from "@/app/sns-actions";
import { MeoPageHeader, SectionTitle } from "@/components/meo/Workspace";
import { FilterPills, TagInput } from "@/components/meo/parts";
import { Btn, Card, Checkbox, Dialog, ErrorNote, GuardNotes, Icon, Input, Label, Select, Switch, Textarea, cn, useSaveFeedback } from "@/components/meo/ui";
import { composeBody, PLATFORM_STYLE, WEEKDAY_LABEL, type SnsAccount, type SnsPost, type SnsSettings } from "@/lib/sns-ops/types";
import { SNS_PLATFORMS, type SnsPlatform } from "@/lib/social-connect/platforms";
import { INDUSTRY_LABEL, type Industry } from "@/lib/types";

/**
 * SNS運用の画面。上から「連携アカウント」「投稿案を作る」「投稿案（確認して投稿）」「自動運用の設定」。
 * 投稿は必ず人が本文を見て押す。赤の指摘がある案は投稿ボタンを出さない（直してから）。
 */

type Filter = "all" | "draft" | "published" | "skipped";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "すべて" },
  { key: "draft", label: "確認待ち" },
  { key: "published", label: "投稿済み" },
  { key: "skipped", label: "使わない" },
];

const LEVEL_LABEL: Record<string, [string, string]> = {
  red: ["要修正", "bg-[#FBEDE9] text-[#A8705A]"],
  yellow: ["要確認", "bg-[#FBF4E4] text-[#8A6A1E]"],
  green: ["問題なし", "bg-[#EAF3EE] text-[#2F6B4A]"],
};

export function SnsWorkspace({ accounts, posts, settings }: { accounts: SnsAccount[]; posts: SnsPost[]; settings: SnsSettings }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  // ── 投稿案を作る ──
  const [topic, setTopic] = useState("");
  const [targets, setTargets] = useState<SnsPlatform[]>(() => accounts.map((a) => a.platform));
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<string | null>(null);

  const generate = async () => {
    setError(null);
    setGenerated(null);
    setGenerating(true);
    try {
      const r = await generateSnsDraftsAction(topic, targets);
      setGenerated(`${r.count}件の投稿案を作りました。下の「確認待ち」から内容を確認してください`);
      setTopic("");
      setFilter("draft");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "投稿案を作れませんでした");
    } finally {
      setGenerating(false);
    }
  };

  // ── 一覧 ──
  const [filter, setFilter] = useState<Filter>("draft");
  const visible = useMemo(() => posts.filter((p) => filter === "all" || p.status === filter), [posts, filter]);
  const counts: Record<Filter, number> = {
    all: posts.length,
    draft: posts.filter((p) => p.status === "draft").length,
    published: posts.filter((p) => p.status === "published").length,
    skipped: posts.filter((p) => p.status === "skipped").length,
  };
  const byPlatform = new Map(accounts.map((a) => [a.platform, a]));

  const run = async (fn: () => Promise<unknown>, fallback: string) => {
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : fallback);
      router.refresh();
    }
  };

  return (
    <div className="space-y-6">
      <MeoPageHeader icon="send" title="SNS運用" description="連携した公式アカウント向けに、媒体ごとに文面を変えた投稿案をAIが作ります。投稿は内容を確認してから" />

      {/* 連携アカウント */}
      <Card>
        <div className="flex items-center justify-between gap-3">
          <SectionTitle>連携しているアカウント</SectionTitle>
          <Link href="/settings" className="text-xs text-[#6B6862] underline">
            設定で連携を変える
          </Link>
        </div>
        {accounts.length === 0 ? (
          <div className="mt-3 rounded-xl border border-dashed border-[#D8D4CC] bg-[#FAF9F7] p-5 text-center">
            <p className="text-sm font-medium text-[#2E2D29]">公式SNSアカウントがまだ連携されていません</p>
            <p className="mt-1 text-sm text-[#8B877F]">X・Instagram・TikTok のうち運用するアカウントを設定画面で連携すると、ここから投稿案を作れます</p>
            <Link href="/settings" className="btn sm" style={{ marginTop: 14 }}>
              設定で連携する<span className="arw">→</span>
            </Link>
          </div>
        ) : (
          <ul className="mt-3 grid gap-2 sm:grid-cols-3">
            {SNS_PLATFORMS.map((def) => {
              const a = byPlatform.get(def.id);
              return (
                <li key={def.id} className={cn("rounded-xl border p-3", a ? "border-[#E8E5E0] bg-white" : "border-dashed border-[#D8D4CC] bg-[#FAF9F7]")}>
                  <p className="text-sm font-semibold text-[#2E2D29]">{def.name}</p>
                  {a ? (
                    <>
                      <p className="mt-0.5 text-xs text-[#6B6862]">
                        {a.label ? `@${a.label}` : "連携済み"}
                        {a.followers != null ? `・フォロワー ${a.followers.toLocaleString("ja-JP")}` : ""}
                      </p>
                      <p className={cn("mt-1.5 text-[11px] leading-relaxed", a.canPublishViaApi ? "text-[#2F6B4A]" : "text-[#8B877F]")}>
                        {a.canPublishViaApi ? "ここから直接投稿できます" : a.publishNote}
                      </p>
                    </>
                  ) : (
                    <p className="mt-0.5 text-xs text-[#A5A198]">
                      未連携 ・ <Link href="/settings" className="underline">設定で連携</Link>
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* 投稿案を作る */}
      <Card>
        <SectionTitle>投稿案を作る</SectionTitle>
        <p className="mt-1 text-xs text-[#8B877F]">テーマを1つ書くと、選んだ媒体ごとに体裁と長さを変えた案を作ります（同じ文章の使い回しはしません）。文面は作成と同時に表現チェックを通します</p>
        <div className="mt-3 space-y-3">
          <Textarea
            rows={3}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="例：今月から新メニュー「〇〇」を始めました。平日限定で先着20名にお試し価格。予約はWebから"
            disabled={accounts.length === 0 || generating}
          />
          <div className="flex flex-wrap items-center gap-4">
            {accounts.map((a) => (
              <label key={a.platform} className="flex items-center gap-2 text-sm text-[#2E2D29]">
                <Checkbox checked={targets.includes(a.platform)} onChange={(v) => setTargets((t) => (v ? [...new Set([...t, a.platform])] : t.filter((x) => x !== a.platform)))} />
                {PLATFORM_STYLE[a.platform].name}
              </label>
            ))}
            <Btn className="ml-auto" onClick={generate} disabled={accounts.length === 0 || generating || !topic.trim() || targets.length === 0}>
              {generating ? <Icon name="loader" /> : <Icon name="sparkles" />}
              {generating ? "作成中（30秒ほど）" : "媒体ごとの投稿案を作る"}
            </Btn>
          </div>
          {generated && <p className="text-sm text-[#2F6B4A]">{generated}</p>}
        </div>
      </Card>

      {error && <ErrorNote>{error}</ErrorNote>}

      {/* 投稿案一覧 */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <SectionTitle>投稿案</SectionTitle>
          <FilterPills items={FILTERS} value={filter} counts={counts} onChange={setFilter} />
        </div>
        {visible.length === 0 ? (
          <div className="rounded-2xl border border-[#E8E5E0] bg-white p-10 text-center">
            <p className="text-sm font-medium text-[#2E2D29]">{filter === "draft" ? "確認待ちの投稿案はありません" : "投稿案がありません"}</p>
            <p className="mt-1 text-sm text-[#8B877F]">上の「投稿案を作る」からテーマを入れるか、自動運用をオンにすると週1で案が届きます</p>
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {visible.map((p) => (
              <SnsPostCard
                key={p.id}
                post={p}
                account={byPlatform.get(p.platform) ?? null}
                onPublish={() => run(() => publishSnsPostAction(p.id), "投稿に失敗しました")}
                onMarkPublished={() => run(() => markSnsPostPublishedAction(p.id), "更新に失敗しました")}
                onSkip={() => run(() => skipSnsPostAction(p.id), "更新に失敗しました")}
                onDelete={() => run(() => deleteSnsPostAction(p.id), "削除に失敗しました")}
                onSaved={() => router.refresh()}
              />
            ))}
          </div>
        )}
      </section>

      <SnsSettingsCard settings={settings} hasAccounts={accounts.length > 0} />
    </div>
  );
}

// ── 投稿案カード ─────────────────────────────────
function SnsPostCard({
  post,
  account,
  onPublish,
  onMarkPublished,
  onSkip,
  onDelete,
  onSaved,
}: {
  post: SnsPost;
  account: SnsAccount | null;
  onPublish: () => Promise<void>;
  onMarkPublished: () => Promise<void>;
  onSkip: () => Promise<void>;
  onDelete: () => Promise<void>;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(post.body);
  const [tags, setTags] = useState<string[]>(post.hashtags);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const style = PLATFORM_STYLE[post.platform];
  const level = post.guard?.level ?? "green";
  const [levelText, levelCls] = LEVEL_LABEL[level] ?? LEVEL_LABEL.green;
  const full = composeBody(post.body, post.hashtags);
  const over = post.body.length > style.maxChars;

  const save = async () => {
    setSaving(true);
    setLocalError(null);
    try {
      await updateSnsPostAction(post.id, body, tags);
      setEditing(false);
      onSaved();
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "保存できませんでした");
    } finally {
      setSaving(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(full);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setLocalError("コピーできませんでした。本文を選択してコピーしてください");
    }
  };

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-[#2E2D29] px-2.5 py-0.5 text-[11px] font-semibold text-white">{style.name}</span>
        <span className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-semibold", levelCls)}>表現チェック：{levelText}</span>
        {post.source === "auto" && <span className="rounded-full bg-[#F4F3F0] px-2.5 py-0.5 text-[11px] text-[#6B6862]">自動運用</span>}
        {post.status === "published" && (
          <span className="rounded-full bg-[#EAF3EE] px-2.5 py-0.5 text-[11px] font-semibold text-[#2F6B4A]">
            投稿済み{post.publishedVia === "api" ? "（APIで送信）" : "（コピーして投稿）"}
          </span>
        )}
        {post.status === "skipped" && <span className="rounded-full bg-[#F4F3F0] px-2.5 py-0.5 text-[11px] text-[#8B877F]">使わない</span>}
        <span className="ml-auto text-[11px] text-[#A5A198]">{new Date(post.createdAt).toLocaleDateString("ja-JP")}</span>
      </div>

      <p className="text-xs text-[#8B877F]">テーマ：{post.topic}</p>

      {editing ? (
        <div className="space-y-2">
          <Textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
          <p className={cn("text-right text-[11px]", body.length > style.maxChars ? "text-[#A8705A]" : "text-[#A5A198]")}>
            {body.length} / {style.maxChars}字
          </p>
          <TagInput id={`tags-${post.id}`} values={tags} placeholder="ハッシュタグ（Enterで追加）" onChange={setTags} />
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" size="sm" onClick={() => { setEditing(false); setBody(post.body); setTags(post.hashtags); }} disabled={saving}>
              やめる
            </Btn>
            <Btn size="sm" onClick={save} disabled={saving || !body.trim()}>
              {saving ? <Icon name="loader" /> : <Icon name="save" />}
              保存して再チェック
            </Btn>
          </div>
        </div>
      ) : (
        <div className="whitespace-pre-wrap rounded-xl bg-[#FAF9F7] p-3 text-sm leading-relaxed text-[#2E2D29]">{full}</div>
      )}

      {!editing && over && <p className="text-xs text-[#A8705A]">本文が{style.maxChars}字を超えています。編集で短くしてください</p>}
      {post.guard && post.guard.hits.length > 0 && <GuardNotes hits={post.guard.hits} />}
      {post.errorMessage && post.status !== "published" && <ErrorNote>{post.errorMessage}</ErrorNote>}
      {localError && <ErrorNote>{localError}</ErrorNote>}

      {post.status === "draft" && !editing && (
        <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-[#F0EDE8] pt-3">
          <Btn variant="outline" size="sm" onClick={() => setEditing(true)} disabled={busy}>
            編集
          </Btn>
          <Btn variant="outline" size="sm" onClick={copy} disabled={busy}>
            <Icon name={copied ? "check" : "file"} className="h-3.5 w-3.5" />
            {copied ? "コピーしました" : "本文をコピー"}
          </Btn>
          <div className="ml-auto flex flex-wrap gap-2">
            <Btn variant="ghost" size="sm" onClick={() => act(onSkip)} disabled={busy}>
              使わない
            </Btn>
            {account?.canPublishViaApi ? (
              <Btn size="sm" onClick={() => setConfirming(true)} disabled={busy || level === "red" || over} title={level === "red" ? "赤の指摘を直してから投稿できます" : undefined}>
                <Icon name="send" className="h-3.5 w-3.5" />
                確認して投稿
              </Btn>
            ) : (
              <Btn size="sm" variant="gold" onClick={() => act(onMarkPublished)} disabled={busy}>
                <Icon name="check" className="h-3.5 w-3.5" />
                アプリで投稿した
              </Btn>
            )}
          </div>
        </div>
      )}
      {post.status !== "draft" && (
        <div className="mt-auto flex items-center gap-2 border-t border-[#F0EDE8] pt-3">
          {post.status === "published" && post.externalId && post.platform === "x" && (
            <a className="text-xs text-[#6B6862] underline" href={`https://x.com/i/web/status/${post.externalId}`} target="_blank" rel="noreferrer">
              Xで開く
            </a>
          )}
          <Btn variant="ghost" size="sm" className="ml-auto" onClick={() => act(onDelete)} disabled={busy}>
            削除
          </Btn>
        </div>
      )}

      <Dialog open={confirming} onOpenChange={setConfirming} title={`${style.name} に投稿しますか？`} description="この文面がそのまま公式アカウントから投稿されます。取り消しは各媒体の画面から行います">
        <div className="whitespace-pre-wrap rounded-xl bg-[#FAF9F7] p-3 text-sm leading-relaxed text-[#2E2D29]">{full}</div>
        <div className="mt-4 flex justify-end gap-2">
          <Btn variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
            やめる
          </Btn>
          <Btn
            onClick={async () => {
              await act(async () => {
                await onPublish();
                setConfirming(false);
              });
            }}
            disabled={busy}
          >
            {busy ? <Icon name="loader" /> : <Icon name="send" />}
            投稿する
          </Btn>
        </div>
      </Dialog>
    </Card>
  );
}

// ── 自動運用の設定 ─────────────────────────────────
function SnsSettingsCard({ settings, hasAccounts }: { settings: SnsSettings; hasAccounts: boolean }) {
  const [s, setS] = useState<SnsSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { isSaved, notifySaved } = useSaveFeedback();
  const router = useRouter();

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      await saveSnsSettingsAction(s);
      notifySaved();
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "保存できませんでした");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <div>
          <SectionTitle>自動運用</SectionTitle>
          <p className="mt-1 text-xs text-[#8B877F]">オンにすると、毎週決めた曜日の朝に AI がテーマを決めて媒体ごとの投稿案を作り、「確認待ち」に入れます。投稿は人が確認して押します（自動では投稿しません）</p>
        </div>
        <Switch checked={s.autoEnabled} onChange={(v) => setS({ ...s, autoEnabled: v })} />
      </div>
      {!hasAccounts && s.autoEnabled && <p className="mt-2 text-xs text-[#A8705A]">アカウントが未連携のため、連携するまで案は作られません</p>}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="sns-weekday">作る曜日</Label>
          <Select id="sns-weekday" value={String(s.autoWeekday)} onChange={(v) => setS({ ...s, autoWeekday: Number(v) })} options={WEEKDAY_LABEL.map((w, i) => ({ value: String(i), label: `${w}曜日` }))} className="mt-1" />
        </div>
        <div>
          <Label htmlFor="sns-industry">業種（表現チェックの基準）</Label>
          <Select id="sns-industry" value={s.industry} onChange={(v) => setS({ ...s, industry: v as Industry })} options={(Object.keys(INDUSTRY_LABEL) as Industry[]).map((k) => ({ value: k, label: INDUSTRY_LABEL[k] }))} className="mt-1" />
        </div>
        <div>
          <Label htmlFor="sns-brand">事業者名・ブランド名</Label>
          <Input id="sns-brand" className="mt-1" value={s.brandName} onChange={(e) => setS({ ...s, brandName: e.target.value })} placeholder="例：〇〇サロン 渋谷店" />
        </div>
        <div>
          <Label htmlFor="sns-url">Webサイト（任意）</Label>
          <Input id="sns-url" className="mt-1" value={s.brandUrl} onChange={(e) => setS({ ...s, brandUrl: e.target.value })} placeholder="https://" />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="sns-notes">事業の前提（AIに渡す内容・強み・書いてはいけないこと）</Label>
          <Textarea id="sns-notes" rows={4} className="mt-1" value={s.brandNotes} onChange={(e) => setS({ ...s, brandNotes: e.target.value })} placeholder="例：女性向けの美容室。カラーとトリートメントが中心。価格は書かない。スタッフの名前は出さない" />
        </div>
      </div>
      {err && <div className="mt-3"><ErrorNote>{err}</ErrorNote></div>}
      <div className="mt-4 flex items-center justify-end gap-3">
        {isSaved && <span className="text-xs text-[#2F6B4A]">保存しました</span>}
        <Btn onClick={save} disabled={saving}>
          {saving ? <Icon name="loader" /> : <Icon name="save" />}
          設定を保存
        </Btn>
      </div>
    </Card>
  );
}
