"use client";

import { useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";

/**
 * MEO運用ワークスペースの部品。本体は shadcn/ui ＋ lucide-react で組んでいるが、
 * Studio には入っていないので、同じ見た目の最小限を自前で持つ（依存を増やさない）。
 */

export function cn(...xs: (string | false | null | undefined)[]) {
  return xs.filter(Boolean).join(" ");
}

// ── アイコン（線画。currentColor で描く） ─────────────────
const PATHS: Record<string, ReactNode> = {
  home: (<><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></>),
  message: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  reply: (<><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /><path d="m10 7-3 3 3 3" /><path d="M17 13v-1a2 2 0 0 0-2-2H7" /></>),
  megaphone: (<><path d="m3 11 18-5v12L3 14v-3z" /><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" /></>),
  store: (<><path d="M3 9 5 3h14l2 6" /><path d="M3 9h18v2a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0z" /><path d="M5 13v8h14v-8" /><path d="M10 21v-5h4v5" /></>),
  images: (<><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-5-5L5 21" /></>),
  imageOff: (<><rect x="3" y="3" width="18" height="18" rx="2" /><path d="m21 15-5-5L5 21" /><path d="M3 3l18 18" /></>),
  chart: (<><path d="M3 3v18h18" /><path d="M18 17V9" /><path d="M13 17V5" /><path d="M8 17v-3" /></>),
  bot: (<><rect x="3" y="11" width="18" height="10" rx="2" /><circle cx="12" cy="5" r="2" /><path d="M12 7v4" /><path d="M8 16h.01" /><path d="M16 16h.01" /></>),
  settings: (<><path d="M4 21v-7" /><path d="M4 10V3" /><path d="M12 21v-9" /><path d="M12 8V3" /><path d="M20 21v-5" /><path d="M20 12V3" /><path d="M1 14h6" /><path d="M9 8h6" /><path d="M17 16h6" /></>),
  arrowRight: (<><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></>),
  arrowLeft: (<><path d="m12 19-7-7 7-7" /><path d="M19 12H5" /></>),
  arrowUpRight: (<><path d="M7 17 17 7" /><path d="M7 7h10v10" /></>),
  arrowDownRight: (<><path d="m7 7 10 10" /><path d="M17 7v10H7" /></>),
  minus: <path d="M5 12h14" />,
  check: <path d="M20 6 9 17l-5-5" />,
  checkCircle: (<><circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" /></>),
  circle: <circle cx="12" cy="12" r="10" />,
  circleDashed: <circle cx="12" cy="12" r="10" strokeDasharray="4 3" />,
  x: (<><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>),
  alert: (<><circle cx="12" cy="12" r="10" /><path d="M12 8v4" /><path d="M12 16h.01" /></>),
  alertTriangle: (<><path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4" /><path d="M12 17h.01" /></>),
  minusCircle: (<><circle cx="12" cy="12" r="10" /><path d="M8 12h8" /></>),
  mapPin: (<><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></>),
  star: <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z" />,
  search: (<><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></>),
  sparkles: (<><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /><path d="M19 3v4" /><path d="M21 5h-4" /></>),
  send: (<><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></>),
  refresh: (<><path d="M3 12a9 9 0 0 1 15.3-6.4L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-15.3 6.4L3 16" /><path d="M8 16H3v5" /></>),
  external: (<><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></>),
  calendar: (<><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4" /><path d="M8 2v4" /><path d="M3 10h18" /></>),
  clock: (<><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></>),
  plus: (<><path d="M5 12h14" /><path d="M12 5v14" /></>),
  save: (<><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><path d="M17 21v-8H7v8" /><path d="M7 3v5h8" /></>),
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronUp: <path d="m18 15-6-6-6 6" />,
  link: (<><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></>),
  unlink: (<><path d="M18.84 12.25 20.56 10.54a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="m5.16 11.75-1.72 1.71a5 5 0 0 0 7.07 7.07l1.72-1.71" /><path d="M8 2v3" /><path d="M2 8h3" /><path d="M16 22v-3" /><path d="M22 16h-3" /></>),
  thumbsUp: (<><path d="M7 10v12" /><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" /></>),
  image: (<><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-5-5L5 21" /></>),
  imagePlus: (<><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7" /><path d="M16 5h6" /><path d="M19 2v6" /><circle cx="9" cy="9" r="2" /><path d="m21 15-5-5L5 21" /></>),
  file: (<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M16 13H8" /><path d="M16 17H8" /></>),
  quote: (<><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.76-2.02-2-2H4c-1.25 0-2 .75-2 1.97V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .01-1 1.03V20c0 1 0 1 1 1z" /><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.76-2.02-2-2h-4c-1.25 0-2 .75-2 1.97V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z" /></>),
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, className, filled, strokeWidth = 2 }: { name: IconName | string; className?: string; filled?: boolean; strokeWidth?: number }) {
  if (name === "loader") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" className={cn("animate-spin", className ?? "h-4 w-4")} aria-hidden>
        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? "h-4 w-4"}
      aria-hidden
    >
      {PATHS[name] ?? PATHS.circle}
    </svg>
  );
}

// ── ボタン ───────────────────────────────────
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "outline" | "ghost" | "gold";
  size?: "sm" | "md";
};

export function Btn({ variant = "primary", size = "md", className, ...rest }: BtnProps) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50",
        size === "sm" ? "h-8 px-3 text-xs" : "h-10 px-4 text-sm",
        variant === "primary" && "bg-[#2E2D29] text-white hover:bg-[#3F3D38]",
        variant === "gold" && "bg-[#C9A84C] text-[#2E2D29] hover:bg-[#B8973F]",
        variant === "outline" && "border border-[#E0DBD1] bg-white text-[#2E2D29] hover:bg-[#FAF9F7]",
        variant === "ghost" && "text-[#6B6862] hover:bg-[#F4F3F0]",
        className
      )}
    />
  );
}

export const inputClass =
  "w-full rounded-lg border border-[#E0DBD1] bg-white px-3 py-2 text-sm text-[#2E2D29] outline-none transition-colors placeholder:text-[#A5A198] focus:border-[#C9A84C]";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(inputClass, "h-10", props.className)} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(inputClass, "leading-relaxed", props.className)} />;
}

