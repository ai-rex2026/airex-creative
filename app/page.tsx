import { Home } from "@/components/Home";

// startAnalysis の after() で分析を走らせるため、実行時間を確保する
export const maxDuration = 300;

export default function Page() {
  return <Home />;
}
