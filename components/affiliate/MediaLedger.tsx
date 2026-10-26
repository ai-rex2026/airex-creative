import Link from "next/link";
import type { createClient } from "@/lib/supabase/server";
import { AspMaster } from "@/components/affiliate/AspMaster";

/** メディア台帳（案件ページのタブ）。メディアはドメイン単位で全案件に共通 */
export async function MediaLedger({ sb, campaignId }: { sb: Awaited<ReturnType<typeof createClient>>; campaignId: string }) {
  const [{ data: media }, { data: asps }, { data: entries }] = await Promise.all([
    sb.from("aff_media").select("id, domain, name, asp_type, asp_name, no_solicitation").order("created_at", { ascending: false }).limit(500),
    sb.from("aff_asp_master").select("id, domain, asp_name").order("domain"),
    sb.from("aff_entries").select("media_id").not("media_id", "is", null),
  ]);
  const cnt = new Map<string, number>();
  for (const e of entries ?? []) cnt.set(e.media_id as string, (cnt.get(e.media_id as string) ?? 0) + 1);

  return (
    <>
      <p style={{ fontSize: 13, color: "var(--muted)" }}>収集で見つかったメディアをドメイン単位でまとめています（全案件で共通です）。営業お断りの印を付けると、そのメディアは候補から外れます。</p>
      <div className="rows" style={{ marginTop: 16 }}>
        <div className="rh">メディア（{media?.length ?? 0}件）</div>
        {(media ?? []).map((m) => (
          <div className="r" key={m.id as string}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <b>{(m.name as string) || (m.domain as string)}</b>
              <small>{m.domain as string} ／ 記事 {cnt.get(m.id as string) ?? 0}件 ／ {m.asp_type === "asp" ? `ASP: ${m.asp_name}` : m.asp_type === "direct" ? "直接取引" : "ASP不明"}{m.no_solicitation ? " ／ 営業お断り" : ""}</small>
            </div>
            <Link className="btn ghost sm" href={`/affiliate/media/${m.id}?c=${campaignId}`}>開く</Link>
          </div>
        ))}
        {(media ?? []).length === 0 && <div className="r"><small>まだメディアがありません。案件で収集すると自動で登録されます。</small></div>}
      </div>
      <AspMaster rows={(asps ?? []) as { id: string; domain: string; asp_name: string }[]} />
    </>
  );
}
