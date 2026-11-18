/** 手動点検の経過日数の判定（interval_days 以上たつと警告）（DB・ネットワークに触れない純粋な処理） */
export type ManualRow = {
  key: string;
  area: string;
  title: string;
  url: string;
  note: string;
  interval_days: number;
  last_checked_at: string | null;
  last_result: "" | "changed" | "none";
  last_memo: string;
};

const DAY = 86_400_000;

export function manualStatus(m: Pick<ManualRow, "interval_days" | "last_checked_at">, now: number = Date.now()): { overdue: boolean; days: number | null; label: string } {
  if (!m.last_checked_at) return { overdue: true, days: null, label: "未点検" };
  const days = Math.floor((now - new Date(m.last_checked_at).getTime()) / DAY);
  if (days >= m.interval_days) return { overdue: true, days, label: `前回の点検から${days}日経過しています` };
  return { overdue: false, days, label: `${days}日前に点検` };
}
