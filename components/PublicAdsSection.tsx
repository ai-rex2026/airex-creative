import type { PublicAds } from "@/lib/public-ads";

/**
 * レポートの分析データタブ「出稿中の広告（公開情報）」（2026-10-06 新設）。
 * Meta 広告ライブラリ・Google 広告透明性センターで公開されている自社の広告と、
 * 画像・動画の中身・法令の注意・所見・施策案を出す（lib/public-ads.ts）。成果の数字は公開されていないので出さない。
 * 画像・動画そのものは載せない（Meta の素材URLは数日で切れるため）。広告ライブラリへのリンクで確認してもらう。
 */

const pathOf = (u: string) => {
  try {
    const x = new URL(u);
    return `${x.hostname.replace(/^www\./, "")}${x.pathname}`;
  } catch {
    return u;
  }
};

export function PublicAdsSection({ data }: { data: PublicAds | null }) {
  if (!data || data.stage !== "done") return null;
  const { meta, google } = data;
  if (meta.status === "skipped" && google.status === "skipped") return null;
  const total = meta.ads.length + google.ads.length;
  const notes = new Map((data.creatives ?? []).map((c) => [c.ref, c]));
  const facts = data.facts;

  return (
    <>
      <div className="sec-head">
        <div>
          <h2 id="sec-pubads">
            出稿中の広告（公開情報）<span className="tag score" style={{ marginLeft: 8, verticalAlign: "middle" }}>実データ</span>
          </h2>
          <div className="sub">
            Meta 広告ライブラリ・Google 広告透明性センターで公開されている広告です（
            {new Date(data.fetchedAt).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" })} 取得）。費用・成果の数字は公開されていません
          </div>
        </div>
        <span className="rule" />
      </div>

      {total === 0 ? (
        <div className="note">
          <i className="i">i</i>
          <span>
            公開情報では、配信中の広告は見つかりませんでした
            {meta.pageUrl ? `（Facebook ページ：${pathOf(meta.pageUrl)}` : "（Facebook ページ：見つからず"}
            {google.domain ? `／ドメイン：${google.domain}）` : "）"}。
            {meta.error || google.error ? " 一部の取得に失敗しています。" : ""}
          </span>
        </div>
      ) : (
        <>
          {facts?.lpOffSite && (
            <div className="alert" style={{ marginTop: 6 }}>
              Meta 広告のリンク先（{facts.lpDomains.join("・")}）は、今回分析したサイトとは別のドメインです。
              広告の受け皿になっているLPは、このレポートの「LP改善」「表示速度」では見ていません。
            </div>
          )}

          {meta.ads.length > 0 && (
            <div className="rows measure" style={{ marginTop: 14 }}>
              <div className="rh">Meta 広告（配信中 {meta.ads.length}件）</div>
              {meta.ads.map((a, i) => {
                const n = notes.get(`m${i + 1}`);
                return (
                  <div className="r" key={a.id} style={{ display: "block" }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                      <span className="tag">{a.format === "VIDEO" ? "動画" : a.format === "IMAGE" ? "画像" : a.format || "—"}</span>
                      <b style={{ flex: 1, minWidth: 160 }}>{a.title || "（見出しなし）"}</b>
                      <small style={{ color: "var(--faint)" }}>{a.startDate}〜</small>
                    </div>
                    {a.body && <small style={{ display: "block", marginTop: 4 }}>{a.body.replace(/\s+/g, " ").slice(0, 140)}</small>}
                    {n?.onscreenText && (
                      <small style={{ display: "block", marginTop: 4, color: "var(--text)" }}>
                        素材内の文字：{n.onscreenText}
                        {n.aspect ? `（${n.aspect}${n.subtitles ? `・字幕${n.subtitles}` : ""}）` : ""}
                      </small>
                    )}
                    <small style={{ display: "block", marginTop: 4, color: "var(--faint)" }}>
                      リンク先：{pathOf(a.linkUrl) || "—"}
                      {a.adLibraryUrl && (
                        <>
                          {" ／ "}
                          <a href={a.adLibraryUrl} target="_blank" rel="noreferrer">広告ライブラリで見る</a>
                        </>
                      )}
                    </small>
                  </div>
                );
              })}
            </div>
          )}

          {google.ads.length > 0 && (
            <div className="rows measure" style={{ marginTop: 14 }}>
              <div className="rh">Google 広告（{google.ads.length}件）</div>
              {google.ads.map((a, i) => {
                const n = notes.get(`g${i + 1}`);
                const text = [a.headline, a.body].filter(Boolean).join(" ") || n?.onscreenText || "";
                return (
                  <div className="r" key={a.id} style={{ display: "block" }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                      <span className="tag">{a.format === "Text" ? "テキスト" : a.format === "Image" ? "画像" : a.format === "Video" ? "動画" : a.format || "—"}</span>
                      <small style={{ color: "var(--faint)" }}>
                        {a.firstShown}〜{a.lastShown}
                      </small>
                    </div>
                    {text && <small style={{ display: "block", marginTop: 4, color: "var(--text)" }}>{text}</small>}
                  </div>
                );
              })}
            </div>
          )}

          {(data.legal?.length ?? 0) > 0 && (
            <div className="rows measure" style={{ marginTop: 14 }}>
              <div className="rh">法令上の注意</div>
              {data.legal!.map((l, i) => (
                <div className="r" key={i} style={{ display: "block" }}>
                  <b style={{ color: "var(--ng)", fontWeight: 500 }}>「{l.text}」</b>
                  <small style={{ display: "block", marginTop: 2 }}>
                    {l.law}：{l.reason}
                    {l.suggestion ? ` → ${l.suggestion}` : ""}
                  </small>
                </div>
              ))}
            </div>
          )}

          {(data.findings?.length ?? 0) > 0 && (
            <div className="rows measure" style={{ marginTop: 14 }}>
              <div className="rh">所見</div>
              {data.findings!.map((f, i) => (
                <div className="r" key={i}>
                  <small style={{ color: "var(--text)", fontSize: 13 }}>{f}</small>
                </div>
              ))}
            </div>
          )}

          {(data.measures?.length ?? 0) > 0 && (
            <div className="rows measure" style={{ marginTop: 14 }}>
              <div className="rh">施策案</div>
              {data.measures!.map((m, i) => (
                <div className="r" key={i} style={{ display: "block" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                    <b style={{ flex: 1 }}>{m.title}</b>
                    <span className={`tag${m.impact === "大" ? " ok" : ""}`}>効果 {m.impact}</span>
                  </div>
                  <small style={{ display: "block", marginTop: 4 }}>{m.why}</small>
                  {m.steps?.length > 0 && (
                    <ol style={{ margin: "8px 0 0 18px", fontSize: 12.5, color: "var(--muted)", lineHeight: 1.7 }}>
                      {m.steps.map((s, j) => <li key={j}>{s}</li>)}
                    </ol>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="note">
            <i className="i">i</i>
            <span>
              公開情報からの推定です。広告主の特定はドメインと Facebook ページの一致で行っているため、
              別ドメインのLPや代理店名義のアカウントで配信している広告は含まれないことがあります。
              {data.creativeError || data.reviewError ? " 一部の分析に失敗しています。" : ""}
            </span>
          </div>
        </>
      )}
    </>
  );
}
