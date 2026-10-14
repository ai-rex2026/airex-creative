"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { decidePendingAction, saveAutoAction } from "@/app/meo-kit-actions";
import { MeoPageHeader, SectionTitle } from "@/components/meo/Workspace";
import { Btn, Card, ErrorNote, GuardNotes, Icon, Select, Switch, Textarea, cn, useSaveFeedback } from "@/components/meo/ui";
import { meoPath } from "@/lib/meo-ops/logic";
import type { AutoLogEntry, AutoSettings } from "@/lib/meo-ops/kit/types";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/**
 * 自動で回す（オルコネレックス v1 の「毎朝やること」）。
 * 毎日 10:00 に、口コミの返信文と週1の投稿を作る。送る基準を満たさないものは「確認待ち」に入り、人が見て送る。
 */
export function AutoPanel({ storeId, auto: initial, gbpLinked, log, hasKit }: { storeId: string; auto: AutoSettings; gbpLinked: boolean; log: AutoLogEntry[]; hasKit: boolean }) {
  const router = useRouter();
  const [auto, setAuto] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { isSaved, notifySaved } = useSaveFeedback();
  const pending = log.filter((x) => x.status === "pending");
  const history = log.filter((x) => x.status !== "pending");

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveAutoAction(storeId, auto);
      notifySaved();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存できませんでした");
    } finally {
      setSaving(false);
    }
  };
  const set = <K extends keyof AutoSettings>(k: K, v: AutoSettings[K]) => setAuto((a) => ({ ...a, [k]: v }));

  return (
    <div className="space-y-6">
      <MeoPageHeader icon="bot" title="自動で回す" description="毎朝10時に、口コミの返信文と週1回の投稿を作ります。送る基準に合わないものは確認待ちに入ります" />
      {!gbpLinked && (
        <ErrorNote>
          自動で回すには、Googleビジネスプロフィールとの連携が要ります。
          <Link href={meoPath(storeId, "/settings")} className="ml-1 font-semibold underline">
            「設定」タブで連携する
          </Link>
        </ErrorNote>
      )}

      <Card>
        <SectionTitle>確認待ち（{pending.length}件）</SectionTitle>
        <p className="mt-1 text-xs text-[#8B877F]">自動では送らなかったものです。文を直して「このまま送る」か、「送らない」を選んでください。送るときも言葉のチェックを通します</p>
        <div className="mt-3 space-y-3">
          {pending.length === 0 && <p className="text-sm text-[#A5A198]">確認待ちはありません</p>}
          {pending.map((e) => (
            <PendingItem key={e.id} storeId={storeId} entry={e} onDone={() => router.refresh()} />
          ))}
        </div>
      </Card>

      <Card>
        <SectionTitle>設定</SectionTitle>
        <div className="mt-4 space-y-5">
          <Row title="口コミの返信文を毎日作る" sub="Googleに来た未返信の口コミに、返信文を作ります（1日10件まで）">
            <Switch checked={auto.replies} onChange={(v) => set("replies", v)} />
          </Row>
          {auto.replies && (
            <Row title="そのまま送る口コミ" sub="星が低い口コミへの返信は、人が見ずに送りません。言葉のチェックで注意が出たものも確認待ちに入ります">
              <Select
                value={String(auto.autoSendMinStars)}
                onChange={(v) => set("autoSendMinStars", (Number(v) === 4 ? 4 : Number(v) === 5 ? 5 : 0) as AutoSettings["autoSendMinStars"])}
                options={[
                  { value: "0", label: "送らない（全部確認待ち）" },
                  { value: "5", label: "星5だけ送る" },
                  { value: "4", label: "星4以上を送る" },
                ]}
              />
            </Row>
          )}
          <Row title="Googleマップに週1回投稿する" sub={hasKit ? "「続けて出すもの」のテーマ表から、次の1本を作ります" : "先にホームの「やることを出す」を実行してください"}>
            <Switch checked={auto.posts} onChange={(v) => set("posts", v)} />
          </Row>
          {auto.posts && (
            <>
              <Row title="投稿を作る曜日" sub="毎週この曜日の朝に作ります">
                <Select value={String(auto.postWeekday)} onChange={(v) => set("postWeekday", Number(v))} options={WEEKDAYS.map((w, i) => ({ value: String(i), label: `${w}曜日` }))} />
              </Row>
              <Row title="言葉のチェックを通った投稿はそのまま公開する" sub="オフなら確認待ちに入り、人が見てから公開します">
                <Switch checked={auto.autoPublishPosts} onChange={(v) => set("autoPublishPosts", v)} />
              </Row>
            </>
          )}
        </div>
        {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
        <div className="mt-5 flex items-center gap-3">
          <Btn onClick={save} disabled={saving}>
            {saving ? <Icon name="loader" /> : <Icon name="save" />}
            保存する
          </Btn>
          {isSaved && <span className="text-xs text-[#2F6B4A]">保存しました</span>}
        </div>
      </Card>

      <Card>
        <SectionTitle>自動でやったこと</SectionTitle>
        <div className="mt-3 divide-y divide-[#F0EDE8]">
          {history.length === 0 && <p className="text-sm text-[#A5A198]">まだありません</p>}
          {history.map((e) => (
            <div key={e.id} className="py-2.5">
              <div className="flex items-center gap-2 text-xs">
                <span className={cn("rounded-full px-2 py-0.5", e.status === "sent" ? "bg-[#E8F2EC] text-[#2F6B4A]" : e.status === "failed" ? "bg-[#F8F1ED] text-[#A8705A]" : "bg-[#F4F3F0] text-[#6B6862]")}>
                  {e.status === "sent" ? "送った" : e.status === "dismissed" ? "送らなかった" : e.status === "failed" ? "失敗" : "記録"}
                </span>
                <span className="font-semibold text-[#2E2D29]">{e.title}</span>
                <span className="ml-auto text-[#A5A198]">{new Date(e.createdAt).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
              </div>
              {e.text && <p className="mt-1 line-clamp-2 text-xs text-[#6B6862]">{e.text}</p>}
              {e.reason && <p className="mt-0.5 text-[11px] text-[#A5A198]">{e.reason}</p>}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function Row({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-semibold text-[#2E2D29]">{title}</p>
        <p className="text-xs text-[#8B877F]">{sub}</p>
      </div>
      <div className="shrink-0 sm:w-56 sm:text-right">{children}</div>
    </div>
  );
}

function PendingItem({ storeId, entry, onDone }: { storeId: string; entry: AutoLogEntry; onDone: () => void }) {
  const [text, setText] = useState(entry.text);
  const [busy, setBusy] = useState<"send" | "dismiss" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const decide = async (d: "send" | "dismiss") => {
    setBusy(d);
    setError(null);
    try {
      await decidePendingAction(storeId, entry.id, d, text);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "できませんでした");
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="rounded-xl border border-[#E8E5E0] p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-[#FBF3E4] px-2 py-0.5 text-[#8A6A1E]">{entry.kind === "reply" ? "口コミへの返信" : "投稿"}</span>
        <span className="font-semibold text-[#2E2D29]">{entry.title}</span>
        <span className="text-[#A5A198]">{entry.reason}</span>
      </div>
      <Textarea className="mt-2 min-h-24" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="mt-2">
        <GuardNotes hits={entry.hits} />
      </div>
      {error && <p className="mt-2 text-xs text-[#B5523B]">{error}</p>}
      <div className="mt-2 flex gap-2">
        <Btn size="sm" onClick={() => decide("send")} disabled={!!busy || !text.trim()}>
          {busy === "send" ? <Icon name="loader" /> : <Icon name="send" className="h-3.5 w-3.5" />}
          このまま{entry.kind === "reply" ? "返信する" : "公開する"}
        </Btn>
        <Btn size="sm" variant="ghost" onClick={() => decide("dismiss")} disabled={!!busy}>
          送らない
        </Btn>
      </div>
    </div>
  );
}
