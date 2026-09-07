import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Home } from "@/components/Home";

// startAnalysis の after() で分析を走らせるため、実行時間を確保する
export const maxDuration = 300;

export default async function Page() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();

  // ログイン済みの人にトップの「ログイン」ボタンを見せると、
  // ログインに失敗したように見える。一覧へ送る
  if (user && !user.is_anonymous) redirect("/analysis");

  return <Home />;
}
