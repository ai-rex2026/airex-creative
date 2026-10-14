"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { runMediaStepAction, saveMediaOpsAction } from "@/app/sns-media-actions";
import { Btn, Card, Icon, Input, Label, Select, Switch, Textarea, cn } from "@/components/meo/ui";
import { SectionTitle } from "@/components/meo/Workspace";
import { ApprovalList, Notes, ObservedTable, useStep } from "@/components/sns/ops/XOps";
import { MaterialsPanel } from "@/components/sns/ops/MaterialsPanel";
import { VideoCard } from "@/components/sns/ops/VideoCard";
import type { MediaOpsConfig } from "@/lib/sns-ops/media-run";
import type { MediaPlatform } from "@/lib/sns-ops/media-brain";
import type { InboxMessage, ObservedPost, OpsPost, PatternReport } from "@/lib/sns-ops/ops-types";
import { VOICES, type Material, type SnsVideo, type VideoFormat } from "@/lib/sns-ops/video-types";

type Tab = "videos" | "posts" | "comments" | "dm" | "materials" | "analysis" | "settings";

const TABS: Record<MediaPlatform, { key: Tab; label: string }[]> = {
  instagram: [
    { key: "posts", label: "投稿案" },
    { key: "videos", label: "リール" },
    { key: "comments", label: "コメント" },
    { key: "dm", label: "DM" },
    { key: "materials", label: "素材" },
    { key: "analysis", label: "伸びている型・結果" },
    { key: "settings", label: "設定" },
  ],
  tiktok: [
    { key: "videos", label: "動画" },
    { key: "materials", label: "素材" },
    { key: "analysis", label: "伸びている型・結果" },
    { key: "settings", label: "設定" },
  ],
  youtube: [
    { key: "videos", label: "動画" },
    { key: "comments", label: "コメント" },
    { key: "materials", label: "素材" },
    { key: "analysis", label: "伸びている型・結果" },
    { key: "settings", label: "設定" },
  ],
};

/** Instagram・TikTok・YouTube の運用（媒体ごとのアルゴリズムに合わせた案・動画・返信） */
export function MediaOps({
  platform,
  posts,
  videos,
  materials,
  observed,
  report,
  inbox,
  enabled,
  config,
  brandReady,
  connected,
  keysCard,
  todaySteps,
  initialTab,
}: {
  platform: MediaPlatform;
  posts: OpsPost[];
  videos: SnsVideo[];
  materials: Material[];
  observed: ObservedPost[];
  report: PatternReport | null;
  inbox: InboxMessage[];
  enabled: boolean;
  config: MediaOpsConfig;
  brandReady: boolean;
  connected: boolean;
  keysCard: ReactNode;
  todaySteps: Record<string, { done?: boolean; note?: string; error?: string }>;
  initialTab: string | null;
}) {
  const tabs = TABS[platform];
  const [tab, setTab] = useState<Tab>(tabs.some((t) => t.key === initialTab) ? (initialTab as Tab) : !connected ? "settings" : tabs[0].key);
  const count = (t: Tab) =>
    t === "posts" ? posts.filter((p) => p.kind === "post" && p.status === "draft").length : t === "comments" ? posts.filter((p) => p.kind === "reply" && p.status === "draft").length : t === "dm" ? posts.filter((p) => p.kind === "dm" && p.status === "draft").length : t === "videos" ? videos.filter((v) => ["draft", "ready", "rendered"].includes(v.status)).length : 0;
  return (
    <div className="space-y-5">
      {(!connected || !brandReady || !config.benchHandles.length) && tab !== "settings" && (
        <div className="flex items-center gap-3 rounded-2xl border border-[#E0D6C8] bg-[#FBF8F3] px-4 py-3 text-sm">
          <Icon name="alert" className="h-5 w-5 shrink-0 text-[#8A5340]" />
          <p className="flex-1 text-[#2E2D29]">{!connected ? "アカウントを連携してください。" : !brandReady ? "発信者（事業内容）が未設定です。" : "参考にする「伸びているアカウント」を登録してください。"}</p>
          {!brandReady && connected ? <Link href="/sns" className="text-xs text-[#3E5C76] underline">事業内容を入れる</Link> : <button type="button" className="text-xs text-[#3E5C76] underline" onClick={() => setTab("settings")}>設定を開く</button>}
        </div>
      )}
      <nav className="flex gap-1 overflow-x-auto border-b border-[#E8E5E0]">
        {tabs.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)} className={cn("shrink-0 border-b-2 px-3 pb-2 pt-1 text-sm", tab === t.key ? "border-[#2E2D29] font-semibold text-[#2E2D29]" : "border-transparent text-[#8B877F] hover:text-[#2E2D29]")}>
            {t.label}
            {count(t.key) > 0 && <span className="ml-1 rounded-full bg-[#C9A84C] px-1.5 text-[10px] font-semibold text-[#2E2D29]">{count(t.key)}</span>}
          </button>
        ))}
      </nav>
      {tab === "videos" && <VideosTab platform={platform} videos={videos} materials={materials} config={config} />}
      {tab === "posts" && <IgPostsTab posts={posts.filter((p) => p.kind === "post")} />}
      {tab === "comments" && <SimpleListTab platform={platform} step="comments" title="コメントへの返信" text="自分の投稿についた、まだ返していないコメントに AI が返信案を作ります。スパム・誹謗中傷には返信しません。選んでまとめて承認できます" button="コメントを読み込んで返信案を作る" posts={posts.filter((p) => p.kind === "reply")} empty="返信が要るコメントはありません" />}
      {tab === "dm" && <SimpleListTab platform={platform} step="dms" title="DM への返信" text="DM を読み込み、返していない会話に AI が返信案を作ります。Instagram の決まりで、相手の最後のメッセージから24時間を過ぎると送れません" button="DM を読み込んで返信案を作る" posts={posts.filter((p) => p.kind === "dm")} empty="返信が要る DM はありません" inbox={inbox} />}
      {tab === "materials" && <MaterialsPanel materials={materials} />}
      {tab === "analysis" && <AnalysisTab platform={platform} report={report} observed={observed} />}
      {tab === "settings" && <SettingsTab platform={platform} enabled={enabled} config={config} keysCard={keysCard} todaySteps={todaySteps} />}
    </div>
  );
}

