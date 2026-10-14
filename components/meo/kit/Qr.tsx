"use client";

import QRCode from "qrcode";
import { useEffect, useRef } from "react";
import { Btn, Icon } from "@/components/meo/ui";

/** QR コード（店頭に置く用）。画像として保存できる */
export function Qr({ value, label }: { value: string; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current && value) QRCode.toCanvas(ref.current, value, { width: 168, margin: 1 }).catch(() => {});
  }, [value]);
  const download = () => {
    const c = ref.current;
    if (!c) return;
    const a = document.createElement("a");
    a.href = c.toDataURL("image/png");
    a.download = `qr_${label}.png`;
    a.click();
  };
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-[#E8E5E0] bg-white p-3">
      <canvas ref={ref} width={168} height={168} />
      <p className="text-xs font-semibold text-[#2E2D29]">{label}</p>
      <Btn variant="outline" size="sm" onClick={download}>
        <Icon name="save" className="h-3.5 w-3.5" />
        画像を保存
      </Btn>
    </div>
  );
}