export function Label({ htmlFor, children, className }: { htmlFor?: string; children: ReactNode; className?: string }) {
  return (
    <label htmlFor={htmlFor} className={cn("block text-sm font-medium text-[#2E2D29]", className)}>
      {children}
    </label>
  );
}

export function Select({
  id,
  value,
  onChange,
  options,
  className,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={cn(inputClass, "h-10", className)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Checkbox({ id, checked, onChange }: { id?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <input
      id={id}
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="h-4 w-4 shrink-0 cursor-pointer rounded border-[#C9C4BA] accent-[#2E2D29]"
    />
  );
}

export function Switch({ id, checked, onChange }: { id?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
        checked ? "bg-[#2E2D29]" : "bg-[#E0DBD1]"
      )}
    >
      <span className={cn("inline-block h-5 w-5 rounded-full bg-white shadow transition-transform", checked ? "translate-x-5" : "translate-x-0.5")} />
    </button>
  );
}

// ── ダイアログ ─────────────────────────────────
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onOpenChange(false);
    window.addEventListener("keydown", onKey);
    ref.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="presentation">
      <div className="absolute inset-0 bg-black/40" onClick={() => onOpenChange(false)} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={cn("relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[#E8E5E0] bg-white p-6 shadow-xl outline-none", className)}
      >
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          aria-label="閉じる"
          className="absolute right-4 top-4 rounded-full p-1 text-[#8B877F] hover:bg-[#F4F3F0]"
        >
          <Icon name="x" />
        </button>
        <div className="pr-6">
          <h2 className="disp text-lg font-bold text-[#2E2D29]">{title}</h2>
          {description && <div className="mt-1.5 text-sm leading-relaxed text-[#6B6862]">{description}</div>}
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

// ── 共通表示 ─────────────────────────────────
export function ErrorNote({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-[#ECD9CE] bg-[#F8F1ED] px-4 py-3 text-sm text-[#A8705A]">{children}</p>;
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("rounded-2xl border border-[#E8E5E0] bg-white p-5", className)}>{children}</section>;
}

/** 法令チェックの指摘。生成と同時に通した結果をその場で見せる */
export function GuardNotes({ hits }: { hits: { text: string; reason: string; law: string; suggestion: string; severity?: string }[] }) {
  if (!hits.length) return null;
  return (
    <div className="rounded-xl border border-[#ECD9CE] bg-[#F8F1ED] p-3">
      <p className="flex items-center gap-1.5 text-xs font-bold text-[#8A5340]">
        <Icon name="alertTriangle" className="h-3.5 w-3.5" />
        表現チェック：{hits.length}件の指摘
      </p>
      <ul className="mt-1.5 space-y-1">
        {hits.map((h, i) => (
          <li key={i} className="text-xs leading-relaxed text-[#6B6862]">
            「{h.text}」— {h.reason}（{h.law}）。{h.suggestion}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 「保存しました」の一時表示。連続保存でもタイマーを測り直し、離脱後に発火させない */
export function useSaveFeedback(): { isSaved: boolean; notifySaved: () => void } {
  const [isSaved, setIsSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const notifySaved = useCallback(() => {
    clearTimeout(timer.current);
    setIsSaved(true);
    timer.current = setTimeout(() => setIsSaved(false), 2000);
  }, []);
  return { isSaved, notifySaved };
}
