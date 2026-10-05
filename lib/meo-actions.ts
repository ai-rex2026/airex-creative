import type { MeoStore } from "./meo";

/**
 * 選択した店舗の実測（Googleマップ）から、その店舗のMEO施策を作る。
 *
 * 以前は「MEO（Googleマップ）」の欄に、店舗に関係なく同じ一般論（キーワード計画の meo）を
 * 出していた。店舗を切り替えても内容が変わらないため、実測した数字と未達の項目だけから
 * 機械的に作る形にした（AIを呼ばないので、店舗を切り替えるたびに即座に変わり、費用もかからない）。
 *
 * 守ること:
 *  - 書くのは、この店舗で実測できた数字と、そこから言える「やること」だけ
 *  - 実測できていない項目（写真の枚数・投稿頻度など）の良し悪しは書かない
 *  - 効果の見込みや順位の改善を断定しない
 */
export function meoStoreActions(store: MeoStore): string[] {
  const out: string[] = [];
  const s = store.self;
  const gap = (label: string) => store.breakdown.find((b) => b.label === label && b.got < b.max);

  // 評価
  if (s.rating === null) {
    out.push("評価がまだ付いていません。来院・利用の後にGoogleマップの口コミをお願いする導線（受付での案内、会計時のQRコード、サンクスメールのリンク）を用意する");
  } else if (store.compared && store.avgRating !== null && s.rating < store.avgRating) {
    out.push(
      `星${s.rating.toFixed(1)}は近隣の同業の平均（星${store.avgRating.toFixed(1)}）を下回っています。低評価の口コミの内容を確認し、事実と違う点・改善できる点を整理したうえで、全件に返信する`
    );
  }

  // レビュー数
  const reviewGap = store.breakdown.find((b) => b.label.startsWith("レビュー数") && b.got < b.max);
  if (store.compared && store.avgReviews !== null && s.reviews < store.avgReviews) {
    const rank = store.reviewRank !== null ? `（近隣の同業${store.totalShops}店中${store.reviewRank}位）` : "";
    out.push(
      `口コミは${s.reviews}件で、近隣の同業の平均（${Math.round(store.avgReviews)}件）より少ない状態です${rank}。施術・来院の直後に口コミを依頼する仕組みを作り、依頼の担当者と頻度を決める`
    );
  } else if (reviewGap) {
    out.push(`口コミ数は近隣の同業と比べて少ない状態です（${reviewGap.note}）。来院後に口コミを依頼する仕組みを作る`);
  }

  // 営業時間・電話番号
  if (gap("営業時間の登録")) {
    out.push("営業時間が未登録です。マップ上で「営業時間不明」と表示されるため、ビジネスプロフィールに通常営業時間と祝日の営業時間を登録する");
  }
  if (gap("電話番号の登録")) {
    out.push("電話番号が未登録です。マップから直接電話できない状態のため、予約・問い合わせ用の電話番号をビジネスプロフィールに登録する");
  }

  // 不足が見つからなかったとき。実測できない項目があることも明示する
  if (out.length === 0) {
    out.push("今回実測できた項目（評価・口コミ数・営業時間・電話番号）に、近隣の同業と比べた不足は見つかりませんでした");
  }
  out.push("写真の枚数・投稿の頻度・商品（メニュー）の登録状況は、この分析では実測できません。ビジネスプロフィールの管理画面で現状を確認してください");
  return out;
}
