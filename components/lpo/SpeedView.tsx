import type { SpeedScan } from "@/lib/pagespeed";

/** 表示速度（PageSpeed Insights の実測）。レポートの「表示速度」と同じ見せ方（LPO運用。2026-11-11） */
export function SpeedView({ speed }: { speed: SpeedScan }) {
  const hasData = speed.score !== null || speed.field.length > 0 || speed.lab.length > 0;
  if (!hasData) {
    return (
      <div className="note warn">
        <i className="i">!</i>
        <span>表示速度を測定できませんでした。{speed.reason}</span>
      </div>
    );
  }
  return (
    <>
      <div className="speed measure">
        {speed.score !== null && (
          <div className="gauge">
            <b>{speed.score}</b>
            <small>/ 100</small>
            <span className={speed.score >= 90 ? "ok" : speed.score >= 50 ? "warn" : "ng"}>{speed.score >= 90 ? "良好" : speed.score >= 50 ? "改善が必要" : "不良"}</span>
          </div>
        )}
        <div className="kpis">
          {(speed.field.length > 0 ? speed.field : speed.lab).map((m) => (
            <div className="kpi" key={m.id}>
              <b>{m.value}</b>
              <small>{m.label}</small>
              {m.rating && <i className={m.rating === "良好" ? "ok" : m.rating === "不良" ? "ng" : "warn"}>{m.rating}</i>}
            </div>
          ))}
        </div>
      </div>
      <div className="note">
        <i className="i">i</i>
        <span>
          {speed.cruxOnly ? speed.reason : speed.field.length > 0 ? "上の数字は実際にこのページを見た人の計測値（Chrome ユーザーエクスペリエンスレポート）です。" : speed.reason}
          {speed.testedUrl && <> 測定URL：{speed.testedUrl.replace(/^https?:\/\//, "")}</>}
          {speed.fetchedAt && <> （{new Date(speed.fetchedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 測定）</>}
        </span>
      </div>
      {speed.opportunities.length > 0 && (
        <div className="rows measure">
          <div className="rh">
            短縮の見込みがある改善<small>PageSpeed Insights の試算</small>
          </div>
          {speed.opportunities.map((o, i) => (
            <div className="r" key={i}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <b>{o.title}</b>
                <small>{o.detail}</small>
              </div>
              <span className="tag warn">{o.savingsDisplay}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
