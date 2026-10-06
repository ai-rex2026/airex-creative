"use client";

import { useEffect, useState, useTransition } from "react";
import { googleAssetsFor, startAnalysis } from "@/app/actions";
import { GuestLimitActions, guestUsedOnDevice } from "./GuestLimit";

/** 「MEOだけ見る」を出すか（MEO機能の完成まで false） */
const SHOW_MEO_MODE: boolean = false;
import type { GoogleAssets, GoogleChoice } from "@/lib/google";
import { MANUAL_SOCIAL_PLATFORMS } from "@/lib/social";
import type { AnalysisMode } from "@/lib/types";
import { IconArrowRight, IconGlobe } from "./Chrome";

type SocialRow = { platform: string; value: string };

export function NewAnalysisForm({ initialUrl, googleConnected = false }: { initialUrl: string; googleConnected?: boolean }) {
  const [url, setUrl] = useState(initialUrl);
  const [text, setText] = useState("");
  const [mode, setMode] = useState<AnalysisMode>("report");
  const [social, setSocial] = useState<SocialRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  // 未登録の分析回数の上限に達したときは、登録・ログインのボタンを出す
  const [needSignup, setNeedSignup] = useState(false);
  const [pending, start] = useTransition();
  // 連携中のGoogleアカウントのどのデータを使うか。"auto" は URL のドメインで自動的に探す
  const [gscSel, setGscSel] = useState<string>("auto");
  const [ga4Sel, setGa4Sel] = useState<string>("auto");
  const [assets, setAssets] = useState<GoogleAssets | null>(null);
  const [assetsErr, setAssetsErr] = useState<string | null>(null);
  const [assetsBusy, setAssetsBusy] = useState(false);

  // URL を入れ終えたら、連携中のアカウントに該当するサイト・プロパティがあるかを確かめる
  useEffect(() => {
    if (!googleConnected || mode !== "report" || !url.trim() || !url.includes(".")) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setAssetsBusy(true);
      setAssetsErr(null);
      try {
        const r = await googleAssetsFor(url);
        if (cancelled) return;
        if (r.connected && r.assets) {
          setAssets(r.assets);
          // URLに一致するものがあれば、手動で選び直していない限り自動のまま使う
        } else if (r.connected && r.error) {
          setAssetsErr(r.error);
        }
      } catch (e) {
        if (!cancelled) setAssetsErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setAssetsBusy(false);
      }
    }, 800);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [url, mode, googleConnected]);

  function addSocialRow() {
    setSocial((cur) => [...cur, { platform: MANUAL_SOCIAL_PLATFORMS[0], value: "" }]);
  }
  function updateSocialRow(i: number, patch: Partial<SocialRow>) {
    setSocial((cur) => cur.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function removeSocialRow(i: number) {
    setSocial((cur) => cur.filter((_, idx) => idx !== i));
  }

  function submit() {
    setErr(null);
    start(async () => {
      try {
        const res = await startAnalysis({
          guestUsed: guestUsedOnDevice(),
          url: url || undefined,
          text: mode === "meo" ? undefined : text || undefined,
          mode,
          socialAccounts: mode === "meo" ? undefined : social.filter((r) => r.value.trim()),
          google:
            googleConnected && mode === "report"
              ? ({
                  gsc: gscSel === "auto" ? null : gscSel,
                  ga4: ga4Sel === "auto" ? null : ga4Sel,
                  // 連携アカウントのチャンネルが対象サイトの公式チャンネルか確認できるまで、非公開指標は使わない
                  youtube: false,
                } satisfies GoogleChoice)
              : undefined,
        });
        if (res?.error) {
          setErr(res.error);
          setNeedSignup(!!res.needSignup);
        }
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        if (!m.includes("NEXT_REDIRECT")) setErr(m);
      }
    });
  }

  return (
    <div style={{ maxWidth: 620, margin: "64px auto 0", textAlign: "center" }}>
      <h2 style={{ fontSize: 22 }}>集客の伸びしろ、今すぐ見つけましょう</h2>

      {err && <div className="alert" style={{ marginTop: 20, textAlign: "left" }}>{err}</div>}
      {needSignup && <GuestLimitActions />}

      <div className="modes">
        <button className={mode === "report" ? "on" : ""} onClick={() => setMode("report")}>
          <b>サイトレポート</b>
          <small>（目安20〜40分。サイトにより前後します）</small>
        </button>
        {/* 2026-10-06: MEOはAPIキーが未発行で機能が未完成のため、「MEOだけ見る」は一旦非表示。
            再開するときは SHOW_MEO_MODE を true にする */}
        {SHOW_MEO_MODE && (
          <button className={mode === "meo" ? "on" : ""} onClick={() => setMode("meo")}>
            <b>MEOだけ見る</b>
            <small>マップ順位を実データで即確認</small>
          </button>
        )}
      </div>

      <div className="field" style={{ marginTop: 16 }}>
        <IconGlobe />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com"
          onKeyDown={(e) => { if (e.key === "Enter" && !pending) submit(); }}
        />
        <button className="go" onClick={submit} disabled={pending} aria-label="分析を始める">
          <IconArrowRight />
        </button>
      </div>

      {mode === "report" && (
        <>
          <textarea
            className="box"
            style={{ marginTop: 12, textAlign: "left" }}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="（任意）商品説明・補足。URLが無い場合はここだけでも分析できます"
            rows={2}
          />


          {googleConnected && (
            <div className="card" style={{ marginTop: 12, textAlign: "left", padding: 14 }}>
              <b style={{ fontSize: 13.5 }}>Google連携データ（連携中のアカウント）</b>
              <p style={{ margin: "4px 0 10px", fontSize: 12, color: "var(--faint)" }}>
                {assetsBusy
                  ? "連携中のアカウントを確認しています…"
                  : assets
                    ? "連携中のアカウントが持っているサイト・プロパティから、このレポートに使うものを選べます。"
                    : "URLを入れると、連携中のアカウントにこのサイトのデータがあるか確認します。"}
              </p>
              {assetsErr && <p style={{ color: "var(--ng)", fontSize: 12 }}>確認できませんでした：{assetsErr}</p>}

              <label style={{ display: "block", fontSize: 12, marginTop: 6 }}>Search Console</label>
              <select value={gscSel} onChange={(e) => setGscSel(e.target.value)} style={{ width: "100%" }}>
                <option value="auto">
                  自動（{assets ? (assets.gsc.match ? `一致：${assets.gsc.match}` : "このURLに一致するサイトは見つかりません") : "URLのドメインで探す"}）
                </option>
                <option value="none">使わない</option>
                {(assets?.gsc.sites ?? []).map((x) => (
                  <option key={x.siteUrl} value={x.siteUrl}>{x.siteUrl}</option>
                ))}
              </select>
              {assets?.gsc.error && <small style={{ color: "var(--ng)" }}>Search Consoleの一覧を取得できませんでした：{assets.gsc.error}</small>}

              <label style={{ display: "block", fontSize: 12, marginTop: 10 }}>Google Analytics 4</label>
              <select value={ga4Sel} onChange={(e) => setGa4Sel(e.target.value)} style={{ width: "100%" }}>
                <option value="auto">
                  自動（{assets ? (assets.ga4.match ? `一致：${assets.ga4.properties.find((p) => p.property === assets.ga4.match)?.displayName ?? assets.ga4.match}` : "このURLに一致するプロパティは見つかりません") : "URLのドメインで探す"}）
                </option>
                <option value="none">使わない</option>
                {(assets?.ga4.properties ?? []).map((p) => (
                  <option key={p.property} value={p.property}>
                    {p.displayName}{p.account ? `（${p.account}）` : ""}
                  </option>
                ))}
              </select>
              {assets?.ga4.error && <small style={{ color: "var(--ng)" }}>GA4の一覧を取得できませんでした：{assets.ga4.error}</small>}

              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5, marginTop: 12, opacity: 0.55 }}>
                <input type="checkbox" checked={false} disabled />
                YouTube：連携中のアカウントのチャンネルの非公開指標（視聴時間・登録者の増減など）を使う
                <span style={{ fontSize: 11, border: "1px solid var(--line, #ccc)", borderRadius: 4, padding: "1px 6px" }}>対応予定</span>
              </label>
              <p style={{ margin: "6px 0 0", fontSize: 11.5, color: "var(--faint)" }}>
                YouTubeの非公開指標は、連携中のアカウントのチャンネルが対象サイトの公式チャンネルか確認する仕組みを用意してから対応します（現在は使いません）。
                登録者数・動画数などの公開情報は、連携なしでこれまで通り取得します。
                Search Console・GA4で別のサイトを選ぶと、そのデータがこのレポートに入ります。このURLと同じサイトを選んでください。
              </p>
            </div>
          )}

          <div style={{ marginTop: 12, textAlign: "left" }}>
            {social.map((row, i) => (
              <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <select
                  value={row.platform}
                  onChange={(e) => updateSocialRow(i, { platform: e.target.value })}
                  style={{ flex: "0 0 auto" }}
                >
                  {MANUAL_SOCIAL_PLATFORMS.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
                <input
                  value={row.value}
                  onChange={(e) => updateSocialRow(i, { value: e.target.value })}
                  placeholder="@ハンドル または プロフィールURL"
                  style={{ flex: 1 }}
                />
                <button type="button" className="btn sm" onClick={() => removeSocialRow(i)} aria-label="削除">
                  ×
                </button>
              </div>
            ))}
            <button type="button" className="btn sm" onClick={addSocialRow}>
              + SNSアカウントを指定（任意）
            </button>
            <p style={{ marginTop: 6, fontSize: 12, color: "var(--faint)" }}>
              LPにリンクが無い場合や、自動検出が間違っている場合の補完・上書きに使います。
              YouTubeは公式APIで、X・TikTok・Instagramは実際にアカウントを確認したうえで実測します
              （キーワード検索ではありません）。
            </p>
          </div>
        </>
      )}

      {/* 2026-10-06: サイトレポートの説明文は削除（所要時間はモードのボタン内に表示） */}
      {(pending || mode === "meo") && (
        <p style={{ marginTop: 16, fontSize: 12.5, color: "var(--faint)" }}>
          {pending ? "分析を積んでいます…" : "Googleマップの掲載状況・評価・レビュー数を近隣の同業と比べます（約20秒）"}
        </p>
      )}
    </div>
  );
}
