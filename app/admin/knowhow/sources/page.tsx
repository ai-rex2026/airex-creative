import Link from "next/link";
import { notFound } from "next/navigation";
import { Shell } from "@/components/Shell";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTier } from "@/lib/tier";
import { addKnowhowSourceAction, runKnowhowSourcesAction, toggleKnowhowSourceAction } from "@/app/knowhow-actions";

export const metadata = { title: "確認している公式ページ｜AI-REX Studio" };
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const AREA: Record<string, string> = { meo: "MEO", seo: "SEO", aio: "AIO", lpo: "LPO", image: "画像生成", legal: "法令", ads: "広告" };
const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) : "まだ";

type Row = {
  key: string;
  area: string;
  title: string;
  url: string;
  official: boolean;
  enabled: boolean;
  note: string;
  last_checked_at: string | null;
  last_changed_at: string | null;
  last_error: string;
  fail_count: number;
  last_hash: string | null;
};

/** 一次情報（公式ページ）の一覧。週1回取得し、前回から変わったときだけ更新案を作る（管理者だけ） */
export default async function KnowhowSources({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { tier } = await getTier();
  if (tier !== "admin") notFound();
  const sp = await searchParams;
  const { data } = await createAdminClient().from("knowhow_sources").select("*").order("created_at", { ascending: true }).limit(100);
  const rows = (data ?? []) as Row[];

  return (
    <Shell active="admin">
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <p style={{ fontSize: 12.5 }}>
          <Link href="/admin/knowhow" style={{ textDecoration: "underline" }}>← ノウハウ更新案</Link>
        </p>
        <h2 style={{ fontSize: 20, marginTop: 8 }}>確認している公式ページ</h2>
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 6, lineHeight: 1.9 }}>
          毎週月曜の早朝に、ここのページを取得します。前回から変わったときだけ、追加された部分から更新案を作り、受信箱（判断待ち）に入れます。自動では反映しません。初回は「基準」を保存するだけで、案は作りません。
        </p>
        {sp.err && <p style={{ marginTop: 12, fontSize: 13, color: "var(--ng)" }}>{sp.err}</p>}
        {sp.ran !== undefined && (
          <p className="tag ok" style={{ marginTop: 12 }}>
            確認しました：{sp.ran}件／変化あり {sp.changed}件／初回の基準 {sp.base}件／失敗 {sp.err_n}件／作成した案 {sp.created}件
          </p>
        )}
        {sp.done === "added" && <p className="tag ok" style={{ marginTop: 12 }}>追加しました</p>}

        <form action={runKnowhowSourcesAction} style={{ marginTop: 16 }}>
          <button className="btn sm" type="submit">今すぐ確認する</button>
          <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: 10 }}>AI を使うのは、変わったページだけです（1回6件まで）</span>
        </form>

        {rows.map((r) => (
          <section key={r.key} style={{ marginTop: 14, background: "#fff", border: "1px solid var(--line)", borderRadius: 6, padding: "16px 18px" }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <span className="tag score">{AREA[r.area] ?? r.area}</span>
              <span className={`tag ${r.official ? "ok" : "warn"}`}>{r.official ? "公式の一次情報" : "公式ではない"}</span>
              {!r.enabled && <span className="tag ng">停止中</span>}
            </div>
            <h3 style={{ fontSize: 15, marginTop: 8 }}>{r.title}</h3>
            <p style={{ fontSize: 12.5, marginTop: 4, wordBreak: "break-all" }}>
              <a href={r.url} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>{r.url}</a>
            </p>
            <p style={{ fontSize: 12, marginTop: 6, color: "var(--muted)", lineHeight: 1.8 }}>
              最終確認：{fmt(r.last_checked_at)}　／　最後に変化：{r.last_hash ? fmt(r.last_changed_at) : "まだ（初回の基準待ち）"}
            </p>
            {r.note && <p style={{ fontSize: 12, color: "var(--muted)" }}>{r.note}</p>}
            {r.last_error && <p style={{ fontSize: 12.5, marginTop: 4, color: "var(--ng)" }}>{r.last_error}（連続失敗 {r.fail_count}回）</p>}
            <form action={toggleKnowhowSourceAction} style={{ marginTop: 10 }}>
              <input type="hidden" name="key" value={r.key} />
              <input type="hidden" name="enabled" value={r.enabled ? "0" : "1"} />
              <button className="btn sm ghost" type="submit">{r.enabled ? "停止する" : "再開する"}</button>
            </form>
          </section>
        ))}

        <form action={addKnowhowSourceAction} style={{ marginTop: 22, display: "grid", gap: 10, background: "#fff", border: "1px solid var(--line)", borderRadius: 6, padding: "16px 18px" }}>
          <b style={{ fontSize: 14 }}>公式ページを追加</b>
          <input className="box" name="title" placeholder="名前（例：Google ビジネスプロフィール ヘルプ）" maxLength={80} required style={{ padding: "8px 10px" }} />
          <input className="box" name="url" placeholder="https://…（公開ページ）" required style={{ padding: "8px 10px" }} />
          <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
            <select className="box" name="area" defaultValue="meo" style={{ padding: "6px 8px" }}>
              {Object.entries(AREA).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <label>
              <input type="checkbox" name="official" defaultChecked /> 公式の一次情報
            </label>
            <button className="btn sm" type="submit">追加</button>
          </div>
        </form>
      </div>
    </Shell>
  );
}
