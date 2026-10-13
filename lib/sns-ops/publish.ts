import type { SnsPlatform } from "../social-connect/platforms";
import { getSnsCredentials } from "../social-connect/tokens";

export { composeBody } from "./types";

/**
 * 公式SNSへの投稿（人が確認して「投稿する」を押したときだけ呼ぶ。自動では呼ばない）。
 *
 * - X … API v2 POST /2/tweets。連携時のスコープに tweet.write が要る
 * - Instagram … Content Publishing API は画像/動画が必須で、画像の保管と審査（instagram_content_publish）が
 *   別途要るため、この版では API 投稿しない（文面をコピーしてアプリから投稿する）
 * - TikTok … Content Posting API は動画が必須で、アプリ審査（video.publish）が要るため同上
 */

/** 連携時のスコープから、API で投稿できるかを判定する */
export function canPublishViaApi(platform: SnsPlatform, scope: string | null): { ok: boolean; note: string | null } {
  if (platform === "x") {
    const ok = (scope ?? "").split(/[\s,]+/).includes("tweet.write");
    return ok ? { ok: true, note: null } : { ok: false, note: "投稿の権限（tweet.write）が無い連携です。設定から X を再連携すると、ここから直接投稿できます" };
  }
  if (platform === "meta") return { ok: false, note: "Instagram は画像つき投稿が前提のため、文面をコピーして Instagram アプリから投稿してください" };
  return { ok: false, note: "TikTok は動画が前提のため、説明文をコピーして TikTok アプリから投稿してください" };
}

/** X に投稿する。戻り値は tweet id */
export async function publishToX(userId: string, text: string): Promise<string> {
  const cred = await getSnsCredentials(userId, "x");
  if (!cred) throw new Error("X が連携されていません。設定から連携してください");
  const res = await fetch("https://api.twitter.com/2/tweets", {
    method: "POST",
    headers: { authorization: `Bearer ${cred.accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(20_000),
  });
  const j = (await res.json().catch(() => ({}))) as { data?: { id?: string }; detail?: string; title?: string; errors?: { message?: string }[] };
  if (!res.ok || !j.data?.id) {
    const why = j.errors?.[0]?.message ?? j.detail ?? j.title ?? `HTTP ${res.status}`;
    if (res.status === 403) throw new Error(`X への投稿が拒否されました（${why}）。設定から X を再連携して投稿の権限を付けてください`);
    throw new Error(`X への投稿に失敗しました：${why}`);
  }
  return j.data.id;
}
