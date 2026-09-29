import { SNS_PLATFORMS } from "@/lib/social-connect/platforms";
import type { SnsConnectionView } from "@/app/social-actions";

/**
 * 設定画面の「公式SNSアカウント連携（投稿・動画ごとの実績分析）」。
 *
 * X・TikTokは実装済みで動作するが、Instagram / Facebook側の対応が揃うまでは
 * 3媒体まとめて「対応予定」表示にして押せない状態にしている（意図的な一時停止）。
 * 対応を再開するときは、この固定表示をやめて元の連携／解除ボタン（SNS_PLATFORMSベースの
 * 出し分け・Instagram/Facebookは components/MetaConnect.tsx）に戻すこと。
 *
 * 呼び出し側（app/settings/page.tsx）との互換のため props は従来どおり受け取るが、
 * 表示は固定（媒体名・説明・「対応予定」タグ）のみで、値そのものは使わない。
 */
export function SnsConnections({
  connections: _connections,
  canConnect: _canConnect,
  ok: _ok,
  error: _error,
}: {
  connections: SnsConnectionView[];
  canConnect: boolean;
  ok?: string;
  error?: string;
}) {
  const platforms = [
    ...SNS_PLATFORMS.map((p) => ({ id: p.id as string, name: p.name, media: p.media })),
    {
      id: "meta",
      name: "Instagram / Facebook",
      media: "フォロワー数・投稿数・到達数など非公開の実データ",
    },
  ];

  return (
    <div className="rows" style={{ marginTop: 20 }}>
      <div className="rh">公式SNSアカウント連携（投稿・動画ごとの実績分析）</div>
      {platforms.map((def) => (
        <div className="r" key={def.id}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <b>{def.name}</b>
            <small>連携すると、{def.media}をレポートに反映できるようになります。</small>
          </div>
          <span className="tag">対応予定</span>
        </div>
      ))}
    </div>
  );
}
