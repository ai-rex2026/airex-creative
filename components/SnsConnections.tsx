import { SNS_PLATFORMS, missingSnsEnv } from "@/lib/social-connect/platforms";
import type { SnsConnectionView } from "@/app/social-actions";
import { SnsDisconnectButton } from "./SnsDisconnectButton";

/**
 * 設定画面の「公式SNSアカウント連携」。媒体ごとに状態と操作を1行で出す。
 * 連携は <a> で /api/social/{媒体}/start に飛ばす（media側の認可画面へ画面ごと遷移するため）。
 * components/AdConnections.tsx と同じ形。
 *
 * X・TikTok・Meta（Instagram/Facebook）とも実装済みで実際に動作するので、通常どおり
 * 連携／解除ボタンを出す（SNS_PLATFORMS に無い媒体を足すときだけ、ここに固定行を足す）。
 */
export function SnsConnections({
  connections,
  canConnect,
  ok,
  error,
}: {
  connections: SnsConnectionView[];
  canConnect: boolean;
  ok?: string;
  error?: string;
}) {
  const okName = SNS_PLATFORMS.find((p) => p.id === ok)?.name;
  const unset = SNS_PLATFORMS.map((p) => ({ p, missing: missingSnsEnv(p) })).filter((x) => x.missing.length > 0);

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
        <div className="rh">公式SNSアカウント連携（投稿・動画ごとの実績分析）</div>
        {SNS_PLATFORMS.map((def) => {
          const conn = connections.find((c) => c.platform === def.id);
          const missing = missingSnsEnv(def);

          return (
            <div className="r" key={def.id}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <b>{def.name}</b>
                <small>
                  {conn
                    ? `連携済み（${new Date(conn.connected_at).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" })}）${conn.label ? `：@${conn.label}` : ""}${
                        conn.followers !== null ? `・フォロワー${conn.followers.toLocaleString()}人` : ""
                      }`
                    : `連携すると、自社（またはクライアント）の${def.name}アカウントの${def.media}をレポートに反映できます。このツールは実績の読み取りにだけ使い、投稿や設定の変更はしません。`}
                </small>
              </div>
              {conn ? (
                <SnsDisconnectButton platform={def.id} />
              ) : missing.length > 0 ? (
                <span className="tag warn">未設定</span>
              ) : canConnect ? (
                <a className="btn sm" href={`/api/social/${def.id}/start`}>
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