function VideosTab({ platform, videos, materials, config }: { platform: MediaPlatform; videos: SnsVideo[]; materials: Material[]; config: MediaOpsConfig }) {
  const { busy, error, info, run } = useStep();
  const [theme, setTheme] = useState("");
  const [format, setFormat] = useState<VideoFormat>(platform === "youtube" ? "long" : "short");
  const active = videos.filter((v) => v.status !== "published" && v.status !== "skipped");
  const done = videos.filter((v) => v.status === "published").slice(0, 10);
  const label = platform === "youtube" ? (format === "long" ? `${config.longMinutes}分前後の動画` : "ショート") : platform === "tiktok" ? "20〜30秒の動画" : "リール（20〜30秒）";
  return (
    <div className="space-y-5">
      <Card>
        <SectionTitle>動画を作る</SectionTitle>
        <p className="mt-1 text-xs leading-relaxed text-[#8B877F]">
          伸びている型と素材から台本を作り、場面ごとに素材の写真・動画（無い場面は AI の画像）、ナレーション（AI 音声）、テロップを組み合わせて動画にします。書き出しはこの画面（パソコンの Chrome）で行います。テロップは画面で組むので、文字が崩れません。
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Label>テーマ（任意）</Label>
            <Input value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="例：はじめての方へ、よくある質問、こだわりの裏側" />
          </div>
          {platform === "youtube" && (
            <div className="w-44">
              <Label>種類</Label>
              <Select value={format} onChange={(v) => setFormat(v as VideoFormat)} options={[{ value: "long", label: `横型（${config.longMinutes}分前後）` }, { value: "short", label: "ショート（縦）" }]} />
            </div>
          )}
          <Btn disabled={busy !== null} onClick={() => run("make", () => runMediaStepAction(platform, "videos", { theme, format, count: 1 }))}>
            {busy === "make" ? <Icon name="loader" /> : <Icon name="sparkles" className="h-4 w-4" />}
            {busy === "make" ? "台本を作っています（1〜2分）" : `${label}の台本を作る`}
          </Btn>
        </div>
        {materials.filter((m) => m.kind !== "text").length === 0 && <p className="mt-2 text-[11px] text-[#8A5340]">素材がまだありません。「素材」タブで自社の写真・動画を足すと、AI 画像の代わりに使われます。</p>}
        <Notes error={error} info={info} />
      </Card>
      {active.length === 0 && done.length === 0 && <div className="rounded-2xl border border-dashed border-[#D8D4CC] p-8 text-center text-sm text-[#8B877F]">まだ動画がありません</div>}
      {active.map((v) => (
        <VideoCard key={v.id} video={v} materials={materials} />
      ))}
      {done.length > 0 && <p className="pt-2 text-xs font-semibold text-[#2F6B4A]">公開済み（直近{done.length}本）</p>}
      {done.map((v) => (
        <VideoCard key={v.id} video={v} materials={materials} />
      ))}
    </div>
  );
}

