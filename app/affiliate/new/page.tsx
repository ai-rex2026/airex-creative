import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Shell } from "@/components/Shell";
import { NewCampaign } from "@/components/affiliate/NewCampaign";

export const metadata = { title: "案件を作る｜アフィリエイト運用" };
export const maxDuration = 120;

export default async function NewAffiliatePage() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login?callbackUrl=%2Faffiliate%2Fnew");
  if (user.is_anonymous) redirect("/login?mode=signup&callbackUrl=%2Faffiliate%2Fnew");
  return (
    <Shell active="affiliate">
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        <h2 style={{ fontSize: 20 }}>案件を作る</h2>
        <NewCampaign />
      </div>
    </Shell>
  );
}
