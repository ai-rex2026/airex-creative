/**
 * TikTok Content Posting API（Direct Post・ファイルのアップロード）。
 * 監査（audit）前のアプリは「自分だけ（SELF_ONLY）」でしか投稿できない。公開範囲は人が選ぶ（TikTok の決まり）。
 */

const T = "https://open.tiktokapis.com/v2";
type Fetch = typeof fetch;

async function call<T>(f: Fetch, token: string, path: string, body: unknown): Promise<T> {
  const res = await f(`${T}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=UTF-8" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const j = (await res.json().catch(() => ({}))) as { data?: T; error?: { code?: string; message?: string } };
  if (!res.ok || (j.error && j.error.code !== "ok")) {
    const code = j.error?.code ?? "";
    if (code === "unaudited_client_can_only_post_to_private_accounts") throw new Error("TikTok の監査前のアプリは、非公開のアカウントにしか投稿できません");
    if (code === "spam_risk_too_many_posts" || code === "spam_risk_user_banned_from_posting") throw new Error("TikTok の投稿の回数制限に達しました。時間をおいてください");
    throw new Error(`TikTok API がエラーを返しました：${j.error?.message ?? code ?? `HTTP ${res.status}`}`);
  }
  return j.data as T;
}

export type CreatorInfo = { nickname: string; privacyOptions: string[]; maxDurationSec: number; commentDisabled: boolean; duetDisabled: boolean; stitchDisabled: boolean };

export async function tiktokCreatorInfo(token: string, f: Fetch = fetch): Promise<CreatorInfo> {
  const d = await call<{ creator_nickname?: string; privacy_level_options?: string[]; max_video_post_duration_sec?: number; comment_disabled?: boolean; duet_disabled?: boolean; stitch_disabled?: boolean }>(f, token, "/post/publish/creator_info/query/", {});
  return {
    nickname: d.creator_nickname ?? "",
    privacyOptions: d.privacy_level_options ?? ["SELF_ONLY"],
    maxDurationSec: d.max_video_post_duration_sec ?? 60,
    commentDisabled: !!d.comment_disabled,
    duetDisabled: !!d.duet_disabled,
    stitchDisabled: !!d.stitch_disabled,
  };
}

/** 分割の決まり：1つ5〜64MB、最後だけ128MBまで。5MB 未満は1つで送る */
export function chunkPlan(size: number): { chunkSize: number; count: number } {
  const MB = 1024 * 1024;
  if (size <= 64 * MB) return { chunkSize: size, count: 1 };
  const chunkSize = 10 * MB;
  return { chunkSize, count: Math.floor(size / chunkSize) };
}

export async function tiktokInit(token: string, p: { title: string; privacy: string; size: number; disableComment?: boolean }, f: Fetch = fetch): Promise<{ publishId: string; uploadUrl: string }> {
  const { chunkSize, count } = chunkPlan(p.size);
  const d = await call<{ publish_id: string; upload_url: string }>(f, token, "/post/publish/video/init/", {
    post_info: { title: p.title.slice(0, 2200), privacy_level: p.privacy, disable_comment: !!p.disableComment, disable_duet: false, disable_stitch: false, is_aigc: true },
    source_info: { source: "FILE_UPLOAD", video_size: p.size, chunk_size: chunkSize, total_chunk_count: count },
  });
  return { publishId: d.publish_id, uploadUrl: d.upload_url };
}

export async function tiktokUpload(uploadUrl: string, bytes: Buffer, f: Fetch = fetch): Promise<void> {
  const { chunkSize, count } = chunkPlan(bytes.length);
  for (let i = 0; i < count; i++) {
    const start = i * chunkSize;
    const end = i === count - 1 ? bytes.length : start + chunkSize;
    const res = await f(uploadUrl, {
      method: "PUT",
      headers: { "content-type": "video/mp4", "content-range": `bytes ${start}-${end - 1}/${bytes.length}`, "content-length": String(end - start) },
      body: new Uint8Array(bytes.subarray(start, end)),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok && res.status !== 206) throw new Error(`TikTok へ動画を送れませんでした（HTTP ${res.status}）`);
  }
}

export async function tiktokStatus(token: string, publishId: string, f: Fetch = fetch): Promise<{ status: string; postId: string | null; reason: string | null }> {
  const d = await call<{ status?: string; publicaly_available_post_id?: (string | number)[]; fail_reason?: string }>(f, token, "/post/publish/status/fetch/", { publish_id: publishId });
  return { status: d.status ?? "PROCESSING_UPLOAD", postId: d.publicaly_available_post_id?.[0] ? String(d.publicaly_available_post_id[0]) : null, reason: d.fail_reason ?? null };
}
