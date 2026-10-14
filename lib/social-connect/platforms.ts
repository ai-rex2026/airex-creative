/**
 * 公式SNSアカウント連携（OAuth）の定義。設定画面・OAuth ルート・トークン管理が共通で見る。
 *
 * lib/ads/platforms.ts の "広告アカウント連携"（運用実績の分析。TIKTOK_APP_ID/X_API_KEY 等）
 * とは別物。こちらは自社／クライアント自身のSNSアカウントを連携して、投稿・動画ごとの
 * エンゲージメント指標（いいね・再生・コメント数など）を公式APIで読むための連携。
 * X だけは SNS運用画面（/sns）から人が確認した投稿を送るため tweet.write も求める（2026-10-13）。
 * TikTok・Instagram は読み取りのみ（投稿はコピーして各アプリから行う運用）。
 *
 * ここの id は DB（sns_connections.platform）と URL（/api/social/{id}/start）にそのまま使う。
 */

export type SnsPlatform = "x" | "tiktok" | "meta" | "youtube";

export type SnsPlatformDef = {
  id: SnsPlatform;
  name: string;
  /** 何が読めるようになるか。設定画面の説明に出す */
  media: string;
  /** 連携に必要な環境変数。1つでも欠けていれば「未設定」にする */
  env: string[];
};

export const SNS_PLATFORMS: SnsPlatformDef[] = [
  {
    id: "x",
    name: "X（Twitter）",
    media: "プロフィール（フォロワー数）と、投稿ごとのいいね・リポスト・返信数。SNS運用画面で確認した投稿をここから送れます（投稿の権限は連携時に付きます。以前に連携した場合は再連携が必要）",
    env: ["X_CLIENT_ID", "X_CLIENT_SECRET"],
  },
  {
    id: "tiktok",
    name: "TikTok",
    media: "プロフィール（フォロワー数・総いいね数）と、動画ごとの再生・いいね・コメント・シェア数",
    env: ["TIKTOK_LOGIN_CLIENT_KEY", "TIKTOK_LOGIN_CLIENT_SECRET"],
  },
  {
    id: "meta",
    name: "Instagram / Facebook",
    // Facebookページに連携済みのInstagramビジネス/クリエイターアカウントが対象（連携前にInstagram側の
    // 設定からFacebookページへの連携が必要）。1回の連携で、紐づくFacebookページ自体のデータ
    // （ファン数・投稿・到達数など）も合わせて読む
    media: "Instagramプロフィール（フォロワー数・投稿数・投稿ごとのいいね・コメント数）と、紐づくFacebookページ（ファン数・投稿・直近28日の到達数）",
    env: ["META_APP_ID", "META_APP_SECRET"],
  },
  {
    id: "youtube",
    name: "YouTube",
    media: "チャンネル（登録者数・動画数）と、動画ごとの再生・高評価・コメント数。SNS運用画面で承認した動画のアップロードとコメントへの返信ができます",
    env: ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET"],
  },
];

export function isSnsPlatform(v: string): v is SnsPlatform {
  return SNS_PLATFORMS.some((p) => p.id === v);
}

export function snsPlatformDef(id: SnsPlatform): SnsPlatformDef {
  return SNS_PLATFORMS.find((p) => p.id === id)!;
}

/** 未設定の環境変数名。空なら連携できる */
export function missingSnsEnv(def: SnsPlatformDef): string[] {
  return def.env.filter((k) => !process.env[k]);
}
