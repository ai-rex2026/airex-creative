import { discoverMetaPages, fetchInstagramProfile } from "@/lib/meta";
import type { SnsTokenSet } from "./oauth";

/**
 * Meta（Instagram/Facebook）連携の仕上げ。exchangeCode が返すのはユーザーの長期トークンまでで、
 * ここでそのトークンから「Instagramビジネスアカウントが紐づいたFacebookページ」を探し、
 * 実際にInstagramのデータ取得に使うPageアクセストークンとプロフィールを取る。
 *
 * 保存するのは Page のアクセストークン（投稿・フォロワー数の取得はこちらを使う）。
 * ユーザーの長期トークンはここでしか使わないため保存しない。
 *
 * Instagram側で「プロアカウント」をFacebookページに連携していないと対象のページが
 * 見つからない（= Instagram の設定＞アカウントセンターから先に連携が必要）。
 */
export async function fetchMetaProfileAndToken(userAccessToken: string): Promise<{ tokens: SnsTokenSet; profile: Record<string, unknown> }> {
  const pages = await discoverMetaPages(userAccessToken);
  const withIg = pages.find((p) => p.igBusinessId);
  if (!withIg || !withIg.igBusinessId) {
    throw new Error(
      "連携できるInstagramアカウントが見つかりませんでした。先にInstagramの設定（プロアカウント）からFacebookページに連携してから、もう一度お試しください"
    );
  }

  const profile = await fetchInstagramProfile(withIg.pageAccessToken, withIg.igBusinessId);

  return {
    tokens: {
      accessToken: withIg.pageAccessToken,
      refreshToken: null,
      expiresAt: null,
    },
    profile: {
      username: profile?.username ?? withIg.igUsername,
      followers: profile?.followersCount ?? null,
      mediaCount: profile?.mediaCount ?? null,
      pageId: withIg.pageId,
      pageName: withIg.pageName,
      igBusinessId: withIg.igBusinessId,
    },
  };
}
