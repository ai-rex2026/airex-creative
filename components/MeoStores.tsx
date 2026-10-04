import type { MeoScan, MeoStore } from "@/lib/meo";

/**
 * 多拠点クライアントの店舗一覧。
 * レポート画面とMEO専用画面の両方から使う。
 */

/** 満点が店舗によって違う（近隣比較が取れない店舗は競合比の項目が無い）ので割合で見る */
export function scorePct(got: number, max: number) {
  return max > 0 ? Math.round((got / max) * 100) : 0;
}

/**
 * selected/onSelect を渡すと、クリックでその店舗の詳細評価（MeoStoreDetail）に
 * 切り替えられるようにする。渡さない場合は従来どおり選べない一覧表示のまま
 * （他で使っていても壊れないようにオプショナルにしている）。
 */
export function MeoStoreRow({ st, selected, onSelect }: { st: MeoStore; selected?: boolean; onSelect?: () => void }) {
  const p = scorePct(st.score, st.scoreMax);
  return (
    <div
      className={`s${selected ? " selected" : ""}`}
      onClick={onSelect}
      role={onSelect ? "button" : undefined}
      tabIndex={onSelect ? 0 : undefined}
      style={onSelect ? { cursor: "pointer", outline: selected ? "2px solid var(--accent, #1a56db)" : undefined } : undefined}
    >
      <div className="h">
        <b>{st.self.name}</b>
        <span className={`tag${p >= 75 ? " ok" : p >= 50 ? "" : " warn"}`}>
          {st.score} / {st.scoreMax}
        </span>
      </div>
      <small>{st.self.address}</small>
      <div className="m">
        <span>★ {st.self.rating?.toFixed(1) ?? "—"}</span>
        <span>レビュー {st.self.reviews.toLocaleString()}件</span>
        <span>
          {st.compared && st.reviewRank
            ? `近隣${st.totalShops}店中 ${st.reviewRank}位`
            : "近隣比較なし（自店の数値のみ）"}
        </span>
      </div>
    </div>
  );
}

/** 先頭20件だけ開いておく。100拠点あると一覧が画面を埋めてしまう */
const SHOWN = 20;

export function MeoStoreList({
  meo,
  selectedIdx,
  onSelect,
}: {
  meo: MeoScan;
  /** 選択中の店舗（meo.stores のインデックス）。渡すとクリックで切り替えられる */
  selectedIdx?: number;
  onSelect?: (i: number) => void;
}) {
  if (meo.stores.length <= 1) return null;
  const rest = meo.stores.length - SHOWN;
  return (
    <>
      <div className="note">
        <i className="i">i</i>
        <span>
          同じサイトを登録している店舗が <b style={{ fontWeight: 600 }}>{meo.stores.length}件</b> 見つかりました。
          店舗ごとに評価とレビュー数が違うので、分けて出しています。
          {onSelect && <>店舗をクリックすると、その店舗の詳細評価に切り替わります。</>}
          {meo.comparedCount < meo.stores.length && (
            <>
              {" "}
              近隣同業との比較は、レビュー数の多い <b style={{ fontWeight: 600 }}>{meo.comparedCount}件</b> まで行っています。
              残りは自店の数値だけなので、点数の満点も下がります。
            </>
          )}
        </span>
      </div>
      <div className="stores measure">
        {meo.stores.slice(0, SHOWN).map((st, i) => (
          <MeoStoreRow st={st} key={i} selected={selectedIdx === i} onSelect={onSelect ? () => onSelect(i) : undefined} />
        ))}
      </div>
      {rest > 0 && (
        <details className="moredt measure">
          <summary>残り {rest} 店舗を表示</summary>
          <div className="stores">
            {meo.stores.slice(SHOWN).map((st, i) => {
              const idx = i + SHOWN;
              return (
                <MeoStoreRow st={st} key={idx} selected={selectedIdx === idx} onSelect={onSelect ? () => onSelect(idx) : undefined} />
              );
            })}
          </div>
        </details>
      )}
    </>
  );
}

