"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  gbpDisconnectAction,
  gbpListLocationsAction,
  gbpLinkLocationAction,
  gbpOverviewAction,
  gbpSyncReviewsAction,
  gbpUnlinkLocationAction,
  type GbpOverview,
} from "@/app/meo-actions";
import { Btn, ErrorNote } from "@/components/meo/ui";
import type { GbpLocation } from "@/lib/gbp/api";

const msg = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

/**
 * Googleビジネスプロフィールとの連携。
 * このリリースは読み取りだけ（店舗の紐付け・基本情報の表示・クチコミの取り込み・指標の表示）。
 * プロフィールの更新・投稿・返信の送信は、読み取りの動作確認後に別リリースで入れる。
 */
export function GbpLink({ analysisId, connected, linkedLocationName }: { analysisId: string; connected: boolean; linkedLocationName: string | null }) {
  const router = useRouter();
  const [overview, setOverview] = useState<GbpOverview | null>(null);
  const [locations, setLocations] = useState<GbpLocation[] | null>(null);
  const [listErrors, setListErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // 認可画面から戻ったときの結果（?gbp_ok / ?gbp_error）を一度だけ見せて、URLから消す
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.has("gbp_ok")) setNotice("Googleアカウントを連携しました。紐付ける店舗を選んでください。");
    const err = p.get("gbp_error");
    if (err) setError(err);
    if (p.has("gbp_ok") || err) {
      p.delete("gbp_ok");
      p.delete("gbp_error");
      const q = p.toString();
      window.history.replaceState(null, "", window.location.pathname + (q ? `?${q}` : ""));
    }
  }, []);

  const load = useCallback(async () => {
    try {
      setOverview(await gbpOverviewAction(analysisId));
    } catch (e) {
      setError(msg(e, "連携の状態を読み込めませんでした"));
    }
  }, [analysisId]);

  useEffect(() => {
    if (connected) void load();
  }, [connected, load]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setError(msg(e, "処理に失敗しました。時間をおいて再度お試しください"));
    } finally {
      setBusy(null);
    }
  };

  const startUrl = `/api/gbp/start?analysis=${encodeURIComponent(analysisId)}`;

  const loadLocations = () =>
    run("list", async () => {
      const r = await gbpListLocationsAction(analysisId);
      setLocations(r.locations);
      setListErrors(r.errors);
      if (!r.locations.length && !r.errors.length) setNotice("このGoogleアカウントで管理している店舗が見つかりませんでした。店舗の所有者・管理者のアカウントで連携し直してください。");
    });

  const link = (l: GbpLocation) =>
    run(`link:${l.name}`, async () => {
      const r = await gbpLinkLocationAction(analysisId, l.account, l.name);
      setLocations(null);
      setNotice(
        r.sync
          ? `「${l.title}」と紐付けました。クチコミを${r.sync.saved}件取り込みました。`
          : `「${l.title}」と紐付けました。ただしクチコミは取り込めませんでした：${r.syncError ?? ""}`
      );
      await load();
      router.refresh();
    });

  const sync = () =>
    run("sync", async () => {
      const r = await gbpSyncReviewsAction(analysisId);
      setNotice(`クチコミを${r.saved}件取り込みました${r.failed ? `（${r.failed}件は保存できませんでした）` : ""}。`);
      await load();
      router.refresh();
    });

  const unlink = () =>
    run("unlink", async () => {
      await gbpUnlinkLocationAction(analysisId);
      await load();
      router.refresh();
    });

  const disconnect = () =>
    run("disconnect", async () => {
      await gbpDisconnectAction(analysisId);
      setOverview(null);
      setLocations(null);
      router.refresh();
    });

  const box = "rounded-xl border border-[#E8E5E0] bg-[#F4F3F0] p-3 text-sm text-[#2E2D29]";

  return (
    <div className="space-y-3">
      {error && <ErrorNote>{error}</ErrorNote>}
      {notice && <p className={box}>{notice}</p>}

      {!connected ? (
        <div className="space-y-3">
          <p className="rounded-xl border border-dashed border-[#D8D4CC] bg-[#FAF9F7] p-3 text-sm leading-relaxed text-[#6B6862]">
            店舗を管理しているGoogleアカウントで連携すると、店舗の基本情報・クチコミ・表示回数などを読み取れます（この段階では読み取りのみで、Google側の情報は書き換えません）。連携するまでは、Googleマップの公開データ（星・クチコミ件数・写真枚数・近隣競合）で運用状況を記録します。
          </p>
          <a href={startUrl}>
            <Btn>Googleで連携する</Btn>
          </a>
          <p className="text-xs text-[#8B877F]">現在テスト運用中のため、事前に登録したアカウントのみ連携できます。</p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className={box}>
            連携中のGoogleアカウント：<b className="font-semibold">{overview?.email ?? "（確認中）"}</b>
          </p>

          {overview?.error && <ErrorNote>{overview.error}</ErrorNote>}

          {linkedLocationName ? (
            <div className="space-y-2 rounded-xl border border-[#E8E5E0] bg-white p-3 text-sm text-[#2E2D29]">
              <p className="font-semibold">{overview?.location?.title || "紐付け済みの店舗"}</p>
              {overview?.location && (
                <dl className="space-y-1 text-xs text-[#6B6862]">
                  {overview.location.address && <div>住所：{overview.location.address}</div>}
                  {overview.location.phone && <div>電話：{overview.location.phone}</div>}
                  {overview.location.website && <div className="break-all">サイト：{overview.location.website}</div>}
                  {overview.location.categories.length > 0 && <div>カテゴリ：{overview.location.categories.join("、")}</div>}
                  <div>営業時間：{overview.location.hasHours ? "登録あり" : "未登録"}</div>
                </dl>
              )}
              {overview && <p className="text-xs text-[#8B877F]">取り込み済みのクチコミ：{overview.reviewCount}件</p>}
              <div className="flex flex-wrap gap-2 pt-1">
                <Btn size="sm" variant="outline" onClick={sync} disabled={busy !== null}>
                  {busy === "sync" ? "取り込み中…" : "クチコミを取り込む"}
                </Btn>
                <Btn size="sm" variant="ghost" onClick={unlink} disabled={busy !== null}>
                  店舗の紐付けを外す
                </Btn>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Btn variant="outline" onClick={loadLocations} disabled={busy !== null}>
                {busy === "list" ? "店舗を読み込み中…" : "管理している店舗から選ぶ"}
              </Btn>
              {listErrors.length > 0 && <ErrorNote>{listErrors.join(" / ")}</ErrorNote>}
              {locations && locations.length > 0 && (
                <ul className="divide-y divide-[#F0EEEA] rounded-xl border border-[#E8E5E0] bg-white">
                  {locations.map((l) => (
                    <li key={`${l.account}/${l.name}`} className="flex items-center justify-between gap-3 p-3">
                      <div className="min-w-0 text-sm">
                        <p className="truncate font-semibold text-[#2E2D29]">{l.title || l.name}</p>
                        {l.address && <p className="truncate text-xs text-[#8B877F]">{l.address}</p>}
                      </div>
                      <Btn size="sm" onClick={() => link(l)} disabled={busy !== null}>
                        {busy === `link:${l.name}` ? "紐付け中…" : "この店舗にする"}
                      </Btn>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <a href={startUrl} className="text-xs text-[#6B6862] underline">
              別のGoogleアカウントで連携し直す
            </a>
            <button type="button" onClick={disconnect} disabled={busy !== null} className="text-xs text-[#A8705A] underline disabled:opacity-50">
              {busy === "disconnect" ? "解除中…" : "連携を解除"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
