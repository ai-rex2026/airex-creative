"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { addKeywordAction, measureKeywordsNowAction, removeKeywordAction, saveRankOriginAction, suggestKeywordsAction } from "@/app/meo-actions";
import { MeoPageHeader, SectionTitle, useMeo } from "@/components/meo/Workspace";
import { Btn, Card, ErrorNote, Icon, Input, Label, cn } from "@/components/meo/ui";
import { DEFAULT_RADIUS_M, MAX_KEYWORDS, RANK_LIMIT, type MeoKeywordData, type MeoKeywordRank, type RankOrigin } from "@/lib/meo-ops/keywords";

/**
 * キーワード順位の画面。
 * 上: 起点と「今すぐ測る」／ キーワードの登録（AI候補つき）
 * 中: キーワードごとの 今の順位・先月・推移（折れ線）
 * 下: 選んだキーワードの上位の店と、自店とのギャップ（評価・クチコミ数・写真数）
 */
export function KeywordRanks({ storeId, data }: { storeId: string; data: MeoKeywordData }) {
  const { data: ws } = useMeo();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // ── キーワード登録 ──
  const [input, setInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [candidates, setCandidates] = useState<string[]>([]);

  const add = async (k: string) => {
    setAdding(true);
    setError(null);
    try {
      await addKeywordAction(storeId, k);
      setInput("");
      setCandidates((c) => c.filter((x) => x !== k));
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "追加できませんでした");
    } finally {
      setAdding(false);
    }
  };

  const suggest = async () => {
    setSuggesting(true);
    setError(null);
    try {
      setCandidates(await suggestKeywordsAction(storeId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "候補を考えられませんでした");
    } finally {
      setSuggesting(false);
    }
  };

  // ── 計測 ──
  const [measuring, setMeasuring] = useState(false);
  const measure = async () => {
    setMeasuring(true);
    setError(null);
    setNotice(null);
    try {
      const r = await measureKeywordsNowAction(storeId);
      setNotice(`${r.measured}件を測りました${r.failed ? `（${r.failed}件は取得できませんでした）` : ""}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "測定できませんでした");
    } finally {
      setMeasuring(false);
    }
  };

  // ── 集計 ──
  const byKeyword = useMemo(() => {
    const m = new Map<string, MeoKeywordRank[]>();
    for (const r of data.ranks) m.set(r.keywordId, [...(m.get(r.keywordId) ?? []), r]);
    for (const [k, list] of m) m.set(k, list.sort((a, b) => a.measuredOn.localeCompare(b.measuredOn)));
    return m;
  }, [data.ranks]);

  const [selected, setSelected] = useState<string | null>(null);
  const selectedKw = data.keywords.find((k) => k.id === (selected ?? data.keywords[0]?.id)) ?? null;
  const selectedLatest = selectedKw ? byKeyword.get(selectedKw.id)?.at(-1) ?? null : null;
  const origin = data.origin ?? data.storeOrigin;

  return (
    <div className="space-y-6">
      <MeoPageHeader icon="search" title="キーワード順位" description="お客さんが検索する言葉で、Googleマップ上で自店が何番目に出るかを毎月記録します（同じ起点・同じ条件で測るので推移が追えます）" />

      {!data.canMeasure && <ErrorNote>GOOGLE_MAPS_API_KEY が未設定のため測定できません（キーワードの登録はできます）</ErrorNote>}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        {/* キーワード登録 */}
        <Card>
          <div className="flex items-center justify-between gap-3">
            <SectionTitle>測るキーワード（{data.keywords.length} / {MAX_KEYWORDS}）</SectionTitle>
            <Btn variant="outline" size="sm" onClick={suggest} disabled={suggesting || data.keywords.length >= MAX_KEYWORDS}>
              {suggesting ? <Icon name="loader" /> : <Icon name="sparkles" className="h-3.5 w-3.5" />}
              AIに候補を考えさせる
            </Btn>
          </div>
          <div className="mt-3 flex gap-2">
            <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="例：渋谷 美容室" onKeyDown={(e) => { if (e.key === "Enter" && input.trim()) add(input); }} disabled={adding} />
            <Btn onClick={() => add(input)} disabled={adding || !input.trim() || data.keywords.length >= MAX_KEYWORDS} className="shrink-0">
              <Icon name="plus" className="h-3.5 w-3.5" />
              追加
            </Btn>
          </div>
          {candidates.length > 0 && (
            <div className="mt-3">
              <p className="text-xs text-[#8B877F]">AIの候補（押すと追加）</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {candidates.map((c) => (
                  <button key={c} type="button" onClick={() => add(c)} disabled={adding} className="rounded-full border border-[#E0DBD1] bg-white px-3 py-1 text-xs text-[#2E2D29] hover:bg-[#FAF9F7]">
                    ＋ {c}
                  </button>
                ))}
              </div>
            </div>
          )}
          {data.keywords.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {data.keywords.map((k) => (
                <span key={k.id} className="inline-flex items-center gap-1 rounded-full bg-[#F4F3F0] px-3 py-1 text-xs text-[#2E2D29]">
                  {k.keyword}
                  <button type="button" aria-label="削除" className="text-[#A5A198] hover:text-[#A8705A]" onClick={() => removeKeywordAction(storeId, k.id).then(() => router.refresh())}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </Card>

        {/* 起点と計測 */}
        <OriginCard storeId={storeId} origin={data.origin} storeOrigin={data.storeOrigin} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Btn onClick={measure} disabled={measuring || !data.canMeasure || data.keywords.length === 0 || data.measuredToday || !origin}>
          {measuring ? <Icon name="loader" /> : <Icon name="refresh" />}
          {measuring ? "測定中" : data.measuredToday ? "今日の分は測定済み" : "今すぐ全キーワードを測る"}
        </Btn>
        <span className="text-xs text-[#8B877F]">毎月1日に自動で測ります。手動は1日1回まで（1キーワードにつき Google の検索1回分の費用）</span>
      </div>
      {notice && <p className="text-sm text-[#2F6B4A]">{notice}</p>}
      {error && <ErrorNote>{error}</ErrorNote>}

      {/* 順位表 */}
      <Card>
        <SectionTitle>順位の推移</SectionTitle>
        {data.keywords.length === 0 ? (
          <p className="mt-3 text-sm text-[#8B877F]">キーワードを登録すると、ここに順位が並びます</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-[#8B877F]">
                  <th className="py-2 pr-3 font-medium">キーワード</th>
                  <th className="py-2 pr-3 font-medium">今の順位</th>
                  <th className="py-2 pr-3 font-medium">前回</th>
                  <th className="py-2 pr-3 font-medium">変化</th>
                  <th className="py-2 pr-3 font-medium">推移</th>
                  <th className="py-2 pr-3 font-medium">最終測定</th>
                </tr>
              </thead>
              <tbody>
                {data.keywords.map((k) => {
                  const hist = byKeyword.get(k.id) ?? [];
                  const latest = hist.at(-1) ?? null;
                  const prev = hist.at(-2) ?? null;
                  const delta = latest?.rank != null && prev?.rank != null ? prev.rank - latest.rank : null;
                  const isSel = selectedKw?.id === k.id;
                  return (
                    <tr key={k.id} onClick={() => setSelected(k.id)} className={cn("cursor-pointer border-t border-[#F0EDE8]", isSel && "bg-[#FAF9F7]")}>
                      <td className="py-2.5 pr-3 font-medium text-[#2E2D29]">{k.keyword}</td>
                      <td className="py-2.5 pr-3"><RankBadge rank={latest ? latest.rank : undefined} /></td>
                      <td className="py-2.5 pr-3 text-[#6B6862]">{prev ? (prev.rank ?? "圏外") : "–"}</td>
                      <td className="py-2.5 pr-3">
                        {delta == null ? <span className="text-[#A5A198]">–</span> : delta > 0 ? <span className="text-[#2F6B4A]">▲ {delta}</span> : delta < 0 ? <span className="text-[#A8705A]">▼ {-delta}</span> : <span className="text-[#A5A198]">→</span>}
                      </td>
                      <td className="py-2.5 pr-3"><Sparkline hist={hist} /></td>
                      <td className="py-2.5 pr-3 text-xs text-[#8B877F]">{latest ? latest.measuredOn : "未測定"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* 上位の店とギャップ */}
      {selectedKw && selectedLatest && (
        <Card>
          <SectionTitle>「{selectedKw.keyword}」の上位 {selectedLatest.top.length} 店（{selectedLatest.measuredOn} 測定）</SectionTitle>
          <GapTable top={selectedLatest.top} ownPlaceId={ws.ownPlaceId} own={{ rating: ws.store.rating, reviewCount: ws.store.reviewCount, photoCount: ws.photos.ownCount }} />
          <p className="mt-3 text-[11px] leading-relaxed text-[#A5A198]">※ Google の Places API（テキスト検索）で、設定した起点から半径{Math.round((selectedLatest.origin?.radiusMeters ?? DEFAULT_RADIUS_M) / 1000)}km に寄せて検索した並びです。地図アプリの表示と完全には一致しませんが、同じ条件で測るので推移は追えます。上位{RANK_LIMIT}件に無い場合は「圏外」です。</p>
        </Card>
      )}
    </div>
  );
}

function RankBadge({ rank }: { rank: number | null | undefined }) {
  if (rank === undefined) return <span className="text-xs text-[#A5A198]">未測定</span>;
  if (rank === null) return <span className="rounded-full bg-[#F4F3F0] px-2.5 py-0.5 text-xs text-[#8B877F]">圏外</span>;
  const cls = rank <= 3 ? "bg-[#EAF3EE] text-[#2F6B4A]" : rank <= 10 ? "bg-[#FBF4E4] text-[#8A6A1E]" : "bg-[#F4F3F0] text-[#6B6862]";
  return <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-bold", cls)}>{rank}位</span>;
}

/** 小さな折れ線。上ほど良い順位（1位が上）。圏外は一番下に置く */
function Sparkline({ hist }: { hist: MeoKeywordRank[] }) {
  const pts = hist.slice(-12);
  if (pts.length < 2) return <span className="text-xs text-[#A5A198]">–</span>;
  const w = 120;
  const h = 28;
  const y = (r: number | null) => (r == null ? h - 2 : 2 + ((Math.min(r, RANK_LIMIT) - 1) / (RANK_LIMIT - 1)) * (h - 4));
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${(i / (pts.length - 1)) * (w - 4) + 2},${y(p.rank).toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <path d={d} fill="none" stroke="#2E2D29" strokeWidth="1.5" strokeLinejoin="round" />
      {pts.map((p, i) => (
        <circle key={i} cx={(i / (pts.length - 1)) * (w - 4) + 2} cy={y(p.rank)} r="2" fill={p.rank == null ? "#C7C3BA" : "#C9A84C"} />
      ))}
    </svg>
  );
}

function GapTable({ top, ownPlaceId, own }: { top: MeoKeywordRank["top"]; ownPlaceId: string | null; own: { rating: number | null; reviewCount: number | null; photoCount: number | null } }) {
  const med = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x != null).sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : null;
  };
  const top5 = top.slice(0, 5);
  const gap = { rating: med(top5.map((p) => p.rating)), reviewCount: med(top5.map((p) => p.reviewCount)), photoCount: med(top5.map((p) => p.photoCount)) };
  return (
    <>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <GapTile label="評価（上位5店の中央値）" own={own.rating} bench={gap.rating} fmt={(v) => v.toFixed(1)} />
        <GapTile label="クチコミ数（同）" own={own.reviewCount} bench={gap.reviewCount} fmt={(v) => `${v}件`} />
        <GapTile label="写真数（同）" own={own.photoCount} bench={gap.photoCount} fmt={(v) => `${v}枚`} />
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-[#8B877F]">
              <th className="py-1.5 pr-3 font-medium">#</th>
              <th className="py-1.5 pr-3 font-medium">店名</th>
              <th className="py-1.5 pr-3 font-medium">評価</th>
              <th className="py-1.5 pr-3 font-medium">クチコミ</th>
              <th className="py-1.5 pr-3 font-medium">写真</th>
            </tr>
          </thead>
          <tbody>
            {top.map((p, i) => {
              const mine = p.placeId === ownPlaceId;
              return (
                <tr key={p.placeId} className={cn("border-t border-[#F0EDE8]", mine && "bg-[#EAF3EE] font-semibold")}>
                  <td className="py-1.5 pr-3 text-[#8B877F]">{i + 1}</td>
                  <td className="py-1.5 pr-3 text-[#2E2D29]">{p.name}{mine && <span className="ml-2 rounded-full bg-[#2F6B4A] px-2 py-0.5 text-[10px] text-white">自店</span>}</td>
                  <td className="py-1.5 pr-3">{p.rating ?? "–"}</td>
                  <td className="py-1.5 pr-3">{p.reviewCount ?? "–"}</td>
                  <td className="py-1.5 pr-3">{p.photoCount ?? "–"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function GapTile({ label, own, bench, fmt }: { label: string; own: number | null; bench: number | null; fmt: (v: number) => string }) {
  const diff = own != null && bench != null ? own - bench : null;
  return (
    <div className="rounded-xl bg-[#FAF9F7] p-3">
      <p className="text-[11px] text-[#8B877F]">{label}</p>
      <p className="mt-0.5 text-sm text-[#2E2D29]">
        自店 <b>{own != null ? fmt(own) : "–"}</b> ／ 上位 <b>{bench != null ? fmt(bench) : "–"}</b>
      </p>
      {diff != null && (
        <p className={cn("mt-0.5 text-xs", diff >= 0 ? "text-[#2F6B4A]" : "text-[#A8705A]")}>{diff >= 0 ? "上位と同等以上" : `上位まであと ${fmt(Math.abs(Math.round(diff * 10) / 10))}`}</p>
      )}
    </div>
  );
}

// ── 起点の設定 ─────────────────────────────────
function OriginCard({ storeId, origin, storeOrigin }: { storeId: string; origin: RankOrigin | null; storeOrigin: RankOrigin | null }) {
  const router = useRouter();
  const [custom, setCustom] = useState(!!origin);
  const [f, setF] = useState<RankOrigin>(origin ?? storeOrigin ?? { latitude: 35.681236, longitude: 139.767125, radiusMeters: DEFAULT_RADIUS_M, label: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async (reset: boolean) => {
    setSaving(true);
    setErr(null);
    try {
      await saveRankOriginAction(storeId, reset ? null : f);
      if (reset) setCustom(false);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "保存できませんでした");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <SectionTitle>測る起点</SectionTitle>
      <p className="mt-1 text-xs leading-relaxed text-[#8B877F]">Googleマップの並びは「どこから検索したか」で変わります。手元の端末の位置ではなく、ここで決めた地点から毎回同じ条件で測ります</p>
      {!custom ? (
        <div className="mt-3 space-y-2">
          <p className="text-sm text-[#2E2D29]">
            {storeOrigin ? <>店舗の位置から半径 {DEFAULT_RADIUS_M / 1000}km</> : <span className="text-[#A8705A]">店舗の位置が取れていません。起点を手で設定してください</span>}
          </p>
          <Btn variant="outline" size="sm" onClick={() => setCustom(true)}>起点を変える</Btn>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <div>
            <Label htmlFor="org-label">名前（任意）</Label>
            <Input id="org-label" className="mt-1" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="例：渋谷駅ハチ公口" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="org-lat">緯度</Label>
              <Input id="org-lat" className="mt-1" type="number" step="0.000001" value={f.latitude} onChange={(e) => setF({ ...f, latitude: Number(e.target.value) })} />
            </div>
            <div>
              <Label htmlFor="org-lng">経度</Label>
              <Input id="org-lng" className="mt-1" type="number" step="0.000001" value={f.longitude} onChange={(e) => setF({ ...f, longitude: Number(e.target.value) })} />
            </div>
          </div>
          <div>
            <Label htmlFor="org-r">半径（m）</Label>
            <Input id="org-r" className="mt-1" type="number" min={500} max={50000} step={500} value={f.radiusMeters} onChange={(e) => setF({ ...f, radiusMeters: Number(e.target.value) })} />
          </div>
          <p className="text-[11px] text-[#A5A198]">緯度経度は Googleマップで地点を右クリックするとコピーできます</p>
          {err && <ErrorNote>{err}</ErrorNote>}
          <div className="flex justify-between gap-2">
            <Btn variant="ghost" size="sm" onClick={() => save(true)} disabled={saving}>店舗の位置に戻す</Btn>
            <Btn size="sm" onClick={() => save(false)} disabled={saving}>
              {saving ? <Icon name="loader" /> : <Icon name="save" className="h-3.5 w-3.5" />}
              保存
            </Btn>
          </div>
        </div>
      )}
    </Card>
  );
}
