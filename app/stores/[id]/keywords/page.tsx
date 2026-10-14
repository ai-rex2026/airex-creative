import { keywordDataAction } from "@/app/meo-actions";
import { KeywordRanks } from "@/components/meo/KeywordRanks";

/**
 * キーワード順位の定点観測。どのキーワードで今何位か・先月から動いたか・上位の店とのギャップ。
 * データはこのページで読む（他のタブの読み込みを重くしない）。表示と操作は KeywordRanks（client）。
 */
export default async function MeoKeywordsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await keywordDataAction(id);
  return <KeywordRanks storeId={id} data={data} />;
}
