import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

/**
 * 広告アカウントのトークンを DB に置くときの暗号化（AES-256-GCM）。
 *
 * AD_TOKEN_ENC_KEY（base64 で 32 バイト。`openssl rand -base64 32`）を設定すると有効になる。
 * 未設定なら平文のまま保存する（既存の google_connections と同じ扱い）。
 * 鍵を後から設定しても、平文で入っている行はそのまま読める。
 */

const PREFIX = "enc:v1:";

function key(): Buffer | null {
  const k = process.env.AD_TOKEN_ENC_KEY;
  if (!k) return null;
  const b = Buffer.from(k, "base64");
  if (b.length !== 32) throw new Error("AD_TOKEN_ENC_KEY は base64 で 32 バイトの鍵にしてください");
  return b;
}

export function sealToken(value: string | null | undefined): string | null {
  if (!value) return null;
  const k = key();
  if (!k) return value;
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", k, iv);
  const enc = Buffer.concat([c.update(value, "utf8"), c.final()]);
  return PREFIX + Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64");
}

export function openToken(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith(PREFIX)) return value;
  const k = key();
  if (!k) throw new Error("暗号化されたトークンを読むには AD_TOKEN_ENC_KEY が要ります");
  const raw = Buffer.from(value.slice(PREFIX.length), "base64");
  const d = createDecipheriv("aes-256-gcm", k, raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
}
