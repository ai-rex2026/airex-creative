/**
 * 広告媒体の連携定義。設定画面・OAuth ルート・トークン管理が共通で見る。
 *
 * ここの id は DB（ad_connections.platform）と URL（/api/ads/{id}/start）にそのまま使う。
 * 分析用の Google / Meta 連携（Search Console・GA4・Instagram）は別物で、
 * こちらは「広告アカウントの運用実績」を読むための連携。
 */

export type AdPlatform = "google" | "yahoo" | "meta" | "microsoft" | "tiktok" | "x";

export type AdPlatformDef = {
  id: AdPlatform;
  name: string;
  /** 何が読めるようになるか。設定画面の説明に出す */
  media: string;
  /** 連携に必要な環境変数。1つでも欠けていれば「未設定」にする */
  env: string[];
};

export const AD_PLATFORMS: AdPlatformDef[] = [
  {
    id: "google",
    name: "Google 広告",
    media: "検索・ディスプレイ・P-MAX・YouTube 広告",
    // GOOGLE_ADS_DEVELOPER_TOKEN は任意。Google がクラウド管理のアクセスに移行中で、
    // 移行済みのアカウントでは不要。あれば API 呼び出しに付ける
    env: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  },
  {
    id: "yahoo",
    name: "Yahoo! 広告",
    media: "検索広告・ディスプレイ広告（YDA）・LINE広告",
    env: ["YAHOO_ADS_CLIENT_ID", "YAHOO_ADS_CLIENT_SECRET"],
  },
  {
    id: "meta",
    name: "Meta 広告",
    media: "Facebook・Instagram 広告",
    env: ["META_APP_ID", "META_APP_SECRET"],
  },
  {
    id: "microsoft",
    name: "Microsoft 広告",
    media: "Bing・Microsoft Audience Network",
    env: ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET", "MICROSOFT_DEVELOPER_TOKEN"],
  },
  {
    id: "tiktok",
    name: "TikTok 広告",
    media: "TikTok For Business",
    env: ["TIKTOK_APP_ID", "TIKTOK_SECRET"],
  },
  {
    id: "x",
    name: "X 広告",
    media: "X（旧 Twitter）広告。Ads API の利用承認が別途必要",
    env: ["X_API_KEY", "X_API_SECRET"],
  },
];

export function isAdPlatform(v: string): v is AdPlatform {
  return AD_PLATFORMS.some((p) => p.id === v);
}

export function platformDef(id: AdPlatform): AdPlatformDef {
  return AD_PLATFORMS.find((p) => p.id === id)!;
}

/** 未設定の環境変数名。空なら連携できる */
export function missingEnv(def: AdPlatformDef): string[] {
  return def.env.filter((k) => !process.env[k]);
}
