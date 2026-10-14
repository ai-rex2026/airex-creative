"use client";

import { Upload } from "tus-js-client";
import { createClient } from "@/lib/supabase/client";

/**
 * 大きなファイル（書き出した動画・素材の動画）を Storage に送る。
 * 署名つきのアップロード（x-signature）で、6MB ずつ再開できる方式（TUS）。小さいファイルは通常の方式でも送れる。
 */
export async function uploadLarge(file: Blob, p: { endpoint?: string; bucket: string; path: string; token: string }, onProgress?: (r: number) => void): Promise<void> {
  const sb = createClient();
  const {
    data: { session },
  } = await sb.auth.getSession();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
  const endpoint = p.endpoint ?? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/upload/resumable`;

  const viaTus = () =>
    new Promise<void>((ok, ng) => {
      const up = new Upload(file, {
        endpoint,
        retryDelays: [0, 2000, 5000, 10000],
        headers: { authorization: `Bearer ${session?.access_token ?? anon}`, apikey: anon, "x-signature": p.token, "x-upsert": "true" },
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        metadata: { bucketName: p.bucket, objectName: p.path, contentType: file.type || "application/octet-stream", cacheControl: "3600" },
        chunkSize: 6 * 1024 * 1024,
        onProgress: (sent, total) => onProgress?.(total ? sent / total : 0),
        onError: (e) => ng(e),
        onSuccess: () => ok(),
      });
      up.start();
    });

  try {
    await viaTus();
  } catch (e) {
    // 再開できる方式が使えない環境では、小さいファイルだけ通常の方式で送る
    if (file.size > 45 * 1024 * 1024) throw new Error(`アップロードできませんでした：${e instanceof Error ? e.message : String(e)}`);
    const { error } = await sb.storage.from(p.bucket).uploadToSignedUrl(p.path, p.token, file, { contentType: file.type, upsert: true });
    if (error) throw new Error(`アップロードできませんでした：${error.message}`);
    onProgress?.(1);
  }
}
