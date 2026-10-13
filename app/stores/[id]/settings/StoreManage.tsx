"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { renameStoreAction } from "@/app/meo-actions";
import { Btn, ErrorNote } from "@/components/meo/ui";

const inputClass = "h-10 w-full rounded-lg border border-[#E0DBD1] bg-white px-3 text-sm text-[#2E2D29]";
const msg = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

/** 店舗の表示名の変更 */
export function StoreManage({ storeId, storeName }: { storeId: string; storeName: string }) {
  const router = useRouter();
  const [name, setName] = useState(storeName);
  const [renaming, setRenaming] = useState(false);
  const [renamed, setRenamed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rename = async () => {
    setRenaming(true);
    setError(null);
    setRenamed(false);
    try {
      await renameStoreAction(storeId, name);
      setRenamed(true);
      router.refresh();
    } catch (e) {
      setError(msg(e, "店舗名を変更できませんでした"));
    } finally {
      setRenaming(false);
    }
  };

  return (
    <section className="space-y-5 rounded-2xl border border-[#E8E5E0] bg-white p-5">
      <p className="text-sm font-semibold text-[#2E2D29]">店舗名</p>
      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="space-y-2">
        <label htmlFor="store-rename" className="text-xs font-semibold text-[#2E2D29]">店舗名の変更</label>
        <p className="text-xs text-[#8B877F]">このアプリ内の表示名だけが変わります。Google上の店舗名は変わりません。</p>
        <div className="flex flex-wrap items-center gap-2">
          <input id="store-rename" className={`${inputClass} max-w-md`} value={name} maxLength={100} onChange={(e) => { setName(e.target.value); setRenamed(false); }} />
          <Btn variant="outline" onClick={rename} disabled={renaming || !name.trim() || name.trim() === storeName}>
            {renaming ? "変更中…" : "名前を変更する"}
          </Btn>
          {renamed && <span className="text-xs text-[#8B877F]">変更しました</span>}
        </div>
      </div>
    </section>
  );
}
