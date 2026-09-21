import { AD_PLATFORMS, missingEnv } from "@/lib/ads/platforms";
import type { AdConnectionView } from "@/app/ad-actions";
import { AdDisconnectButton } from "./AdDisconnectButton";

/**
 * 設定画面の「広告アカウント連携」。媒体ごとに状態と操作を1行で出す。
 * 連携は <a> で /api/ads/{媒体}/start に飛ばす（媒体の認可画面へ画面ごと遷移するため）。
 */
export function AdConnections({
  connections,
  canConnect,
  ok,
  error,
}: {
  connections: AdConnectionView[];
  canConnect: boolean;
  ok?: string;
  error?: string;
}) {
  const okName = AD_PLATFORMS.find((p) => p.id === ok)?.name;
  const unset = AD_PLATFORMS.map((p) => ({ p, missing: missingEnv(p) })).filter((x) => x.missing.length > 0);

  return (
    <>
      {okName && (
        <p className="note">
          <i className="i">i</i>
          <span>{okName}と連携しました。</span>
        </p>
      )}
      {error && (
        <p className="note">
          <i className="i">!</i>
          <span>{error}</span>
        </p>
      )}

      <div className="rows" style={{ marginTop: 20 }}>
        <div className="rh">広告アカウント連携（運用実績の分析）</div>
        {AD_PLATFORMS.map((def) => {
          const conn = connections.find((c) => c.platform === def.id);
          const missing = missingEnv(def);
          const shown = conn?.accounts.slice(0, 3).map((a) => `${a.name === a.id ? a.id : `${a.name}（${a.id}）`}${a.manager ? "［MCC］" : ""}`) ?? [];
          const rest = (conn?.accounts.length ?? 0) - shown.length;

          return (
            <div className="r" key={def.id}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <b>{def.name}</b>
                <small>
                  {conn
                    ? `連携済み（${new Date(conn.connected_at).toLocaleDateString("ja-JP")}）。${
                        shown.length
                          ? `対象アカウント：${shown.join("、")}${rest > 0 ? ` ほか${rest}件` : ""}`
                          : "対象アカウントは、分析を始めるときに選びます。"
                      }${conn.note ? ` ※${conn.note}` : ""}`
                    : `連携すると、${def.media}の実績（費用・クリック・CV・CPA・ROAS）を読み取って分析できます。このツールは実績の読み取りにだけ使い、広告の変更はしません。`}
                </small>
              </div>
              {conn ? (
                <AdDisconnectButton platform={def.id} />
              ) : missing.length > 0 ? (
                <span className="tag warn">未設定</span>
              ) : canConnect ? (
                <a className="btn sm" href={`/api/ads/${def.id}/start`}>
                  連携する
                </a>
              ) : (
                <a className="btn ghost sm" href="/login?mode=signup">
                  本登録が必要
                </a>
              )}
            </div>
          );
        })}
      </div>

      {unset.map(({ p, missing }) => (
        <p className="note" key={p.id}>
          <i className="i">i</i>
          <span>
            {p.name}の連携には {missing.map((k) => <code key={k}>{k} </code>)}の設定が必要です。
          </span>
        </p>
      ))}
    </>
  );
}
