import { Shell } from "@/components/Shell";
import { NewAnalysisForm } from "@/components/NewAnalysisForm";
import { AdAccountPicker } from "@/components/AdAccountPicker";
import { AdPerformance } from "@/components/AdPerformance";
import { YahooAccountPicker } from "@/components/YahooAccountPicker";
import { YahooPerformance } from "@/components/YahooPerformance";
import { adConnections } from "@/app/ad-actions";

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
  return (
    <Shell active="new">
      <NewAnalysisForm initialUrl={url ?? ""} />
      {ads.some((c) => c.platform === "google") && (
        <>
          <AdAccountPicker />
          <AdPerformance />
        </>
      )}
      {ads.some((c) => c.platform === "yahoo") && (
        <>
          <YahooAccountPicker />
          <YahooPerformance />
        </>
      )}
    </Shell>
  );
}
