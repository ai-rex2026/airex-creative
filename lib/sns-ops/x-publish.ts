import { composeBody } from "./types";
import type { OpsPost } from "./ops-types";

/**
 * 承認した案を X に送る。工程ごとにその場で保存する：画像1枚ごとに media_ids、投稿1つごとに external_ids。
 * やり直したときは、送れた画像・投稿は送らず、続きから送る（スレッドの二重投稿をしない）。
 *
 * 他人の投稿へのリプライ・引用は、相手がこちらをメンション／こちらの投稿への返信のときだけ API で送る。
 * それ以外は NeedsHumanError を返し、画面で X の投稿画面（本文入り）を開いて人が送る。
 */

export class NeedsHumanError extends Error {}

export type XPublishDeps = {
  download: (path: string) => Promise<{ bytes: Buffer; mime: string }>;
  upload: (file: { bytes: Buffer; mime: string }) => Promise<string>;
  post: (p: { text: string; mediaIds?: string[]; replyTo?: string | null; quoteOf?: string | null }) => Promise<string>;
  repost: (tweetId: string) => Promise<void>;
  dm: (conversationId: string, text: string) => Promise<string>;
};

export type XPublishSave = {
  mediaIds: (m: Record<string, string>) => Promise<void>;
  externalIds: (ids: string[]) => Promise<void>;
};

export async function publishX(deps: XPublishDeps, post: Pick<OpsPost, "kind" | "body" | "thread" | "hashtags" | "media" | "target" | "externalIds">, mediaIds: Record<string, string>, save: XPublishSave): Promise<{ externalIds: string[] }> {
  const ids = [...post.externalIds];

  if (post.kind === "repost") {
    if (!post.target?.externalId) throw new Error("リポストする投稿がありません");
    if (!ids.length) {
      await deps.repost(post.target.externalId);
      ids.push(post.target.externalId);
      await save.externalIds(ids);
    }
    return { externalIds: ids };
  }

  if (post.kind === "dm") {
    if (!post.target?.conversationId) throw new Error("返信する DM の会話がありません");
    if (!ids.length) {
      ids.push(await deps.dm(post.target.conversationId, post.body));
      await save.externalIds(ids);
    }
    return { externalIds: ids };
  }

  if ((post.kind === "reply" || post.kind === "quote") && !post.target?.summoned) {
    throw new NeedsHumanError("この相手には X の規約で API から送れません。X の画面を開いて送ってください");
  }

  // 画像（文字入り・未生成は送らない）
  const m = { ...mediaIds };
  for (const img of post.media.filter((x) => x.path && !x.hasText).slice(0, 4)) {
    if (m[img.key]) continue;
    m[img.key] = await deps.upload(await deps.download(img.path!));
    await save.mediaIds({ ...m });
  }
  const mediaList = post.media.filter((x) => m[x.key]).map((x) => m[x.key]);

  // 1つめ（本文）
  const parts = [composeBody(post.body, post.hashtags), ...post.thread];
  for (let i = 0; i < parts.length; i++) {
    if (ids[i]) continue;
    const id = await deps.post({
      text: parts[i],
      mediaIds: i === 0 ? mediaList : undefined,
      replyTo: i === 0 ? (post.kind === "reply" ? (post.target?.externalId ?? null) : null) : ids[i - 1],
      quoteOf: i === 0 && post.kind === "quote" ? (post.target?.externalId ?? null) : null,
    });
    ids[i] = id;
    await save.externalIds([...ids]);
  }
  return { externalIds: ids };
}
