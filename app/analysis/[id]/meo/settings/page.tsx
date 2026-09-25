"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { saveMeoConfigAction } from "@/app/meo-actions";
import { GbpStatusBadge, MeoPageHeader, useMeo } from "@/components/meo/Workspace";
import { TagInput } from "@/components/meo/parts";
import { Btn, ErrorNote, Icon, Label, Select, Switch, Textarea, useSaveFeedback } from "@/components/meo/ui";
import type { MeoAiReplySettings, MeoNotificationSettings } from "@/lib/meo-ops/types";
import { GbpLink } from "./GbpLink";

const TONES = [
  { value: "polite", label: "丁寧（標準）" },
  { value: "friendly", label: "親しみやすい" },
  { value: "formal", label: "フォーマル" },
];

const NOTIFICATIONS: { key: keyof MeoNotificationSettings; label: string; description: string }[] = [
  { key: "newReview", label: "新規クチコミの通知", description: "新しいクチコミが届いたとき" },
  { key: "editedReview", label: "クチコミ編集の通知", description: "返信済みのクチコミが書き換えられたとき" },
  { key: "monthlyReport", label: "月次レポートの配信", description: "毎月10日に運用実績を配信" },
];

/** AI返信の既定設定と、連携・通知の設定 */
export default function MeoSettingsPage() {
  const { data, analysisId } = useMeo();
  const router = useRouter();
  const [settings, setSettings] = useState<MeoAiReplySettings>(data.aiReplySettings);
  const [notifications, setNotifications] = useState<MeoNotificationSettings>(data.notificationSettings);
  const { isSaved, notifySaved } = useSaveFeedback();
  const [saveError, setSaveError] = useState<string | null>(null);

  const save = async () => {
    setSaveError(null);
    try {
      await saveMeoConfigAction(analysisId, settings, notifications);
      notifySaved();
      router.refresh();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "設定の保存に失敗しました。時間をおいて再度お試しください。");
    }
  };

  return (
    <div className="space-y-5">
      <MeoPageHeader
        icon="settings"
        title="設定"
        description="AI返信の書き方と、連携・通知の設定を管理します"
        action={
          <Btn onClick={save}>
            <Icon name={isSaved ? "check" : "save"} />
            {isSaved ? "保存しました" : "変更を保存"}
          </Btn>
        }
      />
      {saveError && <ErrorNote>{saveError}</ErrorNote>}

      <section className="space-y-4 rounded-2xl border border-[#E8E5E0] bg-white p-5">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-[#2E2D29]">
            Googleビジネスプロフィール連携
            <GbpStatusBadge status={data.store.gbpStatus} />
          </p>
          <p className="mt-1 text-xs text-[#8B877F]">連携すると、クチコミの取得・返信の送信・投稿の配信がこの画面から行えます。</p>
        </div>
        <GbpLink analysisId={analysisId} connected={data.gbpConnected} linkedLocationName={data.gbpLocationName} />
      </section>

      <section className="space-y-4 rounded-2xl border border-[#E8E5E0] bg-white p-5">
        <div>
          <p className="text-sm font-semibold text-[#2E2D29]">AI返信の設定</p>
          <p className="mt-0.5 text-xs text-[#8B877F]">クチコミ返信をAIが下書きする際の、トーンと語彙を指定します</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="reply-tone">返信のトーン</Label>
          <Select
            id="reply-tone"
            value={settings.tone}
            onChange={(v) => setSettings((p) => ({ ...p, tone: v as MeoAiReplySettings["tone"] }))}
            options={TONES}
            className="max-w-xs"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="reply-keywords">返信に含めたい言葉</Label>
          <p className="text-xs text-[#8B877F]">店舗の強みやサービス名を入れておくと、返信に自然に反映されます</p>
          <TagInput id="reply-keywords" values={settings.keywords} placeholder="例: 丁寧なカウンセリング（Enterで追加）" onChange={(keywords) => setSettings((p) => ({ ...p, keywords }))} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="reply-ng">使ってほしくない表現（NGワード）</Label>
          <TagInput id="reply-ng" values={settings.ngWords} placeholder="例: 絶対（Enterで追加）" onChange={(ngWords) => setSettings((p) => ({ ...p, ngWords }))} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="reply-style">スタイル指示</Label>
          <Textarea id="reply-style" rows={3} value={settings.styleInstruction} onChange={(e) => setSettings((p) => ({ ...p, styleInstruction: e.target.value }))} className="resize-y" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="reply-signature">結びの一文</Label>
          <Textarea id="reply-signature" rows={2} value={settings.signature} onChange={(e) => setSettings((p) => ({ ...p, signature: e.target.value }))} className="resize-y" />
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border border-[#E8E5E0] bg-white p-5">
        <div>
          <p className="text-sm font-semibold text-[#2E2D29]">LINE通知</p>
          <p className="mt-0.5 text-xs text-[#8B877F]">連携済みのLINEアカウントへ、運用に必要な通知を届けます（LINE連携は準備中です。設定は先に保存できます）</p>
        </div>
        <ul className="space-y-1">
          {NOTIFICATIONS.map((n) => (
            <li key={n.key} className="flex items-center justify-between gap-4 rounded-xl px-3 py-3 transition-colors hover:bg-[#FAF9F7]">
              <div>
                <Label htmlFor={`notify-${n.key}`} className="cursor-pointer">
                  {n.label}
                </Label>
                <p className="mt-0.5 text-xs text-[#8B877F]">{n.description}</p>
              </div>
              <Switch id={`notify-${n.key}`} checked={notifications[n.key]} onChange={(v) => setNotifications((p) => ({ ...p, [n.key]: v }))} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
