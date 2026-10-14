import { apiUrl, decodeEntities, fetchHtml, publicFetch } from "./net";
import { wpApiRootFromHtml } from "./style";

/**
 * WordPress の REST API（アプリケーションパスワードの Basic 認証）。
 * 公開は人が承認ボタンを押したときだけ呼ぶ（AGENTS.md：自動入稿はしない）。
 * 認証つきの呼び出しはリダイレクトを追わない（資格情報を別の場所へ送らない）。
 */

export type WpConn = { apiRoot: string; user: string; appPassword: string };

export class WpError extends Error {}

/** サイトURL → REST の入口（https://example.com/wp-json/）。見つからなければ WordPress ではない */
export async function discoverWpApi(siteUrl: string): Promise<{ apiRoot: string; name: string }> {
  const tryRoot = async (root: string) => {
    const res = await publicFetch(root, { headers: { accept: "application/json" }, httpsOnly: true, timeoutMs: 15_000 });
    if (!res.ok) return null;
    const j = (await res.json().catch(() => null)) as { name?: string; namespaces?: string[] } | null;
    if (!j || !Array.isArray(j.namespaces) || !j.namespaces.includes("wp/v2")) return null;
    return { apiRoot: root, name: decodeEntities(String(j.name ?? "")) };
  };
  let html = "";
  let finalUrl = siteUrl;
  try {
    const r = await fetchHtml(siteUrl, { browserUa: true });
    html = r.html;
    finalUrl = r.finalUrl;
  } catch {
    /* /wp-json/ を直接試す */
  }
  const fromHtml = html ? wpApiRootFromHtml(html) : null;
  const candidates = [fromHtml, `${new URL(finalUrl).origin}/wp-json/`].filter((x): x is string => !!x).map((r) => (r.endsWith("/") || r.includes("rest_route=") ? r : `${r}/`));
  for (const c of [...new Set(candidates)]) {
    try {
      if (!c.startsWith("https://")) continue;
      const hit = await tryRoot(c);
      if (hit) return hit;
    } catch {
      /* 次の候補 */
    }
  }
  throw new WpError("WordPress の REST API が見つかりませんでした。WordPress のサイトの URL（https://）か確認してください。REST API を止めるプラグインが入っていると連携できません");
}

function auth(c: WpConn) {
  return `Basic ${Buffer.from(`${c.user}:${c.appPassword.replace(/\s+/g, "")}`).toString("base64")}`;
}

async function wp<T>(c: WpConn, path: string, init: { method?: string; json?: unknown; body?: BodyInit; headers?: Record<string, string> } = {}): Promise<T> {
  const url = apiUrl(c.apiRoot, path);
  let res: Response;
  try {
    res = await publicFetch(url, {
      method: init.method ?? "GET",
      httpsOnly: true,
      maxRedirects: 0,
      timeoutMs: 60_000,
      headers: {
        authorization: auth(c),
        accept: "application/json",
        ...(init.json !== undefined ? { "content-type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
      body: init.json !== undefined ? JSON.stringify(init.json) : (init.body ?? null),
    });
  } catch (e) {
    throw new WpError(`WordPress に接続できませんでした：${e instanceof Error ? e.message : String(e)}`);
  }
  const text = await res.text();
  let j: unknown = null;
  try {
    j = JSON.parse(text);
  } catch {
    /* HTML のエラーページなど */
  }
  if (!res.ok) {
    const code = (j as { code?: string } | null)?.code ?? "";
    const msg = (j as { message?: string } | null)?.message ?? text.slice(0, 160);
    if (res.status === 401 || code === "rest_not_logged_in" || code === "incorrect_password" || code === "invalid_username")
      throw new WpError("WordPress にログインできませんでした。ユーザー名とアプリケーションパスワードを確かめてください（サーバーによっては認証の情報が届かない設定があります。その場合はサーバー会社の「Authorization ヘッダー」の設定を確認してください）");
    if (res.status === 403) throw new WpError(`このユーザーには権限がありません（${msg}）。投稿・メディアのアップロードができる権限（編集者以上）のユーザーで連携してください`);
    throw new WpError(`WordPress がエラーを返しました（${res.status} ${code}）：${decodeEntities(String(msg)).slice(0, 200)}`);
  }
  if (j === null) throw new WpError("WordPress の応答を読めませんでした");
  return j as T;
}

export type WpMe = { name: string; canPublish: boolean; canUpload: boolean };

export async function wpVerify(c: WpConn): Promise<{ me: WpMe; categories: { id: number; name: string; count: number }[] }> {
  const me = await wp<{ name?: string; capabilities?: Record<string, boolean> }>(c, "wp/v2/users/me?context=edit");
  const cats = await wp<{ id: number; name: string; count: number }[]>(c, "wp/v2/categories?per_page=100&_fields=id,name,count").catch(() => []);
  return {
    me: { name: String(me.name ?? ""), canPublish: !!me.capabilities?.publish_posts, canUpload: !!me.capabilities?.upload_files },
    categories: (Array.isArray(cats) ? cats : []).map((x) => ({ id: Number(x.id), name: decodeEntities(String(x.name)), count: Number(x.count ?? 0) })),
  };
}

export async function wpUploadImage(c: WpConn, img: { bytes: Buffer; mime: string }, filename: string, alt: string): Promise<{ id: number; url: string }> {
  const m = await wp<{ id: number; source_url: string }>(c, "wp/v2/media", {
    method: "POST",
    body: new Uint8Array(img.bytes),
    headers: { "content-type": img.mime, "content-disposition": `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, "-")}"` },
  });
  if (alt) await wp(c, `wp/v2/media/${m.id}`, { method: "POST", json: { alt_text: alt } }).catch(() => undefined);
  return { id: m.id, url: m.source_url };
}

export type WpPostInput = {
  title: string;
  content: string;
  excerpt: string;
  slug: string;
  status: "draft" | "publish";
  featuredMedia: number | null;
  categories: number[];
};

export async function wpSavePost(c: WpConn, postId: number | null, p: WpPostInput): Promise<{ id: number; link: string; status: string }> {
  const body: Record<string, unknown> = { title: p.title, content: p.content, excerpt: p.excerpt, status: p.status };
  if (p.slug) body.slug = p.slug;
  if (p.featuredMedia) body.featured_media = p.featuredMedia;
  if (p.categories.length) body.categories = p.categories;
  const r = await wp<{ id: number; link: string; status: string }>(c, postId ? `wp/v2/posts/${postId}` : "wp/v2/posts", { method: "POST", json: body });
  return { id: r.id, link: r.link, status: r.status };
}