/**
 * 店舗1件分の詳細評価（ゲージ・内訳・近隣比較）。
 * Report.tsx・MeoReport.tsx は、選んでいる店舗（既定は先頭）をここに渡す。
 */
export function MeoStoreDetail({ store }: { store: MeoStore }) {
  return (
    <>
      <div className="meo measure">
        <div className="gauge">
          <b>{store.score}</b>
          <small>/ {store.scoreMax || 100}</small>
          <span className={scorePct(store.score, store.scoreMax) >= 75 ? "ok" : scorePct(store.score, store.scoreMax) >= 50 ? "warn" : "ng"}>
            {scorePct(store.score, store.scoreMax) >= 75 ? "良好" : scorePct(store.score, store.scoreMax) >= 50 ? "改善の余地あり" : "要対策"}
          </span>
        </div>
        <div className="kpis">
          <div className="kpi">
            <b>{store.self.rating?.toFixed(1) ?? "—"}</b>
            <small>評価{store.avgRating !== null ? `（近隣平均 ${store.avgRating}）` : ""}</small>
          </div>
          <div className="kpi">
            <b>{store.self.reviews}</b>
            <small>レビュー数{store.avgReviews !== null ? `（近隣平均 ${store.avgReviews}）` : ""}</small>
          </div>
          <div className="kpi">
            <b>{store.totalShops > 1 && store.ratingRank ? `${store.ratingRank}位` : "—"}</b>
            <small>{store.totalShops > 1 ? `評価の順位 / ${store.totalShops}店` : "比較できる近隣同業なし"}</small>
          </div>
          <div className="kpi">
            <b>{store.totalShops > 1 && store.reviewRank ? `${store.reviewRank}位` : "—"}</b>
            <small>{store.totalShops > 1 ? `レビュー数の順位 / ${store.totalShops}店` : "比較できる近隣同業なし"}</small>
          </div>
        </div>
      </div>

      <details className="flags measure">
        <summary>点数の内訳（何を測ったか）</summary>
        <div className="rows" style={{ margin: 0 }}>
          {store.breakdown.map((b, i) => (
            <div className="r" key={i}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <b>{b.label}</b>
                <small>{b.note}</small>
              </div>
              <span className={`tag${b.got === 0 ? " warn" : ""}`}>{b.got} / {b.max}</span>
            </div>
          ))}
        </div>
      </details>

      {store.competitors.length > 0 && (
        <details className="flags measure">
          <summary>近隣の同業（{store.competitors.length}店）</summary>
          <div className="rows" style={{ margin: 0 }}>
            {(() => {
              // 自社を含めた最大値で正規化する。順位だけでなく差の大きさを見せる
              const top = Math.max(store.self.reviews ?? 0, ...store.competitors.map((c) => c.reviews), 1);
              return [{ name: store.self.name, address: "自社", rating: store.self.rating, reviews: store.self.reviews, me: true },
                      ...store.competitors.map((c) => ({ ...c, me: false }))]
                .sort((a, b) => b.reviews - a.reviews)
                .map((c, i) => (
                  <div className="r" key={i}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <b style={{ fontWeight: c.me ? 700 : 400 }}>{c.name}</b>
                      <small>{c.address}</small>
                    </div>
                    <span className="tag">★ {c.rating?.toFixed(1) ?? "—"}</span>
                    <span className={`cmpbar${c.me ? " self" : ""}`}>
                      <i style={{ width: `${Math.round((c.reviews / top) * 100)}%` }} />
                    </span>
                    <span className="tag">{c.reviews.toLocaleString()}</span>
                  </div>
                ));
            })()}
          </div>
        </details>
      )}

      <div className="note">
        <i className="i">i</i>
        <span>
          写真の枚数や投稿頻度は Google の公開データでは取得できないため、点数に入れていません。
          上の点数は<b style={{ fontWeight: 600 }}>実際に取得できた項目だけ</b>で計算しています。
        </span>
      </div>
    </>
  );
}