function IgPostsTab({ posts }: { posts: OpsPost[] }) {
  const { busy, error, info, run } = useStep();
  const [theme, setTheme] = useState("");
  const [count, setCount] = useState(2);
  return (
    <div className="space-y-5">
      <Card>
        <SectionTitle>フィード投稿案（写真のカルーセル＋キャプション）</SectionTitle>
        <p className="mt-1 text-xs text-[#8B877F]">素材の写真（無ければ AI の写真。文字は入れません）と、保存したくなるキャプション・ハッシュタグを作ります。選んでまとめて承認すると Instagram に投稿します</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Label>テーマ（任意）</Label>
            <Input value={theme} onChange={(e) => setTheme(e.target.value)} />
          </div>
          <div className="w-24">
            <Label>本数</Label>
            <Input type="number" min={1} max={5} value={count} onChange={(e) => setCount(Number(e.target.value))} />
          </div>
          <Btn disabled={busy !== null} onClick={() => run("posts", () => runMediaStepAction("instagram", "posts", { theme, count }))}>
            {busy === "posts" ? <Icon name="loader" /> : <Icon name="sparkles" className="h-4 w-4" />}
            {busy === "posts" ? "作っています（1〜3分）" : "案を作る"}
          </Btn>
        </div>
        <Notes error={error} info={info} />
      </Card>
      <ApprovalList items={posts} empty="まだ案がありません" />
    </div>
  );
}

