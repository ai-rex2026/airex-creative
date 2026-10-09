import type { GbpReview } from "./api";

/** meo_reviews の既存行（突き合わせに要る列だけ） */
export type StoredReview = {
  id: string;
  reply: string | null;
  reply_status: string;
  replied_at: string | null;
  error_message: string | null;
};

/**
 * Google から取れたクチコミを、保存済みの行に重ねる列だけ作る（純粋関数）。
 *
 * 守ること：
 * - アプリ側で送信待ち（pending）・送信失敗（failed）の返信は、Google 側に返信が無くても消さない
 *   （人が承認して送信待ちにした文面を、同期で握りつぶさない）
 * - Google に返信がある → replied
 * - 返信済みのあとにクチコミ本文が書き換えられた → needs_update
 * - AI の評価点（aio_score）など Google に無い列は触らない（この関数は返さない）
 */
export function mergeReview(storeId: string, incoming: GbpReview, existing: StoredReview | undefined) {
  const base = {
    store_id: storeId,
    id: incoming.reviewId,
    gbp_name: incoming.name || null,
    author_name: incoming.authorName,
    rating: incoming.rating,
    text: incoming.text,
    reviewed_at: incoming.createdAt,
    review_updated_at: incoming.updatedAt,
    updated_at: new Date().toISOString(),
  };

  const local = existing && (existing.reply_status === "pending" || existing.reply_status === "failed");
  if (local) return base;

  if (incoming.reply) {
    const edited =
      existing?.replied_at != null && Date.parse(incoming.updatedAt) > Date.parse(existing.replied_at) + 60_000 && incoming.updatedAt !== incoming.createdAt;
    // 返信（Google 側の最新）を保存。返信済み後に本文が書き換わっていたら、返信の見直しを促す
    const needsUpdate = existing?.reply_status === "needs_update" || (existing?.reply_status === "replied" && edited);
    return {
      ...base,
      reply: incoming.reply,
      replied_at: incoming.repliedAt,
      reply_status: needsUpdate ? "needs_update" : "replied",
      error_message: null,
    };
  }
  // Google に返信が無い。以前返信済みだったが Google 側で消された場合は未返信に戻す
  if (existing && (existing.reply_status === "replied" || existing.reply_status === "needs_update")) {
    return { ...base, reply: null, replied_at: null, reply_status: "unreplied", error_message: null };
  }
  return existing ? base : { ...base, reply: null, reply_status: "unreplied" };
}

type Db = {
  from: (t: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

/**
 * Google から取れたクチコミを保存する。取得は呼び出し側で済んでいる（有料ではないが回数上限がある API を
 * ここでは呼ばない）。保存済みの行は id で突き合わせ、行ごとの列は mergeReview が決める。
 * 失敗した行があっても、ほかの行は保存する（1行の失敗で全件を捨てない）。
 */
export async function saveReviews(db: Db, storeId: string, reviews: GbpReview[]): Promise<{ saved: number; failed: number }> {
  if (!reviews.length) return { saved: 0, failed: 0 };
  const ids = reviews.map((r) => r.reviewId);
  const { data } = await db
    .from("meo_reviews")
    .select("id, reply, reply_status, replied_at, error_message")
    .eq("store_id", storeId)
    .in("id", ids);
  const byId = new Map<string, StoredReview>(((data ?? []) as StoredReview[]).map((r) => [r.id, r]));

  let saved = 0;
  let failed = 0;
  for (const r of reviews) {
    const row = mergeReview(storeId, r, byId.get(r.reviewId));
    const { error } = await db.from("meo_reviews").upsert(row, { onConflict: "store_id,id" });
    if (error) failed++;
    else saved++;
  }
  return { saved, failed };
}
