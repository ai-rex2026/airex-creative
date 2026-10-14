import { kitDataAction } from "@/app/meo-kit-actions";
import { HomeOverview } from "@/components/meo/HomeOverview";
import { KitHome } from "@/components/meo/kit/KitHome";

/**
 * MEOワークスペースのトップ。
 * 上：オルコネレックスの作り（URL を入れるだけで「今の数字」と「やること」、貼るだけの文章が出る）
 * 下：Googleビジネスプロフィールの状況（今日の対応・指標・クチコミ）
 */
export default async function MeoHomePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const kit = await kitDataAction(id);
  return (
    <div className="space-y-12">
      <KitHome storeId={id} data={kit} />
      <HomeOverview />
    </div>
  );
}
