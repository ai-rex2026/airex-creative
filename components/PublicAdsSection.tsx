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

/** 所見・施策案の中の広告の番号（m1・g1）を、一覧の表示（M1・G1）にそろえる */
const codes = (t: string) => t.replace(/(^|[^A-Za-z0-9])([mg])(\d{1,2})(?![0-9A-Za-z])/g, (_, a: string, b: string, c: string) => `${a}${b.toUpperCase()}${c}`);

type Legal = NonNullable<PublicAds["legal"]>;
type Measure = NonNullable<PublicAds["measures"]>[number];
type Proposal = NonNullable<NonNullable<PublicAds["byPlatform"]>["meta"]["proposals"]>[number];

function Review({ title, findings, measures, legal }: { title: string; findings: string[]; measures: Measure[]; legal: Legal }) {
  return (
    <>
      {(findings.length > 0 || legal.length > 0) && (
        <div className="rows measure" style={{ marginTop: 10 }}>
          <div className="rh">{title}に対する所見</div>
          {findings.map((f, i) => (
            <div className="r" key={`f${i}`}>
              <small style={{ color: "var(--text)", fontSize: 13 }}>{codes(f)}</small>
            </div>
          ))}
          {legal.map((l, i) => (
            <div className="r" key={`l${i}`} style={{ display: "block" }}>
              <b style={{ color: "var(--ng)", fontWeight: 500 }}>法令上の注意：「{l.text}」</b>
              <small style={{ display: "block", marginTop: 2 }}>
                {l.law}：{codes(l.reason)}
                {l.suggestion ? ` → ${l.suggestion}` : ""}
              </small>
            </div>
          ))}
        </div>
      )}
      {measures.length > 0 && (
        <div className="rows measure" style={{ marginTop: 10 }}>
          <div className="rh">{title}の施策案</div>
          {measures.map((m, i) => (
            <div className="r" key={i} style={{ display: "block" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                <b style={{ flex: 1 }}>{codes(m.title)}</b>
                <span className={`tag${m.impact === "大" ? " ok" : ""}`}>効果 {m.impact}</span>
              </div>
              <small style={{ display: "block", marginTop: 4 }}>{codes(m.why)}</small>
              {m.steps?.length > 0 && (
                <ol style={{ margin: "8px 0 0 18px", fontSize: 12.5, color: "var(--muted)", lineHeight: 1.7 }}>
                  {m.steps.map((s, j) => <li key={j}>{codes(s)}</li>)}
                </ol>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/** 媒体ごとのまとまり：現状の広告（折りたたみ）→ 所見 → 施策案 */
function PlatformBlock({
  name,
  count,
  error,
  list,
  findings,
  measures,
  legal,
  proposals = [],
}: {
  name: string;
  count: number;
  error?: string;
  list: React.ReactNode[];
  findings: string[];
  measures: Measure[];
  legal: Legal;
  proposals?: Proposal[];
}) {
  return (
    <div className="pa-block">
      <h3 className="pa-h">{name}</h3>
      {count > 0 ? (
        <details className="pafold">
          <summary>現状の広告（同じ素材をまとめて{count}件）を表示する</summary>
          <div className="rows measure" style={{ border: 0, marginTop: 0 }}>{list}</div>
        </details>
      ) : (
        <p className="sub">広告を取得できませんでした{error ? `（${error.slice(0, 80)}）` : ""}</p>
      )}
      <Review title={name} findings={findings} measures={measures} legal={legal} />
      {/* 2026-10-06: 制作案は「広告運用設計」の各広告グループに反映して出す（ここでは重ねて出さない） */}
      {proposals.length > 0 && (
        <div className="note" style={{ marginTop: 10 }}>
          <i className="i">i</i>
          <span>この所見をもとにした画像・動画の制作案は、下の「広告運用設計」の各広告グループに反映しています。</span>
        </div>
      )}
    </div>
  );
}

export function PublicAdsSection({ data }: { data: PublicAds | null }) {
  if (!data || data.stage !== "done") return null;
  const { meta, google } = data;
  if (meta.status === "skipped" && google.status === "skipped") return null;
  const total = meta.ads.length + google.ads.length;
  const notes = new Map((data.creatives ?? []).map((c) => [c.ref, c]));
  const facts = data.facts;
  const split = data.byPlatform ?? null;

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

          {(meta.ads.length > 0 || meta.status === "error") && (
            <PlatformBlock
              name="Meta 広告"
              count={meta.ads.length}
              error={meta.error}
              list={meta.ads.map((a, i) => {
                const n = notes.get(`m${i + 1}`);
                return (
                  <div className="r" key={a.id} style={{ display: "block" }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                      <span className="tag score">M{i + 1}</span>
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
                      {(a.sameCount ?? 1) > 1 && `（同じ素材で${a.sameCount}本配信${(a.otherLinks?.length ?? 0) > 0 ? `・ほかのリンク先 ${a.otherLinks!.length}件` : ""}）`}
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
              findings={split ? split.meta.findings : []}
              measures={split ? split.meta.measures : []}
              proposals={split?.meta.proposals ?? []}
              legal={split ? (data.legal ?? []).filter((l) => (l.platform ?? "meta") === "meta") : []}
            />
          )}

          {(google.ads.length > 0 || google.status === "error") && (
            <PlatformBlock
              name="Google 広告"
              count={google.ads.length}
              error={google.error}
              list={google.ads.map((a, i) => {
                const n = notes.get(`g${i + 1}`);
                const text = [a.headline, a.body].filter(Boolean).join(" ") || n?.onscreenText || "";
                return (
                  <div className="r" key={a.id} style={{ display: "block" }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                      <span className="tag score">G{i + 1}</span>
                      <span className="tag">{a.format === "Text" ? "テキスト" : a.format === "Image" ? "画像" : a.format === "Video" ? "動画" : a.format || "—"}</span>
                      <small style={{ color: "var(--faint)" }}>
                        {a.firstShown}〜{a.lastShown}
                        {(a.sameCount ?? 1) > 1 ? `（同じ素材 ${a.sameCount}件）` : ""}
                      </small>
                    </div>
                    {text && <small style={{ display: "block", marginTop: 4, color: "var(--text)" }}>{text}</small>}
                  </div>
                );
              })}
              findings={split ? split.google.findings : []}
              measures={split ? split.google.measures : []}
              proposals={split?.google.proposals ?? []}
              legal={split ? (data.legal ?? []).filter((l) => l.platform === "google") : []}
            />
          )}

          {/* 媒体ごとに分ける前（2026-10-06 夕方）に作った分析は、所見と施策案をまとめて出す */}
          {!split && (
            <Review
              title="Meta・Google 広告"
              findings={data.findings ?? []}
              measures={data.measures ?? []}
              legal={data.legal ?? []}
            />
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
