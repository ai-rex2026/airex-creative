import { Shell } from "@/components/Shell";
import { NewAnalysisForm } from "@/components/NewAnalysisForm";
import { AdAccountPicker } from "@/components/AdAccountPicker";
import { YahooAccountPicker } from "@/components/YahooAccountPicker";
import { MicrosoftAccountPicker } from "@/components/MicrosoftAccountPicker";
import { MetaAccountPicker } from "@/components/MetaAccountPicker";
import { XAccountPicker } from "@/components/XAccountPicker";
import { TiktokAccountPicker } from "@/components/TiktokAccountPicker";
import { adConnections } from "@/app/ad-actions";
import { googleConnection } from "@/app/actions";

export const metadata = { title: "新規分析｜AI-REX Studio" };
// startAnalysis の after() で分析を走らせるため
export const maxDuration = 300;

export default async function NewAnalysisPage({
  searchParams,
}: {
  searchParams: Promise<{ url?: string }>;
}) {
  const { url } = await searchParams;
  const ads = await adConnections();
  const google = await googleConnection();
  return (
    <Shell active="new">
      <NewAnalysisForm initialUrl={url ?? ""} googleConnected={!!google} />
      {ads.some((c) => c.platform === "google") && <AdAccountPicker />}
      {ads.some((c) => c.platform === "yahoo") && <YahooAccountPicker />}
      {ads.some((c) => c.platform === "microsoft") && <MicrosoftAccountPicker />}
      {ads.some((c) => c.platform === "meta") && <MetaAccountPicker />}
      {ads.some((c) => c.platform === "x") && <XAccountPicker />}
      {ads.some((c) => c.platform === "tiktok") && <TiktokAccountPicker />}
    </Shell>
  );
}
