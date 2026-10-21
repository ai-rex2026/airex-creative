import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Shell } from "@/components/Shell";
import { AioProjectForm } from "@/components/aio/AioProjectForm";

export const metadata = { title: "対象を登録｜SEO運用｜AI-REX Studio" };

// URL からの候補出し（サイト取得＋AI）を Server Action で行うので、実行時間を確保する
export const maxDuration = 120;

export default async function SeoNewPage() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login?callbackUrl=%2Fseo%2Fnew");
  if (user.is_anonymous) redirect("/login?mode=signup&callbackUrl=%2Fseo%2Fnew");

  return (
    <Shell active="seo">
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <h2 style={{ fontSize: 20 }}>対象を登録</h2>
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 6 }}>URL を入れて「AIに考えさせる」を押すと、事業者名と見込み客の探し方の候補が入ります。直してから登録してください（AIO と共通の対象になります）。</p>
        <div style={{ marginTop: 20 }}>
          <AioProjectForm mode="create" basePath="/seo" />
        </div>
      </div>
    </Shell>
  );
}
