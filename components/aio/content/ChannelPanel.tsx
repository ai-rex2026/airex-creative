"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  analyzeAioChannelAction,
  buildAioStrategyAction,
  connectAioWordPressAction,
  disconnectAioWordPressAction,
  listAioWpCategoriesAction,
  setAioChannelSourceAction,
  setAioSatelliteAction,
  setAioWpCategoryAction,
} from "@/app/aio-content-actions";
import { SectionTitle } from "@/components/meo/Workspace";
import { Btn, Card, ErrorNote, Icon, Input, Label, Select, Textarea, cn } from "@/components/meo/ui";
import { ArticleCard } from "@/components/aio/content/ArticleCard";
import { PhaseNote, useArticleMaker } from "@/components/aio/content/useArticleMaker";
import type { AioArticle, AioChannel, AioChannelKind, AioContentReview, AioSatellite, AioSatelliteItem, AioWpInfo } from "@/lib/aio/content-types";
import type { AioProject } from "@/lib/aio/types";

/**
 * 1つの媒体（自社サイトのコラム／note）の運用画面。
 * ① 媒体の準備（既存記事のトンマナを読む／無ければ立ち上げ支援） → ② 記事をつくる（画像つき） → ③ 記事（公開・投稿）
 */
export function ChannelPanel({
  project,
  kind,
  channel,
  articles,
  wp,
  review,
}: {
  project: AioProject;
  kind: AioChannelKind;
  channel: AioChannel | null;
  articles: AioArticle[];
  wp: AioWpInfo | null;
  review: AioContentReview | null;
}) {
  const isNote = kind === "note";
  const isSat = kind === "satellite";
  const maker = useArticleMaker(project.id);
  const [brief, setBrief] = useState({ title: "", target: "", note: "" });
  const ready = !!channel && (channel.hasSource ? !!channel.style : !!channel.strategy);

  const ideas = [
    ...(review?.next ?? []).map((n) => ({ title: n.title, target: n.target, from: "改善案" })),
    ...(channel?.strategy?.firstArticles ?? []).map((a) => ({ title: a.title, target: a.target, from: "最初に書く記事" })),
  ].slice(0, 8);

  return (
    <div className="space-y-6">
      {isSat && <SatelliteCard project={project} channel={channel} />}
      <SourceCard project={project} kind={kind} channel={channel} />
      {!isNote && channel && <WordPressCard project={project} kind={kind} wp={wp} hasSource={channel.hasSource} />}

      <Card>
        <SectionTitle>② 記事をつくる（本文・画像・表現チェックまで）</SectionTitle>
        <p className="mt-1 text-xs text-[#8B877F]">
          {isNote
            ? "既存の note 記事と同じ語り口で、見出し・ハッシュタグ・見出し画像と本文中の画像まで作ります。できたら「note に貼る形でコピー」で貼り付けて、投稿は人が行います"
            : isSat
              ? "選び方の基準と、「扱う商品・サービス」に入れた事実だけで比較・解説の記事を作ります。WordPress に送るとき、冒頭に運営者と PR の表記を、運営者の商品へのリンクに rel=\"sponsored\" を自動で入れます"
            : "既存のコラムと同じトンマナで、タイトル・説明文・スラッグ・アイキャッチと本文中の画像まで作ります。WordPress と連携していれば「承認して公開」で公開できます"}
        </p>
        {!ready && <p className="mt-3 rounded-xl bg-[#FBF8F3] px-3 py-2 text-xs text-[#8A5340]">先に ① で{channel?.hasSource === false ? "立ち上げの方針" : "既存記事の分析"}をしておくと、トンマナに合った記事になります（無くても作れます）</p>}
        {ideas.length > 0 && (
          <div className="mt-3">
            <p className="text-[11px] text-[#8B877F]">候補から選ぶ</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {ideas.map((i, k) => (
                <button key={k} type="button" onClick={() => setBrief({ title: i.title, target: i.target, note: "" })} className="rounded-full border border-[#E8E5E0] px-2.5 py-1 text-left text-[11px] text-[#2E2D29] hover:border-[#C9A84C]">
                  {i.title}
                  <span className="ml-1 text-[10px] text-[#A5A198]">（{i.from}）</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <Label>タイトル案（空なら AI が決める）</Label>
            <Input value={brief.title} onChange={(e) => setBrief({ ...brief, title: e.target.value })} placeholder={isNote ? "例：私たちが〇〇を始めた理由" : isSat ? "例：〇〇サービスの選び方と主な5社の比較" : "例：〇〇の選び方｜失敗しないための5つの基準"} />
          </div>
          <div>
            <Label>答える問い・狙う語（任意）</Label>
            <Input value={brief.target} onChange={(e) => setBrief({ ...brief, target: e.target.value })} placeholder="例：〇〇 費用 相場" />
          </div>
        </div>
        <div className="mt-3">
          <Label>書き手からの指示（任意。入れてほしい事実・事例・避けたいことなど）</Label>
          <Textarea rows={2} value={brief.note} onChange={(e) => setBrief({ ...brief, note: e.target.value })} />
        </div>
        <div className="mt-3 flex items-center justify-end gap-3">
          <Btn onClick={() => maker.make(kind, brief.title || brief.target || brief.note ? brief : null).then((id) => id && setBrief({ title: "", target: "", note: "" }))} disabled={maker.busy}>
            {maker.busy ? <Icon name="loader" /> : <Icon name="sparkles" className="h-4 w-4" />}
            {maker.busy ? "作成中" : "記事を書く（画像つき）"}
          </Btn>
        </div>
        <PhaseNote phase={maker.phase} />
        {maker.error && <div className="mt-3"><ErrorNote>{maker.error}</ErrorNote></div>}
        {maker.notice && <p className="mt-3 rounded-xl bg-[#FBF4E4] px-3 py-2 text-xs text-[#8A6A1E]">{maker.notice}</p>}
      </Card>

      <section className="space-y-3">
        <SectionTitle>③ 記事（{articles.length}本）</SectionTitle>
        {articles.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#D8D4CC] p-8 text-center text-sm text-[#8B877F]">まだ記事がありません。② で作ると、ここに並びます</div>
        ) : (
          articles.map((a) => <ArticleCard key={a.id} article={a} wp={isNote ? null : wp} />)
        )}
      </section>
    </div>
  );
}

function SourceCard({ project, kind, channel }: { project: AioProject; kind: AioChannelKind; channel: AioChannel | null }) {
  const router = useRouter();
  const isNote = kind === "note";
  const [hasSource, setHasSource] = useState(channel?.hasSource ?? true);
  const [url, setUrl] = useState(channel?.sourceUrl ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const saved = channel && channel.hasSource === hasSource && (!hasSource || channel.sourceUrl === url.trim() || channel.sourceUrl === `https://${url.trim()}`);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    setInfo(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy(null);
    }
  };

  const saveAndGo = () =>
    run("go", async () => {
      if (!saved) await setAioChannelSourceAction(project.id, kind, { sourceUrl: url, hasSource });
      if (hasSource) {
        const r = await analyzeAioChannelAction(project.id, kind);
        setInfo(`${r.articles}本の記事を読みました${r.isWordPress ? "（WordPress のサイトです。下で連携できます）" : ""}${r.notes.length ? `。${r.notes.join("。")}` : ""}`);
      } else {
        await buildAioStrategyAction(project.id, kind);
      }
    });

  const st = channel?.style;
  const sg = channel?.strategy;

  return (
    <Card>
      <SectionTitle>① 媒体の準備（{isNote ? "note のアカウント" : kind === "satellite" ? "サテライトサイト" : "自社サイトのコラム"}）</SectionTitle>
      <div className="mt-3 flex flex-wrap gap-2">
        {[true, false].map((v) => (
          <button
            key={String(v)}
            type="button"
            onClick={() => setHasSource(v)}
            className={cn("rounded-full border px-3 py-1 text-xs", hasSource === v ? "border-[#2E2D29] bg-[#2E2D29] text-white" : "border-[#E0DBD1] text-[#6B6862]")}
          >
            {v ? (isNote ? "アカウントがある" : kind === "satellite" ? "サイトがある" : "コラムのページがある") : isNote ? "まだアカウントが無い" : kind === "satellite" ? "サイトがまだ無い" : "コラムのページがまだ無い"}
          </button>
        ))}
      </div>
      {hasSource ? (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={isNote ? "https://note.com/アカウント名" : kind === "satellite" ? "https://サテライトのドメイン/（記事の一覧ページ）" : "https://自社ドメイン/column/（記事の一覧ページ）"} />
          <Btn onClick={saveAndGo} disabled={busy !== null || !url.trim()} className="shrink-0">
            {busy === "go" ? <Icon name="loader" /> : <Icon name="search" className="h-4 w-4" />}
            {busy === "go" ? "読んでいます（1〜2分）" : st ? "読み直す" : "既存記事を読んでトンマナを分析"}
          </Btn>
        </div>
      ) : (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-[#FAF9F7] px-3 py-2">
          <p className="text-xs text-[#6B6862]">{isNote ? "アカウントの開設手順と、プロフィール・マガジン・最初に書く記事の方針を作ります" : kind === "satellite" ? "別ドメインでの WordPress の設置・運営者と PR の表記の手順と、メディアの方針・カテゴリ・最初に書く記事を作ります" : "WordPress の設置手順と、コラムの方針・カテゴリ・最初に書く記事を作ります"}</p>
          <Btn onClick={saveAndGo} disabled={busy !== null} className="shrink-0">
            {busy === "go" ? <Icon name="loader" /> : <Icon name="sparkles" className="h-4 w-4" />}
            {busy === "go" ? "作っています（1分ほど）" : sg ? "方針を作り直す" : "立ち上げの方針を作る"}
          </Btn>
        </div>
      )}
      {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
      {info && <p className="mt-3 rounded-xl bg-[#EAF3EE] px-3 py-2 text-xs text-[#2F6B4A]">{info}</p>}

      {hasSource && st && (
        <div className="mt-4 space-y-3">
          <div className="grid gap-2 sm:grid-cols-4">
            <Mini label="読んだ記事" value={`${st.measured.articles}本`} />
            <Mini label="平均の文字数" value={`${st.measured.avgChars.toLocaleString()}字`} />
            <Mini label="見出しの数（平均）" value={`${st.measured.avgH2}個`} />
            <Mini label="です・ます" value={`${st.measured.politeRatio}%`} />
          </div>
          <p className="text-sm font-semibold text-[#2E2D29]">{st.summary}</p>
          <dl className="grid gap-2 text-xs sm:grid-cols-2">
            {[
              ["文体", st.voice],
              ["読者", st.reader],
              ["見出し", st.headings],
              ["構成", st.structure],
              ["言い回し", st.phrases],
              ["画像", st.imagery],
            ]
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k} className="rounded-lg bg-[#FAF9F7] p-2">
                  <dt className="text-[10px] text-[#8B877F]">{k}</dt>
                  <dd className="mt-0.5 leading-relaxed text-[#2E2D29]">{v}</dd>
                </div>
              ))}
          </dl>
          {channel!.samples.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-[#6B6862]">分析に使った記事（{channel!.samples.length}本）</summary>
              <ul className="mt-1 space-y-0.5">
                {channel!.samples.map((s) => (
                  <li key={s.url} className="truncate text-[#6B6862]">
                    <a href={s.url} target="_blank" rel="noreferrer" className="underline">{s.title || s.url}</a>（{s.chars.toLocaleString()}字・見出し{s.h2}）
                  </li>
                ))}
              </ul>
            </details>
          )}
          <p className="text-[11px] text-[#A5A198]">分析日：{channel!.analyzedAt ? new Date(channel!.analyzedAt).toLocaleDateString("ja-JP") : "-"}。記事が増えたら「読み直す」で更新できます</p>
        </div>
      )}

      {!hasSource && sg && (
        <div className="mt-4 space-y-4">
          <ol className="space-y-2">
            {sg.setup.map((s, i) => (
              <li key={i} className="flex gap-3 rounded-xl bg-[#FAF9F7] p-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#2E2D29] text-[11px] font-bold text-white">{i + 1}</span>
                <div>
                  <p className="text-sm font-semibold text-[#2E2D29]">{s.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-[#6B6862]">{s.detail}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-[#E8E5E0] p-3">
              <p className="text-[11px] text-[#8B877F]">コンセプト</p>
              <p className="mt-1 text-sm text-[#2E2D29]">{sg.concept}</p>
              {sg.cadence && <p className="mt-2 text-xs text-[#6B6862]">更新の目安：{sg.cadence}</p>}
            </div>
            <div className="rounded-xl border border-[#E8E5E0] p-3">
              <div className="flex items-center justify-between">
                <p className="text-[11px] text-[#8B877F]">{isNote ? "プロフィール文" : "コラムの紹介文"}</p>
                <button type="button" className="text-[11px] text-[#6B6862] underline" onClick={() => navigator.clipboard.writeText(sg.profile)}>コピー</button>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-[#2E2D29]">{sg.profile}</p>
            </div>
          </div>
          {sg.categories.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-[#2E2D29]">{isNote ? "マガジン案" : "カテゴリ案"}</p>
              <ul className="mt-1 grid gap-1.5 sm:grid-cols-2">
                {sg.categories.map((c) => (
                  <li key={c.name} className="rounded-lg bg-[#FAF9F7] px-3 py-2 text-xs"><span className="font-semibold text-[#2E2D29]">{c.name}</span><span className="text-[#6B6862]">：{c.purpose}</span></li>
                ))}
              </ul>
            </div>
          )}
          {sg.firstArticles.length > 0 && <p className="text-xs text-[#6B6862]">最初に書く記事の案は、② の「候補から選ぶ」に出ています。</p>}
        </div>
      )}
    </Card>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[#FAF9F7] p-2.5">
      <p className="text-[10px] text-[#8B877F]">{label}</p>
      <p className="mt-0.5 text-sm font-bold text-[#2E2D29]">{value}</p>
    </div>
  );
}

function WordPressCard({ project, kind, wp, hasSource }: { project: AioProject; kind: AioChannelKind; wp: AioWpInfo | null; hasSource: boolean }) {
  const router = useRouter();
  const isSat = kind === "satellite";
  const [form, setForm] = useState({ siteUrl: isSat ? "" : project.url ?? "", user: "", appPassword: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [cats, setCats] = useState<{ id: number; name: string }[] | null>(null);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    setInfo(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <SectionTitle>WordPress と連携{isSat ? "（サテライトサイト・自社サイトとは別）" : ""}（承認ボタンで公開）</SectionTitle>
        {wp && <span className="rounded-full bg-[#EAF3EE] px-2.5 py-0.5 text-[11px] font-semibold text-[#2F6B4A]">連携中</span>}
      </div>
      {wp ? (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-[#2E2D29]">
            {wp.siteName || wp.baseUrl}（ユーザー：{wp.wpUser}）
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[220px]">
              <Label>投稿するカテゴリ</Label>
              {cats ? (
                <Select
                  value={String(wp.categoryId ?? "")}
                  onChange={(v) => run("cat", () => setAioWpCategoryAction(project.id, v ? Number(v) : null, kind))}
                  options={[{ value: "", label: "WordPress の既定" }, ...cats.map((c) => ({ value: String(c.id), label: c.name }))]}
                />
              ) : (
                <Btn variant="outline" size="sm" disabled={busy !== null} onClick={() => run("cats", async () => setCats(await listAioWpCategoriesAction(project.id, kind)))}>
                  {busy === "cats" ? <Icon name="loader" /> : null}
                  {wp.categoryId ? `カテゴリ ID ${wp.categoryId}（変更する）` : "カテゴリを選ぶ"}
                </Btn>
              )}
            </div>
            <Btn variant="ghost" size="sm" disabled={busy !== null} onClick={() => confirm("WordPress との連携を外しますか？（公開済みの記事は消えません）") && run("off", () => disconnectAioWordPressAction(project.id, kind))}>
              連携を外す
            </Btn>
          </div>
          <p className="text-[11px] text-[#A5A198]">公開は記事のカードの「承認して公開」からだけ行います。自動では公開しません。</p>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          {!hasSource && <p className="text-xs text-[#6B6862]">① の手順で WordPress を置いたら、ここで連携します。</p>}
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label>サイトのURL</Label>
              <Input value={form.siteUrl} onChange={(e) => setForm({ ...form, siteUrl: e.target.value })} placeholder={isSat ? "https://サテライトのドメイン" : "https://example.com"} />
            </div>
            <div>
              <Label>ユーザー名</Label>
              <Input value={form.user} onChange={(e) => setForm({ ...form, user: e.target.value })} autoComplete="off" />
            </div>
            <div>
              <Label>アプリケーションパスワード</Label>
              <Input type="password" value={form.appPassword} onChange={(e) => setForm({ ...form, appPassword: e.target.value })} autoComplete="new-password" placeholder="xxxx xxxx xxxx xxxx xxxx xxxx" />
            </div>
          </div>
          <details className="text-xs text-[#6B6862]">
            <summary className="cursor-pointer">アプリケーションパスワードの出し方</summary>
            <ol className="mt-1 list-decimal space-y-0.5 pl-5">
              <li>WordPress の管理画面で「ユーザー → プロフィール」を開きます（編集者以上の権限のユーザー）</li>
              <li>下の方の「アプリケーションパスワード」で名前（例：AI-REX）を入れて「新しいアプリケーションパスワードを追加」</li>
              <li>表示された24文字をここに貼ります（ログインのパスワードとは別。WordPress 側でいつでも取り消せます）</li>
            </ol>
            <p className="mt-1">パスワードは暗号化して保存し、画面には二度と表示しません。</p>
          </details>
          {error && <ErrorNote>{error}</ErrorNote>}
          {info && <p className="rounded-xl bg-[#EAF3EE] px-3 py-2 text-xs text-[#2F6B4A]">{info}</p>}
          <div className="flex justify-end">
            <Btn
              disabled={busy !== null || !form.siteUrl || !form.user || !form.appPassword}
              onClick={() =>
                run("connect", async () => {
                  const r = await connectAioWordPressAction(project.id, form, kind);
                  setCats(r.categories);
                  setForm({ ...form, appPassword: "" });
                  setInfo(`「${r.siteName}」と連携しました（${r.userName}）。投稿するカテゴリを選んでください`);
                })
              }
            >
              {busy === "connect" ? <Icon name="loader" /> : <Icon name="link" className="h-4 w-4" />}
              {busy === "connect" ? "確認しています" : "連携する"}
            </Btn>
          </div>
        </div>
      )}
      {wp && error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
    </Card>
  );
}

const EMPTY_ITEM: AioSatelliteItem = { name: "", url: "", facts: "", own: false };

/**
 * サテライトサイトの設定（2026-10-21）。運営者の表記と「扱う商品・サービス」（記事に書いてよい事実）を入れる。
 * 運営者を伏せた自社商品の推奨は景品表示法のステマ規制に触れるおそれがあるため、運営者の表記が無いと WordPress に送れない
 */
function SatelliteCard({ project, channel }: { project: AioProject; channel: AioChannel | null }) {
  const router = useRouter();
  const init: AioSatellite = channel?.satellite ?? { mediaName: "", theme: "", operator: project.name, relation: "自社運営", items: [{ ...EMPTY_ITEM, name: project.name, url: project.url ?? "", own: true }] };
  const [f, setF] = useState<AioSatellite>(init);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const setItem = (k: number, patch: Partial<AioSatelliteItem>) => setF({ ...f, items: f.items.map((x, i) => (i === k ? { ...x, ...patch } : x)) });
  const save = async () => {
    setBusy(true);
    setError(null);
    setInfo(null);
    const r = await setAioSatelliteAction(project.id, f);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setInfo("保存しました");
    router.refresh();
  };
  return (
    <Card>
      <SectionTitle>⓪ サテライトサイトの設定（運営者の表記・扱う商品）</SectionTitle>
      <p className="mt-1 text-xs leading-relaxed text-[#8B877F]">
        自社とは別のドメインで、他社の商品・サービスも公平に扱う比較・解説メディアとして運営します。記事に書けるのは、下の「扱う商品・サービス」に入れた事実だけです。
        公開するときは、冒頭に運営者の表記（運営者の商品を扱う記事は PR 表記も）を、運営者の商品・自社サイトへのリンクに rel=&quot;sponsored&quot; を自動で入れます。
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <Label>メディアの名前</Label>
          <Input value={f.mediaName} onChange={(e) => setF({ ...f, mediaName: e.target.value })} placeholder="例：〇〇の選び方ガイド" />
        </div>
        <div>
          <Label>扱うテーマ・読者</Label>
          <Input value={f.theme} onChange={(e) => setF({ ...f, theme: e.target.value })} placeholder="例：中小企業の広告運用の外注を検討している担当者向け" />
        </div>
        <div>
          <Label>運営者の表記（必須）</Label>
          <Input value={f.operator} onChange={(e) => setF({ ...f, operator: e.target.value })} placeholder="例：株式会社〇〇" />
        </div>
        <div>
          <Label>自社との関係</Label>
          <Input value={f.relation} onChange={(e) => setF({ ...f, relation: e.target.value })} placeholder="例：自社運営／グループ会社" />
        </div>
      </div>
      <div className="mt-4 space-y-2">
        <p className="text-xs font-semibold text-[#2E2D29]">扱う商品・サービス（{f.items.length}件）</p>
        {f.items.map((it, k) => (
          <div key={k} className="rounded-xl border border-[#E8E5E0] p-3">
            <div className="grid gap-2 sm:grid-cols-[1fr_1.4fr_auto]">
              <Input value={it.name} onChange={(e) => setItem(k, { name: e.target.value })} placeholder="商品・サービス名" />
              <Input value={it.url} onChange={(e) => setItem(k, { url: e.target.value })} placeholder="公式サイトの URL" />
              <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-[#6B6862]">
                <input type="checkbox" checked={it.own} onChange={(e) => setItem(k, { own: e.target.checked })} />
                運営者の商品
              </label>
            </div>
            <Textarea rows={2} className="mt-2" value={it.facts} onChange={(e) => setItem(k, { facts: e.target.value })} placeholder="記事に書いてよい事実（公式サイトなどの公開情報から。料金・特徴・対応範囲など。ここに無いことは記事に書きません）" />
            <div className="mt-1 text-right">
              <button type="button" className="text-[11px] text-[#8B877F] underline" onClick={() => setF({ ...f, items: f.items.filter((_, i) => i !== k) })}>外す</button>
            </div>
          </div>
        ))}
        {f.items.length < 20 && (
          <button type="button" className="text-xs text-[#6B6862] underline" onClick={() => setF({ ...f, items: [...f.items, { ...EMPTY_ITEM }] })}>＋ 商品・サービスを足す</button>
        )}
      </div>
      {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
      {info && <p className="mt-3 rounded-xl bg-[#EAF3EE] px-3 py-2 text-xs text-[#2F6B4A]">{info}</p>}
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-[11px] text-[#A5A198]">表記の方針は、運用を始める前に専門家（弁護士など）に確認することをおすすめします。</p>
        <Btn onClick={save} disabled={busy || !f.operator.trim()} className="shrink-0">
          {busy ? <Icon name="loader" /> : null}
          保存する
        </Btn>
      </div>
    </Card>
  );
}
