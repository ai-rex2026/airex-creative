/** 手動点検の期限判定（DB・ネットワークに触れない純粋な処理） */
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
  if (days >= m.interval_days) return { overdue: true, days, label: `期限切れ（${days}日経過）` };
  return { overdue: false, days, label: `${days}日前に点検（あと${m.interval_days - days}日）` };
}
