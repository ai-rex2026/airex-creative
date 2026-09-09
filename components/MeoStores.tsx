import type { MeoScan, MeoStore } from "@/lib/meo";

/**
 * 多拠点クライアントの店舗一覧。
 * レポート画面とMEO専用画面の両方から使う。
 */

/** 満点が店舗によって違う（近隣比較が取れない店舗は競合比の項目が無い）ので割合で見る */
export function scorePct(got: number, max: number) {
  return max > 0 ? Math.round((got / max) * 100) : 0;
}

export function MeoStoreRow({ st }: { st: MeoStore }) {
  const p = scorePct(st.score, st.scoreMax);
  return (
    <div className="s">
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

export function MeoStoreList({ meo }: { meo: MeoScan }) {
  if (meo.stores.length <= 1) return null;
  const rest = meo.stores.length - SHOWN;
  return (
    <>
      <div className="note">
        <i className="i">i</i>
        <span>
          同じサイトを登録している店舗が <b style={{ fontWeight: 600 }}>{meo.stores.length}件</b> 見つかりました。
          店舗ごとに評価とレビュー数が違うので、分けて出しています。
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
          <MeoStoreRow st={st} key={i} />
        ))}
      </div>
      {rest > 0 && (
        <details className="moredt measure">
          <summary>残り {rest} 店舗を表示</summary>
          <div className="stores">
            {meo.stores.slice(SHOWN).map((st, i) => (
              <MeoStoreRow st={st} key={i} />
            ))}
          </div>
        </details>
      )}
    </>
  );
}
