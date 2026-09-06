import { Shell } from "@/components/Shell";
import { NewAnalysisForm } from "@/components/NewAnalysisForm";

export const metadata = { title: "新規分析｜AI-REX Studio" };
// startAnalysis の after() で分析を走らせるため
export const maxDuration = 300;

export default async function NewAnalysisPage({
  searchParams,
}: {
  searchParams: Promise<{ url?: string }>;
}) {
  const { url } = await searchParams;
  return (
    <Shell active="new">
      <NewAnalysisForm initialUrl={url ?? ""} />
    </Shell>
  );
}
