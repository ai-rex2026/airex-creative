import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Logo, SiteFooter } from "@/components/Chrome";
import { Report } from "@/components/Report";
import { SignUpBanner } from "@/components/SignUpBanner";
import type { Analysis } from "@/lib/analysis";

export const metadata = { title: "レポート｜AI-REX Studio" };

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect(`/login?callbackUrl=${encodeURIComponent(`/analysis/${id}/report`)}`);

  const { data } = await sb.from("analyses").select("*").eq("id", id).single();
  if (!data) notFound();
  const a = data as Analysis;
  if (a.status !== "done") redirect(`/analysis/${id}`);
  if (!a.diagnosis || !a.copies) notFound();

  return (
    <>
      <header className="site-header">
        <div className="wrap">
          <Logo suffix="Studio" />
          <nav>
            <Link href="/">新しく分析する</Link>
            <Link href="/contact">お問い合わせ</Link>
          </nav>
        </div>
      </header>
      <main className="grow">
        {user.is_anonymous && <SignUpBanner />}
        <Report d={a.diagnosis} copies={a.copies} />
      </main>
      <SiteFooter />
    </>
  );
}
