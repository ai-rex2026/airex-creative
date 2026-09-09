import type { MeoScan } from "@/lib/meo";
import { MeoStoreList, scorePct } from "./MeoStores";
import type { SiteScan } from "@/lib/site-scan";

/**
 * MEO だけを見に来た人向けの画面。
 * レポート一式は作らないので、Googleマップの実測とその読み方だけを出す。
 */
export function MeoReport({ meo, site, url }: { meo: MeoScan | null; site: SiteScan | null; url: string | null }) {
  const host = url ? url.replace(/^https?:\/\//, "").replace(/\/$/, "") : "";

  return (
    <>
      <div className="rhead">
        <h2>{host}</h2>
        <span className="tag">MEO</span>
      </div>

      {!meo?.self ? (
        <div className="wrap">
          <div className="note">
            <i className="i">i</i>
            <span>{meo?.reason ?? "Googleビジネスプロフィールを特定できませんでした。"}</span>
          </div>
          <p className="note" style={{ marginTop: 10 }}>
            <i className="i">i</i>
            <span>
              プロフィールに登録されているウェブサイトのURLが <b style={{ fontWeight: 600 }}>{host}</b> と一致していれば特定できます。
              別のドメインや、URLが未登録になっていないかご確認ください。
            </span>
          </p>
        </div>
      ) : (
        <>
          <div className="sec-head">
            <span className="ic">◉</span>
            <div>
              <h2 id="sec-meo">Googleマップでの位置づけ</h2>
              <div className="sub">
                {meo.stores.length > 1
                  ? `${meo.stores.length}店舗を検出。以下は最もレビューの多い店舗の数値です`
                  : meo.totalShops > 1
                    ? `近隣3km・同じ業種の ${meo.totalShops} 店と比べています`
                    : "近隣3kmに同じ業種の店が見つからず、比較はできていません"}
              </div>
            </div>
            <span className="rule" />
          </div>

          <MeoStoreList meo={meo} />

          <div className="meo measure">
            <div className="gauge">
              <b>{meo.score}</b>
              <small>/ {meo.scoreMax || 100}</small>
              <span className={scorePct(meo.score, meo.scoreMax) >= 75 ? "ok" : scorePct(meo.score, meo.scoreMax) >= 50 ? "warn" : "ng"}>
                {scorePct(meo.score, meo.scoreMax) >= 75 ? "良好" : scorePct(meo.score, meo.scoreMax) >= 50 ? "改善の余地あり" : "要対策"}
              </span>
            </div>
            <div className="kpis">
              <div className="kpi">
                <b>{meo.self.rating?.toFixed(1) ?? "—"}</b>
                <small>評価{meo.avgRating !== null ? `（近隣平均 ${meo.avgRating}）` : ""}</small>
              </div>
              <div className="kpi">
                <b>{meo.self.reviews}</b>
                <small>レビュー数{meo.avgReviews !== null ? `（近隣平均 ${meo.avgReviews}）` : ""}</small>
              </div>
              <div className="kpi">
                <b>{meo.totalShops > 1 && meo.ratingRank ? `${meo.ratingRank}位` : "—"}</b>
                <small>{meo.totalShops > 1 ? `評価の順位 / ${meo.totalShops}店` : "比較できる近隣同業なし"}</small>
              </div>
              <div className="kpi">
                <b>{meo.totalShops > 1 && meo.reviewRank ? `${meo.reviewRank}位` : "—"}</b>
                <small>{meo.totalShops > 1 ? `レビュー数の順位 / ${meo.totalShops}店` : "比較できる近隣同業なし"}</small>
              </div>
            </div>
          </div>

          <div className="rows measure">
            <div className="rh">登録内容<small>{meo.self.name}</small></div>
            <div className="r">
              <div style={{ flex: 1, minWidth: 0 }}><b>所在地</b><small>{meo.self.address}</small></div>
            </div>
            {meo.self.mapsUri && (
              <div className="r">
                <div style={{ flex: 1, minWidth: 0 }}><b>Googleマップ</b><small>登録されているプロフィール</small></div>
                <a className="tag" href={meo.self.mapsUri} target="_blank" rel="noreferrer noopener">開く</a>
              </div>
            )}
          </div>

          <div className="sec-head">
            <span className="ic">▤</span>
            <div>
              <h2>点数の内訳</h2>
              <div className="sub">何を測って何点にしたか</div>
            </div>
            <span className="rule" />
          </div>
          <div className="rows measure">
            {meo.breakdown.map((b, i) => (
              <div className="r" key={i}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b>{b.label}</b>
                  <small>{b.note}</small>
                </div>
                <span className={`tag${b.got === 0 ? " warn" : ""}`}>{b.got} / {b.max}</span>
              </div>
            ))}
          </div>

          {meo.competitors.length > 0 && (
            <>
              <div className="sec-head">
                <span className="ic">◈</span>
                <div>
                  <h2>近隣の同業</h2>
                  <div className="sub">レビュー数の多い順</div>
                </div>
                <span className="rule" />
              </div>
              <div className="rows measure">
                {meo.competitors.map((c, i) => (
                  <div className="r" key={i}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <b>{c.name}</b>
                      <small>{c.address}</small>
                    </div>
                    <span className="tag">★ {c.rating?.toFixed(1) ?? "—"}</span>
                    <span className="tag">{c.reviews}件</span>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="note">
            <i className="i">i</i>
            <span>
              写真の枚数や投稿頻度は Google の公開データでは取得できないため、点数に入れていません。
              上の点数は<b style={{ fontWeight: 600 }}>実際に取得できた項目だけ</b>で計算しています。
            </span>
          </div>
        </>
      )}

      {site && (
        <div className="cta-band">
          <div>
            <b>広告まで含めて見る</b>
            <small>訴求軸・広告運用設計・コピー・バナーまで一式を作ります</small>
          </div>
          <a className="btn" href={`/analysis/new?url=${encodeURIComponent(url ?? "")}`}>サイトレポートを作る</a>
        </div>
      )}
    </>
  );
}
