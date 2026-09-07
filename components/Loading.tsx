/** 画面遷移中に出す表示。中身が届くまでの間だけ見える */
export function Loading({ label = "読み込んでいます" }: { label?: string }) {
  return (
    <div className="loading" role="status" aria-live="polite">
      <span className="spin" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
