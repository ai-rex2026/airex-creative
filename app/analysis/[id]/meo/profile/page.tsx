"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { draftDescriptionAction, saveProfileDraftAction } from "@/app/meo-actions";
import { MeoPageHeader, useMeo } from "@/components/meo/Workspace";
import { Btn, Checkbox, ErrorNote, GuardNotes, Icon, Input, Label, Switch, Textarea, useSaveFeedback } from "@/components/meo/ui";
import { calcCompleteness, pendingItems } from "@/lib/meo-ops/logic";
import type { MeoProfileDraft } from "@/lib/meo-ops/types";
import type { GuardHit } from "@/lib/types";

const PAYMENT_METHODS = ["クレジットカード", "電子マネー", "QRコード決済", "現金", "デビットカード", "モバイル決済"];
const ATTRIBUTES = [
  { key: "wifi", label: "Wi-Fiあり" },
  { key: "parking", label: "駐車場あり" },
  { key: "smoking", label: "喫煙可" },
  { key: "pet", label: "ペット同伴可" },
  { key: "kids", label: "子ども連れ歓迎" },
  { key: "barrierFree", label: "バリアフリー対応" },
];

/** プロフィール完成度の確認と、アプリ内で編集できる項目の管理 */
export default function MeoProfilePage() {
  const { data, analysisId } = useMeo();
  const router = useRouter();
  const score = calcCompleteness(data.checklist);
  const pending = pendingItems(data.checklist);

  // 保存するまでは編集中の値を画面内に保持する。未入力のNAPは店舗の実測で埋めておく
  const [draft, setDraft] = useState<MeoProfileDraft>({
    ...data.profileDraft,
    storeName: data.profileDraft.storeName || data.store.name.split("|")[0].trim(),
    address: data.profileDraft.address || (data.store.address ?? ""),
    phoneNumber: data.profileDraft.phoneNumber || (data.store.phoneNumber ?? ""),
    websiteUrl: data.profileDraft.websiteUrl || (data.store.websiteUrl ?? ""),
  });
  const { isSaved, notifySaved } = useSaveFeedback();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [hits, setHits] = useState<GuardHit[]>([]);

  const update = (patch: Partial<MeoProfileDraft>) => setDraft((prev) => ({ ...prev, ...patch }));

  const save = async () => {
    setSaveError(null);
    try {
      await saveProfileDraftAction(analysisId, draft);
      notifySaved();
      router.refresh();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "プロフィールの保存に失敗しました。時間をおいて再度お試しください。");
    }
  };

  const generate = async () => {
    setGenerating(true);
    setSaveError(null);
    try {
      const r = await draftDescriptionAction(analysisId, {
        storeName: draft.storeName,
        paymentMethods: draft.paymentMethods,
        attributes: ATTRIBUTES.filter((a) => draft.attributes[a.key]).map((a) => a.label),
      });
      update({ description: r.description });
      setHits(r.hits);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "説明文を作れませんでした");
    } finally {
      setGenerating(false);
    }
  };

  const togglePayment = (m: string) =>
    update({ paymentMethods: draft.paymentMethods.includes(m) ? draft.paymentMethods.filter((x) => x !== m) : [...draft.paymentMethods, m] });

  return (
    <div className="space-y-5">
      <MeoPageHeader
        icon="store"
        title="プロフィール"
        description="未設定の項目を埋めるほど、マップ検索で見つけてもらいやすくなります"
        action={
          <Btn onClick={save}>
            <Icon name={isSaved ? "check" : "save"} />
            {isSaved ? "保存しました" : "変更を保存"}
          </Btn>
        }
      />
      {saveError && <ErrorNote>{saveError}</ErrorNote>}

      <section className="rounded-2xl border border-[#E8E5E0] bg-white p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-[#2E2D29]">完成度</p>
            <p className="mt-0.5 text-xs text-[#8B877F]">{pending.length > 0 ? `未設定は${pending.length}項目です` : "すべての項目が設定済みです"}</p>
          </div>
          <p className="disp text-3xl font-black text-[#2E2D29]">
            {score}
            <span className="ml-0.5 text-sm font-normal text-[#A5A198]">%</span>
          </p>
        </div>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[#F0EEEA]">
          <div className="h-full rounded-full bg-[#2E2D29] transition-[width] duration-500" style={{ width: `${score}%` }} />
        </div>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {data.checklist.map((item) => (
            <li key={item.key} className="flex items-start gap-2.5 rounded-xl border border-[#F0EEEA] p-3">
              <Icon name={item.done ? "checkCircle" : "circle"} className={`mt-0.5 h-4 w-4 shrink-0 ${item.done ? "text-[#26251F]" : "text-[#C9C4BA]"}`} />
              <div className="min-w-0">
                <p className="text-sm font-medium text-[#2E2D29]">
                  {item.label}
                  <span className="ml-1.5 text-xs font-normal text-[#A5A198]">+{item.weight}</span>
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-[#8B877F]">{item.description}</p>
                {!item.editableInApp && (
                  <a href="https://business.google.com/" target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-[#8A5340] hover:underline">
                    Googleで編集
                    <Icon name="external" className="h-3 w-3" />
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-4 rounded-2xl border border-[#E8E5E0] bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-[#2E2D29]">ビジネスの説明</p>
            <p className="mt-0.5 text-xs text-[#8B877F]">店舗の強み・来店メリットを書きます（750文字まで）</p>
          </div>
          <Btn size="sm" variant="outline" onClick={generate} disabled={generating} className="shrink-0">
            <Icon name={generating ? "loader" : "sparkles"} />
            {generating ? "作成中..." : "AIで作る"}
          </Btn>
        </div>
        <Textarea
          rows={6}
          value={draft.description}
          maxLength={750}
          onChange={(e) => update({ description: e.target.value })}
          placeholder="例: 当店は◯◯駅から徒歩3分。丁寧なカウンセリングと明朗な料金で、初めての方にも安心してご利用いただけます。"
          className="resize-y"
        />
        <GuardNotes hits={hits} />
        <p className="text-xs text-[#A5A198]">{draft.description.length} / 750文字</p>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3 rounded-2xl border border-[#E8E5E0] bg-white p-5">
          <p className="text-sm font-semibold text-[#2E2D29]">決済方法</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {PAYMENT_METHODS.map((m, i) => (
              <label
                key={m}
                htmlFor={`payment-${i}`}
                className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-[#F0EEEA] p-3 text-sm text-[#3F3D38] transition-colors hover:border-[#D8D4CC]"
              >
                <Checkbox id={`payment-${i}`} checked={draft.paymentMethods.includes(m)} onChange={() => togglePayment(m)} />
                {m}
              </label>
            ))}
          </div>
        </div>
        <div className="space-y-3 rounded-2xl border border-[#E8E5E0] bg-white p-5">
          <p className="text-sm font-semibold text-[#2E2D29]">設備・属性</p>
          <ul className="space-y-1">
            {ATTRIBUTES.map((a) => (
              <li key={a.key} className="flex items-center justify-between rounded-xl px-3 py-2.5 transition-colors hover:bg-[#FAF9F7]">
                <Label htmlFor={`attr-${a.key}`} className="cursor-pointer">
                  {a.label}
                </Label>
                <Switch id={`attr-${a.key}`} checked={draft.attributes[a.key] === true} onChange={(v) => update({ attributes: { ...draft.attributes, [a.key]: v } })} />
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="space-y-4 rounded-2xl border border-[#E8E5E0] bg-white p-5">
        <div>
          <p className="text-sm font-semibold text-[#2E2D29]">NAP情報</p>
          <p className="mt-0.5 text-xs text-[#8B877F]">店舗名・住所・電話番号を自社サイトや各種媒体と統一します</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="nap-name">店舗名</Label>
            <Input id="nap-name" value={draft.storeName} onChange={(e) => update({ storeName: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nap-phone">電話番号</Label>
            <Input id="nap-phone" value={draft.phoneNumber} onChange={(e) => update({ phoneNumber: e.target.value })} placeholder="03-0000-0000" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="nap-address">住所</Label>
            <Input id="nap-address" value={draft.address} onChange={(e) => update({ address: e.target.value })} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="nap-website">Webサイト</Label>
            <Input id="nap-website" value={draft.websiteUrl} onChange={(e) => update({ websiteUrl: e.target.value })} />
          </div>
        </div>
        <p className="text-xs text-[#A5A198]">ここで保存した内容はアプリ内の下書きです。Googleへの反映はGoogleビジネスプロフィールの管理画面で行ってください。</p>
      </section>
    </div>
  );
}