function SimpleListTab({ platform, step, title, text, button, posts, empty, inbox }: { platform: MediaPlatform; step: "comments" | "dms"; title: string; text: string; button: string; posts: OpsPost[]; empty: string; inbox?: InboxMessage[] }) {
  const { busy, error, info, run } = useStep();
  return (
    <div className="space-y-5">
      <Card>
        <SectionTitle>{title}</SectionTitle>
        <p className="mt-1 text-xs text-[#8B877F]">{text}</p>
        <div className="mt-3">
          <Btn disabled={busy !== null} onClick={() => run(step, () => runMediaStepAction(platform, step))}>
            {busy === step ? <Icon name="loader" /> : <Icon name="message" className="h-4 w-4" />}
            {button}
          </Btn>
        </div>
        <Notes error={error} info={info} />
      </Card>
      <ApprovalList items={posts} empty={empty} />
      {inbox && inbox.length > 0 && (
        <details className="rounded-2xl border border-[#E8E5E0] bg-white p-4">
          <summary className="cursor-pointer text-sm font-semibold text-[#2E2D29]">受信箱（直近{Math.min(inbox.length, 50)}件）</summary>
          <ul className="mt-2 space-y-1 text-xs">
            {inbox.slice(0, 50).map((m) => (
              <li key={m.id} className={m.fromMe ? "text-[#3E5C76]" : "text-[#2E2D29]"}>
                {m.fromMe ? "自社" : m.senderName}：{m.text}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function AnalysisTab({ platform, report, observed }: { platform: MediaPlatform; report: PatternReport | null; observed: ObservedPost[] }) {
  const { busy, error, info, run } = useStep();
  const others = observed.filter((o) => o.source !== "own").sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0));
  const own = observed.filter((o) => o.source === "own").sort((a, b) => (b.views ?? b.likes ?? 0) - (a.views ?? a.likes ?? 0));
  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <SectionTitle>伸びている型</SectionTitle>
            <p className="mt-1 text-xs text-[#8B877F]">{platform === "youtube" ? "伸びているチャンネルの動画（公開データ）" : "伸びているアカウントの投稿（Apify・1日の上限あり）"}と、自分の投稿の結果から、この媒体で再現できる型を取り出します</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Btn variant="outline" size="sm" disabled={busy !== null} onClick={() => run("collect", async () => { const a = await runMediaStepAction(platform, "collect"); const b = await runMediaStepAction(platform, "own").catch((e) => `自分の投稿：${e instanceof Error ? e.message : e}`); return `${a}／${b}`; })}>
              {busy === "collect" ? <Icon name="loader" /> : <Icon name="refresh" className="h-3.5 w-3.5" />}集める
            </Btn>
            <Btn size="sm" disabled={busy !== null} onClick={() => run("patterns", () => runMediaStepAction(platform, "patterns"))}>
              {busy === "patterns" ? <Icon name="loader" /> : <Icon name="sparkles" className="h-3.5 w-3.5" />}型を分析する
            </Btn>
          </div>
        </div>
        <Notes error={error} info={info} />
        {report ? (
          <div className="mt-4 space-y-3">
            <p className="rounded-xl bg-[#FBF8F3] p-3 text-sm leading-relaxed text-[#2E2D29]">{report.summary}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {report.patterns.map((p) => (
                <div key={p.name} className="rounded-xl border border-[#E8E5E0] p-3 text-xs">
                  <p className="text-sm font-semibold text-[#2E2D29]">{p.name}</p>
                  <p className="mt-1 leading-relaxed text-[#2E2D29]">{p.howTo}</p>
                  <p className="mt-1 text-[#6B6862]">なぜ：{p.why}</p>
                  <p className="mt-1 text-[#8A5340]">自社なら：{p.fit}</p>
                </div>
              ))}
            </div>
            {report.ownLearnings.length > 0 && (
              <ul className="space-y-1 text-xs">
                {report.ownLearnings.map((l, i) => (
                  <li key={i}>・{l.finding}<span className="text-[#8B877F]">（{l.evidence}）</span> → {l.next}</li>
                ))}
              </ul>
            )}
            <p className="text-[11px] text-[#A5A198]">「なぜ」は見立てで、伸びることを保証するものではありません。</p>
          </div>
        ) : (
          <p className="mt-4 text-xs text-[#8B877F]">まだ分析していません</p>
        )}
      </Card>
      <ObservedTable title={`伸びている投稿（反応率の高い順・${others.length}件）`} items={others.slice(0, 30)} />
      <ObservedTable title={`自分の投稿の結果（${own.length}件）`} items={own.slice(0, 30)} />
    </div>
  );
}

function SettingsTab({ platform, enabled, config, keysCard, todaySteps }: { platform: MediaPlatform; enabled: boolean; config: MediaOpsConfig; keysCard: ReactNode; todaySteps: Record<string, { done?: boolean; note?: string; error?: string }> }) {
  const { busy, error, info, run } = useStep();
  const [on, setOn] = useState(enabled);
  const [handles, setHandles] = useState(config.benchHandles.join("\n"));
  const [ideas, setIdeas] = useState(config.dailyIdeas);
  const [voice, setVoice] = useState(config.voice);
  const [minutes, setMinutes] = useState(config.longMinutes);
  const [rules, setRules] = useState(config.rules);
  const steps = Object.entries(todaySteps);
  return (
    <div className="space-y-5">
      {keysCard}
      <Card>
        <SectionTitle>運用の設定</SectionTitle>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <Label>参考にする伸びている{platform === "youtube" ? "チャンネル（@ハンドル・URL）" : "アカウント"}（1行に1つ・最大10）</Label>
            <Textarea rows={5} value={handles} onChange={(e) => setHandles(e.target.value)} placeholder={platform === "youtube" ? "@example_channel" : "example_account"} />
          </div>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>毎日の案の数</Label>
                <Input type="number" min={0} max={3} value={ideas} onChange={(e) => setIdeas(Number(e.target.value))} />
              </div>
              {platform === "youtube" && (
                <div>
                  <Label>長尺の長さ（分）</Label>
                  <Input type="number" min={10} max={20} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
                </div>
              )}
            </div>
            <div>
              <Label>ナレーションの声</Label>
              <Select value={voice} onChange={setVoice} options={VOICES.map((v) => ({ value: v.id, label: v.label }))} />
            </div>
            <div>
              <Label>決まりごと（任意）</Label>
              <Textarea rows={2} value={rules} onChange={(e) => setRules(e.target.value)} />
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#FAF9F7] px-3 py-2">
          <label className="flex items-center gap-2 text-sm text-[#2E2D29]">
            <Switch checked={on} onChange={setOn} />
            毎日の自動（集める・型の分析・案{platform === "tiktok" ? "" : "・コメント"}{platform === "instagram" ? "・DM" : ""}の返信案）
          </label>
          <span className="text-[11px] text-[#8B877F]">動画は台本まで自動で作ります。画像・ナレーション・書き出し・投稿は人が進めます</span>
        </div>
        <div className="mt-3 flex justify-end">
          <Btn disabled={busy !== null} onClick={() => run("save", async () => { await saveMediaOpsAction(platform, { enabled: on, config: { benchHandles: handles.split(/[\n,、]+/), dailyIdeas: ideas, voice, longMinutes: minutes, rules } }); return "保存しました"; })}>
            {busy === "save" ? <Icon name="loader" /> : <Icon name="save" className="h-4 w-4" />}保存する
          </Btn>
        </div>
        <Notes error={error} info={info} />
      </Card>
      {steps.length > 0 && (
        <Card>
          <SectionTitle>今日の自動の進み具合</SectionTitle>
          <ul className="mt-2 space-y-1 text-xs">
            {steps.map(([k, v]) => (
              <li key={k} className={v.done ? "text-[#2F6B4A]" : "text-[#A8705A]"}>
                {v.done ? "✓" : "×"} {k}：{v.done ? v.note : v.error}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
