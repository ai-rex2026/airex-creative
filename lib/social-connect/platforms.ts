/**
 * 公式SNSアカウント連携（OAuth）の定義。設定画面・OAuth ルート・トークン管理が共通で見る。
 *
 * lib/ads/platforms.ts の "広告アカウント連携"（運用実績の分析。TIKTOK_APP_ID/X_API_KEY 等）
 * とは別物。こちらは自社／クライアント自身のSNSアカウントを連携して、投稿・動画ごとの
 * エンゲージメント指標（いいね・再生・コメント数など）を公式APIで読むための連携で、
 * 読み取り専用スコープのみを使う（投稿・設定変更はしない）。
 *
 * ここの id は DB（sns_connections.platform）と URL（/api/social/{id}/start）にそのまま使う。
 */

export type SnsPlatform = "x" | "tiktok";

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
    media: "プロフィール（フォロワー数）と、投稿ごとのいいね・リポスト・返信数",
    env: ["X_CLIENT_ID", "X_CLIENT_SECRET"],
  },
  {
    id: "tiktok",
    name: "TikTok",
    media: "プロフィール（フォロワー数・総いいね数）と、動画ごとの再生・いいね・コメント・シェア数",
    env: ["TIKTOK_LOGIN_CLIENT_KEY", "TIKTOK_LOGIN_CLIENT_SECRET"],
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
