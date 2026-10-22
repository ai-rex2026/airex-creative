import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Shell } from "@/components/Shell";
import { buildBoardData, loadCampaignBrief } from "@/lib/affiliate/board";
import { loadCampaignCost } from "@/lib/affiliate/cost";
import { fmtYen, USD_JPY } from "@/lib/affiliate/usage";
import { hasDataForSeo } from "@/lib/affiliate/dataforseo";
import { CollectPanel, type KwRow } from "@/components/affiliate/CollectPanel";
import { BoardView } from "@/components/affiliate/BoardView";
import { InfoForm } from "@/components/affiliate/InfoForm";
import { SuggestPanel, type SuggestRow } from "@/components/affiliate/SuggestPanel";

export const metadata = { title: "アフィリエイト運用｜AI-REX Studio" };
// 収集は1キーワードずつ Server Action で実行する（検索→AI判定。長引くことがある）
export const maxDuration = 300;

const TABS = [
  ["collect", "収集"],
  ["board", "陣取りボード"],
  ["info", "案件情報"],
  ["cost", "AIコスト"],
] as const;

export default async function CampaignPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const { tab: t } = await searchParams;
  const tab = TABS.some(([k]) => k === t) ? (t as string) : "collect";

  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect(`/login?callbackUrl=%2Faffiliate%2F${id}`);
  if (user.is_anonymous) redirect(`/login?mode=signup&callbackUrl=%2Faffiliate%2F${id}`);

  const brief = await loadCampaignBrief(sb, id);
  if (!brief) notFound();

  let body: React.ReactNode = null;
  if (tab === "collect") {
    const [{ data: kws }, { data: jobs }, { data: sugg }, { data: snaps }] = await Promise.all([
      sb.from("aff_keywords").select("id, keyword, priority, search_volume, volume_updated_at").eq("campaign_id", id).order("created_at"),
      sb.from("aff_jobs").select("keyword_id, status, found_count, ranking_count, paid_count, error_detail, snapshot_id, created_at").eq("campaign_id", id).order("created_at", { ascending: false }),
      sb.from("aff_kw_suggestions").select("id, keyword, search_volume, source, reason").eq("campaign_id", id).eq("status", "suggested").order("search_volume", { ascending: false, nullsFirst: false }),
      sb.from("aff_snapshots").select("keyword_id, collected_at, source").order("collected_at", { ascending: false }),
    ]);
    const latestJob = new Map<string, { status: string; found_count: number; ranking_count: number; paid_count: number; error_detail: string; snapshot_id: string | null }>();
    for (const j of jobs ?? []) if (!latestJob.has(j.keyword_id as string)) latestJob.set(j.keyword_id as string, j as never);
    const latestSnap = new Map<string, { collected_at: string; source: string }>();
    for (const s of snaps ?? []) if (!latestSnap.has(s.keyword_id as string)) latestSnap.set(s.keyword_id as string, s as never);
    const rows: KwRow[] = (kws ?? []).map((k) => {
      const j = latestJob.get(k.id as string);
      const s = latestSnap.get(k.id as string);
      return {
        id: k.id as string,
        keyword: k.keyword as string,
        priority: Number(k.priority ?? 3),
        volume: (k.search_volume as number | null) ?? null,
        status: j?.status ?? "none",
        found: j?.found_count ?? 0,
        ranking: j?.ranking_count ?? 0,
        paid: j?.paid_count ?? 0,
        error: j?.error_detail ?? "",
        snapshotId: j?.snapshot_id ?? null,
        collectedAt: s?.collected_at ?? null,
        source: s?.source ?? "",
      };
    });
    body = (
      <>
        <CollectPanel campaignId={id} rows={rows} />
        <SuggestPanel campaignId={id} rows={(sugg ?? []) as SuggestRow[]} canVolume={hasDataForSeo()} />
      </>
    );
  } else if (tab === "board") {
    const board = await buildBoardData(sb, id);
    body = <BoardView campaignId={id} grouped={board.grouped} keywords={board.keywords} />;
  } else if (tab === "info") {
    body = <InfoForm id={id} brief={brief} />;
  } else {
    const cost = await loadCampaignCost(sb, id);
    body = (
      <div className="panel">
        <h2>AI・検索APIの利用料（この案件）</h2>
        <p style={{ fontSize: 22, margin: "10px 0" }}>{fmtYen(cost.totalUsd)}<span style={{ fontSize: 12.5, color: "var(--muted)" }}>　（${cost.totalUsd.toFixed(2)}／{cost.calls}回／1ドル={USD_JPY}円で換算）</span></p>
        <div className="rows">
          <div className="rh">内訳</div>
          {cost.byKind.map((k) => (
            <div className="r" key={k.kind}>
              <div style={{ flex: 1 }}><b>{k.label}</b><small>{k.calls}回 ／ 入力 {k.inputTokens.toLocaleString()} tok ／ 出力 {k.outputTokens.toLocaleString()} tok{k.webSearches ? ` ／ Web検索 ${k.webSearches}回` : ""}</small></div>
              <span>{fmtYen(k.costUsd)}</span>
            </div>
          ))}
          {cost.byKind.length === 0 && <div className="r"><small>まだ利用がありません</small></div>}
        </div>
        {cost.byKeyword.length > 0 && (
          <div className="rows" style={{ marginTop: 16 }}>
            <div className="rh">キーワード別（上位10）</div>
            {cost.byKeyword.map((k) => (
              <div className="r" key={k.keyword}><div style={{ flex: 1 }}><b>{k.keyword}</b><small>{k.calls}回</small></div><span>{fmtYen(k.costUsd)}</span></div>
            ))}
          </div>
        )}
        <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 12 }}>DataForSEO（検索順位・検索ボリューム）の料金はこの表に含まれません。DataForSEO の管理画面でご確認ください。</p>
      </div>
    );
  }

  return (
    <Shell active="affiliate">
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <p style={{ fontSize: 12.5 }}><Link href="/affiliate">← 案件一覧</Link></p>
        <h2 style={{ fontSize: 20, marginTop: 6 }}>{brief.name}</h2>
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>{[brief.clientName, brief.productName, brief.summaryText].filter(Boolean).join(" ／ ")}</p>
        <div style={{ display: "flex", gap: 6, margin: "16px 0", flexWrap: "wrap" }}>
          {TABS.map(([k, label]) => (
            <Link key={k} href={`/affiliate/${id}?tab=${k}`} className={`btn sm${tab === k ? "" : " ghost"}`}>{label}</Link>
          ))}
        </div>
        {body}
      </div>
    </Shell>
  );
}
