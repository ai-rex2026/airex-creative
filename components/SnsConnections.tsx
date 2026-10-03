import { SNS_PLATFORMS, missingSnsEnv } from "@/lib/social-connect/platforms";
import type { SnsConnectionView } from "@/app/social-actions";
import { SnsDisconnectButton } from "./SnsDisconnectButton";
import { PlatformIcon } from "./PlatformIcons";

/**
 * 設定画面の「公式SNSアカウント連携」。媒体ごとに状態と操作を1行で出す。
 * 連携は <a> で /api/social/{媒体}/start に飛ばす（media側の認可画面へ画面ごと遷移するため）。
 * components/AdConnections.tsx と同じ形。
 *
 * X・TikTok・Meta（Instagram/Facebook）とも実装自体は済んでいるが、2026-10時点では
 * 分析（lib/social.ts）側がこの連携を使わない方針になった（分析対象のURLと連携アカウントが
 * 紐付くとは限らない・取れるデータがApify実測より乏しいため）。そのため新規の連携は
 * いったん受け付けず、「連携する」ボタンは非活性の「対応予定」表示にしている。
 * すでに連携済みのアカウントは解除だけできる（SnsDisconnectButton）。
 * 分析対象ごとに連携アカウントを選べるUIと合わせて「運用」機能を作る際に、
 * ここを元の「連携する」ボタンに戻す想定（lib/social.ts の readOfficialAccount 参照）。
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
  void canConnect;
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

          return (
            <div className="r" key={def.id}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <b><PlatformIcon platform={def.id} size={15} /> {def.name}</b>
                <small>
                  {conn
                    ? `連携済み（${new Date(conn.connected_at).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" })}）${conn.label ? `：@${conn.label}` : ""}${
                        conn.followers !== null ? `・フォロワー${conn.followers.toLocaleString()}人` : ""
                      }`
                    : `現在、分析では${def.name}のデータをLPのリンクから自動取得しているため、ここでの連携は停止しています。`}
                </small>
              </div>
              {conn ? (
                <SnsDisconnectButton platform={def.id} />
              ) : (
                <button type="button" className="btn sm" disabled title="分析対象ごとに選べるUIと合わせて今後対応予定です">
                  対応予定
                </button>
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
