import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Shell } from "@/components/Shell";
import { MediaEditor } from "@/components/affiliate/MediaEditor";

export const metadata = { title: "メディア｜アフィリエイト運用" };

export default async function MediaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect(`/login?callbackUrl=%2Faffiliate%2Fmedia%2F${id}`);
  if (user.is_anonymous) redirect(`/login?mode=signup&callbackUrl=%2Faffiliate%2Fmedia%2F${id}`);

  const { data: m } = await sb.from("aff_media").select("*").eq("id", id).maybeSingle();
  if (!m) notFound();
  const [{ data: others }, { data: ents }] = await Promise.all([
    sb.from("aff_media").select("id, domain, name").neq("id", id).order("domain").limit(500),
    sb.from("aff_entries").select("id, article_url, article_title, rank, result_type, own_listed").eq("media_id", id).order("created_at", { ascending: false }).limit(30),
  ]);

  return (
    <Shell active="affiliate" sub="media">
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        <p style={{ fontSize: 12.5 }}><Link href="/affiliate/media">← メディア台帳</Link></p>
        <h2 style={{ fontSize: 20, marginTop: 6 }}>{(m.name as string) || (m.domain as string)}</h2>
        <p style={{ fontSize: 13, color: "var(--muted)" }}>{m.domain as string}</p>
        <MediaEditor
          media={{ id: m.id as string, name: (m.name as string) ?? "", operator: (m.operator as string) ?? "", category: (m.category as string) ?? "", aspType: (m.asp_type as string) ?? "unknown", aspName: (m.asp_name as string) ?? "", note: (m.note as string) ?? "", noSolicitation: !!m.no_solicitation, reason: (m.no_solicitation_reason as string) ?? "" }}
          others={(others ?? []).map((o) => ({ id: o.id as string, label: `${(o.name as string) || (o.domain as string)}（${o.domain}）` }))}
        />
        <div className="rows" style={{ marginTop: 20 }}>
          <div className="rh">このメディアの記事（直近30件）</div>
          {(ents ?? []).map((e) => (
            <div className="r" key={e.id as string}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <b>{(e.article_title as string) || (e.article_url as string)}</b>
                <small><a href={e.article_url as string} target="_blank" rel="noreferrer">{e.article_url as string}</a> ／ {e.result_type === "paid" ? "広告" : "オーガニック"} {e.rank ?? ""}位{e.own_listed ? " ／ 自社掲載あり" : ""}</small>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Shell>
  );
}
