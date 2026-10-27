import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { AIO_PROJECT_COLUMNS, rowToProject } from "@/lib/aio/store";
import { refreshNoteRefs, REFRESH_DAYS } from "@/lib/aio/note-refs";

export const maxDuration = 300;

/**
 * note の「参考にする人気記事」の定期調査（2026-10-27）。Vercel Cron から毎日 3:20 JST に叩かれ、
 * note の媒体を設定している対象のうち、前回から7日たったものだけテーマ決め・検索をし、まだ読んでいない記事を読む。
 * 締め切りで途中までになっても、検索済みの URL は pending で残り、次の日に続きから読む（検索はやり直さない）
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  const deadline = Date.now() + 260_000;
  const out: Record<string, unknown> = {};
  const stale = new Date(Date.now() - REFRESH_DAYS * 864e5).toISOString();
  // 期限切れ（または未調査）の note の媒体と、読みかけの記事がある対象
  const [{ data: chs }, { data: pend }] = await Promise.all([
    admin.from("aio_channels").select("project_id").eq("kind", "note").or(`note_refs_at.is.null,note_refs_at.lt.${stale}`).limit(20),
    admin.from("aio_note_refs").select("project_id").eq("status", "pending").limit(50),
  ]);
  const ids = [...new Set([...(chs ?? []), ...(pend ?? [])].map((r) => String(r.project_id)))];
  for (const id of ids) {
    if (Date.now() > deadline - 60_000) break;
    const { data: p } = await admin.from("aio_projects").select(AIO_PROJECT_COLUMNS).eq("id", id).maybeSingle();
    if (!p) continue;
    try {
      out[id] = await refreshNoteRefs(admin, rowToProject(p as Record<string, unknown>), { deadline });
    } catch (e) {
      out[id] = { error: e instanceof Error ? e.message : String(e) };
    }
  }
  return NextResponse.json({ ok: true, out });
}
