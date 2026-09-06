import { createClient as createSbClient } from "@supabase/supabase-js";

/**
 * ワーカー用のクライアント。RLS を通さずに他人の分析も進められるので、
 * サーバー側（cron・after）からのみ使う。ブラウザには絶対に出さない。
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY が未設定です");
  return createSbClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
