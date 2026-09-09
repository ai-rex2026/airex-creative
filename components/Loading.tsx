/** 画面遷移中に出す表示。中身が届くまでの間だけ見える */
export function Loading({ label = "読み込んでいます" }: { label?: string }) {
  return (
    <div className="loading" role="status" aria-live="polite">
      <span className="spin" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

/**
 * その場で待たせるときの表示。
 * 施策の作り直しや実行プロンプトの生成は数十秒かかるので、
 * 文字だけだと止まって見える。
 */
export function Spinner({ label }: { label: string }) {
  return (
    <span className="inline-load" role="status" aria-live="polite">
      <span className="spin" aria-hidden="true" />
      {label}
    </span>
  );
}
