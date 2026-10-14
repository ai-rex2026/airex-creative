import type { AioArticle } from "./content-types";
import { mdToHtml } from "./md";
import type { WpConn, WpPostInput } from "./wordpress";

/**
 * 記事を WordPress へ送る（下書きとして送る／承認して公開する）。
 * 工程ごとにその場で保存する：画像1枚ごとに wp_media、投稿を作ったら wp_post_id。
 * やり直したときは、送り済みの画像は送らず、作り済みの投稿は新しく作らずに更新する（二重投稿をしない）。
 */

export type WpMedia = Record<string, { id: number; url: string }>;

export type PublishDeps = {
  download: (path: string) => Promise<{ bytes: Buffer; mime: string }>;
  upload: (c: WpConn, img: { bytes: Buffer; mime: string }, filename: string, alt: string) => Promise<{ id: number; url: string }>;
  savePost: (c: WpConn, postId: number | null, p: WpPostInput) => Promise<{ id: number; link: string; status: string }>;
};

export type PublishSave = {
  media: (m: WpMedia) => Promise<void>;
  post: (p: { wpPostId: number; link: string; status: string }) => Promise<void>;
};

export async function sendToWordPress(
  deps: PublishDeps,
  conn: WpConn,
  article: Pick<AioArticle, "id" | "title" | "slug" | "metaDescription" | "bodyMd" | "images" | "wpPostId">,
  media: WpMedia,
  opt: { status: "draft" | "publish"; categoryId: number | null },
  save: PublishSave
): Promise<{ wpPostId: number; link: string; status: string; media: WpMedia }> {
  const m: WpMedia = { ...media };
  const usable = article.images.filter((i) => i.path && !i.hasText);
  // 画像は1枚ずつ送って、その都度保存する（途中で止まっても、送った分は次回送らない）
  for (const img of usable) {
    if (m[img.key]) continue;
    const file = await deps.download(img.path!);
    const ext = file.mime.includes("jpeg") ? "jpg" : file.mime.includes("webp") ? "webp" : "png";
    m[img.key] = await deps.upload(conn, file, `${article.slug || "article"}-${img.key}.${ext}`, img.alt);
    await save.media({ ...m });
  }
  const inline = article.images.filter((i) => i.role === "inline" && m[i.key]).map((i) => ({ afterH2: i.afterH2, src: m[i.key].url, alt: i.alt }));
  const content = mdToHtml(article.bodyMd, inline);
  const r = await deps.savePost(conn, article.wpPostId, {
    title: article.title,
    content,
    excerpt: article.metaDescription,
    slug: article.slug,
    status: opt.status,
    featuredMedia: m.eyecatch?.id ?? null,
    categories: opt.categoryId ? [opt.categoryId] : [],
  });
  await save.post({ wpPostId: r.id, link: r.link, status: r.status });
  return { wpPostId: r.id, link: r.link, status: r.status, media: m };
}
