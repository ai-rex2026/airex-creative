"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createAioProjectAction, suggestAioProjectAction, updateAioProjectAction, type AioProjectInput } from "@/app/aio-actions";
import { TagInput } from "@/components/meo/parts";
import { Btn, Card, ErrorNote, Icon, Input, Label, Select, Textarea } from "@/components/meo/ui";
import type { AioProject } from "@/lib/aio/types";
import { INDUSTRY_LABEL, type Industry } from "@/lib/types";

/** AIO の対象の登録・編集フォーム。URL から AI に候補を考えさせ、人が直して保存する */
export function AioProjectForm({ mode, project, onSaved }: { mode: "create" | "edit"; project?: AioProject; onSaved?: () => void }) {
  const router = useRouter();
  const [f, setF] = useState<AioProjectInput>({
    name: project?.name ?? "",
    aliases: project?.aliases ?? [],
    url: project?.url ?? "",
    industry: project?.industry ?? "general",
    area: project?.area ?? "",
    category: project?.category ?? "",
    notes: project?.notes ?? "",
  });
  const [suggesting, setSuggesting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const suggest = async () => {
    setSuggesting(true);
    setError(null);
    setNote(null);
    try {
      const r = await suggestAioProjectAction(f.url, f.notes);
      setF((cur) => ({
        ...cur,
        name: cur.name || r.name,
        aliases: cur.aliases.length ? cur.aliases : r.aliases,
        category: r.category || cur.category,
        area: r.area,
        industry: r.industry,
      }));
      setNote("AI が候補を入れました。実態と違うところは直してください");
    } catch (e) {
      setError(e instanceof Error ? e.message : "候補を考えられませんでした");
    } finally {
      setSuggesting(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      if (mode === "create") {
        const id = await createAioProjectAction(f);
        router.push(`/aio/${id}`);
      } else if (project) {
        await updateAioProjectAction(project.id, f);
        onSaved?.();
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存できませんでした");
      setSaving(false);
    }
  };

  return (
    <Card className="space-y-4">
      <div>
        <Label htmlFor="aio-url">Webサイトの URL</Label>
        <div className="mt-1 flex gap-2">
          <Input id="aio-url" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://example.co.jp/" />
          <Btn variant="outline" onClick={suggest} disabled={suggesting || !/^https?:\/\//.test(f.url.trim())} className="shrink-0">
            {suggesting ? <Icon name="loader" /> : <Icon name="sparkles" />}
            AIに考えさせる
          </Btn>
        </div>
        {note && <p className="mt-1 text-xs text-[#2F6B4A]">{note}</p>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="aio-name">事業者名（AIの回答に挙がったかの照合に使います）</Label>
          <Input id="aio-name" className="mt-1" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="例：AI OSI URI" />
        </div>
        <div>
          <Label htmlFor="aio-aliases">サービス名・別名（任意）</Label>
          <div className="mt-1">
            <TagInput id="aio-aliases" values={f.aliases} placeholder="Enterで追加" onChange={(v) => setF({ ...f, aliases: v })} />
          </div>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="aio-category">AIに聞くときの探し方（見込み客の言葉で）</Label>
          <Input id="aio-category" className="mt-1" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} placeholder="例：中小企業向けのAI導入支援、渋谷のパーソナルジム" />
          <p className="mt-1 text-xs text-[#8B877F]">実測では「{f.area ? `${f.area}で` : ""}{f.category || "〇〇"}を探しています。おすすめを教えて」と AI に聞きます</p>
        </div>
        <div>
          <Label htmlFor="aio-area">エリア（地域に依存しないなら空欄）</Label>
          <Input id="aio-area" className="mt-1" value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })} placeholder="例：渋谷区" />
        </div>
        <div>
          <Label htmlFor="aio-industry">業種（表現チェックの基準）</Label>
          <Select id="aio-industry" className="mt-1" value={f.industry} onChange={(v) => setF({ ...f, industry: v as Industry })} options={(Object.keys(INDUSTRY_LABEL) as Industry[]).map((k) => ({ value: k, label: INDUSTRY_LABEL[k] }))} />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="aio-notes">事業内容・強み・実績（下書きの材料。ここに無い数字は書かれません）</Label>
          <Textarea id="aio-notes" rows={5} className="mt-1" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="例：2024年創業。製造業の中小企業30社にAI導入を支援。初期費用なしの月額制。代表は元〇〇" />
        </div>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="flex justify-end">
        <Btn onClick={save} disabled={saving || !f.name.trim() || !f.category.trim()}>
          {saving ? <Icon name="loader" /> : <Icon name="save" />}
          {mode === "create" ? "登録する" : "保存する"}
        </Btn>
      </div>
    </Card>
  );
}
