import { citationDataAction } from "@/app/meo-actions";
import { CitationCheckView } from "@/components/meo/CitationCheck";

// web 検索つきの AI 問い合わせ＋照合を1回の Action で同期的に行うので、実行時間を確保する
export const maxDuration = 300;

/** 情報の一貫性チェック。公式サイト・各媒体の店名／住所／電話／営業時間が Google の情報とずれていないか */
export default async function MeoCitationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await citationDataAction(id);
  return <CitationCheckView storeId={id} checks={data.checks} remaining={data.remaining} limit={data.limit} />;
}
