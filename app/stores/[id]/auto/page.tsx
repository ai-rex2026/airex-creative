import { autoLogAction, kitDataAction } from "@/app/meo-kit-actions";
import { AutoPanel } from "@/components/meo/kit/AutoPanel";

/** 自動で回す（口コミの返信文・週1の投稿）と、確認待ち・記録 */
export default async function MeoAutoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [kit, log] = await Promise.all([kitDataAction(id), autoLogAction(id)]);
  return <AutoPanel storeId={id} auto={kit.auto} gbpLinked={kit.gbpLinked} log={log} hasKit={!!kit.results.diagnose} />;
}
