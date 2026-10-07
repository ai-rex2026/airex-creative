"use client";

import { useCallback, useEffect, useState } from "react";
import { gbpProfileApplyAction, gbpProfileCurrentAction, gbpProfilePreviewAction, type GbpApplyResult, type GbpProfilePreview } from "@/app/meo-actions";
import { Btn, Checkbox, ErrorNote, GuardNotes } from "@/components/meo/ui";
import { DAYS, DAY_LABEL, emptyHours, type GbpProfile, type ProfileInput, type ProfileKey, type WeeklyHours } from "@/lib/gbp/profile";

const msg = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);
const timeClass = "h-9 rounded-lg border border-[#E0DBD1] bg-white px-2 text-sm text-[#2E2D29] disabled:opacity-40";

/**
 * 下書きの内容を Google に反映する（人が差分を確認して承認したときだけ）。
 * 反映できるのは 説明文・営業時間・Webサイト。自動では反映しない。
 */
export function GbpApply({ analysisId, linked, description, websiteUrl }: { analysisId: string; linked: boolean; description: string; websiteUrl: string }) {
  const [current, setCurrent] = useState<GbpProfile | null>(null);
  const [useKeys, setUseKeys] = useState<Record<ProfileKey, boolean>>({ description: true, website: false, hours: false });
  const [hours, setHours] = useState<WeeklyHours>(emptyHours());
  const [preview, setPreview] = useState<{ p: GbpProfilePreview; input: ProfileInput } | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [approved, setApproved] = useState(false);
  const [results, setResults] = useState<GbpApplyResult[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const c = await gbpProfileCurrentAction(analysisId);
      setCurrent(c);
      if (c.hours) setHours(c.hours);
    } catch (e) {
      setError(msg(e, "Googleの現在の内容を読み込めませんでした"));
    }
  }, [analysisId]);

  useEffect(() => {
    if (linked) void load();
  }, [linked, load]);

  const resetPreview = () => {
    setPreview(null);
    setApproved(false);
    setResults(null);
  };

  const input = (): ProfileInput => ({
    ...(useKeys.description ? { description } : {}),
    ...(useKeys.website ? { website: websiteUrl } : {}),
    ...(useKeys.hours ? { hours } : {}),
  });

  const check = async () => {
    setBusy("preview");
    setError(null);
    resetPreview();
    try {
      const inp = input();
      if (!Object.keys(inp).length) throw new Error("反映する項目を選んでください");
      const p = await gbpProfilePreviewAction(analysisId, inp);
      setPreview({ p, input: inp });
      setPicked(Object.fromEntries(p.changes.map((c) => [c.key, c.changed])));
      if (!p.changes.some((c) => c.changed)) setError("選んだ項目は、Googleの現在の内容と同じです");
    } catch (e) {
      setError(msg(e, "確認に失敗しました"));
    } finally {
      setBusy(null);
    }
  };

  const apply = async () => {
    if (!preview) return;
    const keys = preview.p.changes.filter((c) => c.changed && picked[c.key]).map((c) => c.key);
    setBusy("apply");
    setError(null);
    try {
      const r = await gbpProfileApplyAction(analysisId, preview.input, { keys, baseline: preview.p.baseline });
      setResults(r);
      setPreview(null);
      setApproved(false);
      await load();
    } catch (e) {
      setError(msg(e, "反映に失敗しました。時間をおいて再度お試しください"));
    } finally {
      setBusy(null);
    }
  };

  const setDay = (d: (typeof DAYS)[number], patch: Partial<WeeklyHours[typeof d]>) => {
    resetPreview();
    setHours((h) => ({ ...h, [d]: { ...h[d], ...patch } }));
  };

  const selected = preview ? preview.p.changes.filter((c) => c.changed && picked[c.key]) : [];
  const canApply = !!preview && !preview.p.blocked && selected.length > 0 && approved && busy === null;

  return (
    <section className="space-y-4 rounded-2xl border border-[#E8E5E0] bg-white p-5">
      <div>
        <p className="text-sm font-semibold text-[#2E2D29]">Googleに反映（承認してから）</p>
        <p className="mt-0.5 text-xs leading-relaxed text-[#8B877F]">
          上の「ビジネスの説明」「Webサイト」と、ここで設定する営業時間を、内容を確認して承認したときだけGoogleビジネスプロフィールへ反映します。自動では反映しません。店舗名・住所・電話番号・カテゴリは、Googleの再確認が入ることがあるためここでは変更できません。
        </p>
      </div>

      {!linked ? (
        <p className="rounded-xl border border-dashed border-[#D8D4CC] bg-[#FAF9F7] p-3 text-sm text-[#6B6862]">
          Googleに反映するには、「設定」タブでGoogleビジネスプロフィールを連携し、店舗を紐付けてください。
        </p>
      ) : (
        <>
          {error && <ErrorNote>{error}</ErrorNote>}

          <ul className="space-y-2 text-sm text-[#2E2D29]">
            <li className="flex items-center gap-2.5">
              <Checkbox id="gbp-use-desc" checked={useKeys.description} onChange={(v) => { resetPreview(); setUseKeys({ ...useKeys, description: v }); }} />
              <label htmlFor="gbp-use-desc" className="cursor-pointer">ビジネスの説明を反映する（上の入力欄の内容）</label>
            </li>
            <li className="flex items-center gap-2.5">
              <Checkbox id="gbp-use-web" checked={useKeys.website} onChange={(v) => { resetPreview(); setUseKeys({ ...useKeys, website: v }); }} />
              <label htmlFor="gbp-use-web" className="cursor-pointer">Webサイトを反映する（上のNAP情報の入力欄の内容）</label>
            </li>
            <li className="flex items-center gap-2.5">
              <Checkbox id="gbp-use-hours" checked={useKeys.hours} onChange={(v) => { resetPreview(); setUseKeys({ ...useKeys, hours: v }); }} />
              <label htmlFor="gbp-use-hours" className="cursor-pointer">営業時間を反映する（下の入力欄の内容）</label>
            </li>
          </ul>

          <div className="space-y-2 rounded-xl border border-[#F0EEEA] p-3">
            <p className="text-xs font-semibold text-[#2E2D29]">営業時間（通常の週間スケジュール）</p>
            {current?.hoursComplex ? (
              <p className="text-xs leading-relaxed text-[#8B877F]">
                Google側の営業時間は、複数の時間帯や日またぎなどを含むため、ここでは編集できません。Googleの管理画面で編集してください。
              </p>
            ) : (
              <ul className="space-y-1.5">
                {DAYS.map((d) => (
                  <li key={d} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="w-6 text-[#2E2D29]">{DAY_LABEL[d]}</span>
                    <label className="flex items-center gap-1.5 text-xs text-[#6B6862]">
                      <Checkbox id={`gbp-closed-${d}`} checked={hours[d].closed} onChange={(v) => setDay(d, { closed: v })} />
                      休み
                    </label>
                    <input type="time" aria-label={`${DAY_LABEL[d]}曜の開店`} value={hours[d].open} disabled={hours[d].closed} onChange={(e) => setDay(d, { open: e.target.value })} className={timeClass} />
                    <span className="text-[#A5A198]">–</span>
                    <input type="time" aria-label={`${DAY_LABEL[d]}曜の閉店`} value={hours[d].close} disabled={hours[d].closed} onChange={(e) => setDay(d, { close: e.target.value })} className={timeClass} />
                  </li>
                ))}
              </ul>
            )}
            {current && !current.hours && !current.hoursComplex && <p className="text-xs text-[#8B877F]">Googleには営業時間が未登録です。</p>}
          </div>

          <Btn variant="outline" onClick={check} disabled={busy !== null}>
            {busy === "preview" ? "確認中…" : "反映内容を確認する"}
          </Btn>

          {preview && (
            <div className="space-y-3 rounded-xl border border-[#E8E5E0] bg-[#FAF9F7] p-3">
              <p className="text-xs font-semibold text-[#2E2D29]">Googleに反映する内容（まだ反映していません）</p>
              <ul className="space-y-2">
                {preview.p.changes.map((c) => (
                  <li key={c.key} className="rounded-lg border border-[#E8E5E0] bg-white p-3 text-sm">
                    <label className="flex items-center gap-2.5 font-semibold text-[#2E2D29]">
                      <Checkbox
                        checked={!!picked[c.key] && c.changed}
                        onChange={(v) => { setApproved(false); setPicked({ ...picked, [c.key]: v }); }}
                      />
                      {c.label}
                      {!c.changed && <span className="text-xs font-normal text-[#8B877F]">（現在の内容と同じ）</span>}
                    </label>
                    {c.changed && (
                      <dl className="mt-2 space-y-1.5 text-xs leading-relaxed">
                        <div>
                          <dt className="text-[#8B877F]">いまのGoogleの内容</dt>
                          <dd className="whitespace-pre-wrap break-words text-[#6B6862]">{c.current || "（未登録）"}</dd>
                        </div>
                        <div>
                          <dt className="text-[#8B877F]">反映後</dt>
                          <dd className="whitespace-pre-wrap break-words font-medium text-[#2E2D29]">{c.next}</dd>
                        </div>
                      </dl>
                    )}
                  </li>
                ))}
              </ul>

              <GuardNotes hits={preview.p.hits} />
              {preview.p.blocked && (
                <ErrorNote>説明文に修正が必要な表現があるため、このままでは反映できません。上の説明文を直してから、もう一度確認してください。</ErrorNote>
              )}

              <label className="flex items-start gap-2.5 text-sm text-[#2E2D29]">
                <span className="pt-0.5">
                  <Checkbox id="gbp-approve" checked={approved} onChange={setApproved} />
                </span>
                <span>上の内容を確認しました。選んだ項目をGoogleビジネスプロフィールに反映することを承認します。</span>
              </label>
              <Btn onClick={apply} disabled={!canApply}>
                {busy === "apply" ? "反映中…" : `承認してGoogleに反映する（${selected.length}項目）`}
              </Btn>
              <p className="text-xs text-[#8B877F]">反映後、Google検索・マップへの表示までに時間がかかることがあります。内容によってはGoogleの審査が入る場合があります。</p>
            </div>
          )}

          {results && (
            <ul className="space-y-1.5 text-sm">
              {results.map((r) => (
                <li key={r.key} className={r.ok ? "text-[#2E2D29]" : "text-[#A8705A]"}>
                  {r.ok ? "✓ " : "× "}
                  {r.label}：{r.ok ? "Googleに反映しました" : r.error}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
