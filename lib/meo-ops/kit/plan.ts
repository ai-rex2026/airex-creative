import type { KitKind, KitResults, KitStepId } from "./types";

/**
 * 「やること」。画面はこの一覧が先頭で、各項目を開くとその場で「今 → こう変える → なぜ」と貼る文章が出る。
 * 項目は AI に考えさせず、できあがった文章から機械的に組む（オルコネレックスの lib/plan.ts と同じ考え方）。
 */
export type Render =
  | "hpb-catch"
  | "hpb-intro"
  | "hpb-coupon"
  | "series"
  | "gbp-desc"
  | "gbp-posts"
  | "gbp-menu"
  | "gbp-profile"
  | "kit"
  | "greviews"
  | "coupon"
  | "insta"
  | "aio-ask"
  | "aio-faq"
  | "aio-jsonld"
  | "winners"
  | "measure"
  | "guard"
  | "score-fix"
  | "winners-actions";

export type PlanItem = {
  id: string;
  render: Render;
  /** どの工程の結果を使うか（未完成なら「作成中」と出す） */
  source: KitStepId | null;
  title: string;
  where: string;
  why: string;
  minutes: number;
  repeat?: string;
  ready: boolean;
};

export function buildPlan(r: KitResults, kind: KitKind, ctx: { unreplied: number; profilePending: number }): PlanItem[] {
  const d = r.diagnose;
  const obj = d?.objections?.[0];
  const st = d?.strengths?.[0];
  const items: PlanItem[] = [];
  const push = (x: Omit<PlanItem, "ready"> & { ready?: boolean }) => items.push({ ...x, ready: x.ready ?? (x.source ? !!r[x.source as keyof KitResults] : true) });

  if (kind === "beauty") {
    push({ id: "hpb-catch", render: "hpb-catch", source: "hpb", title: "ホットペッパーのキャッチを差し替える", where: "SALON BOARD → 掲載管理", minutes: 2, why: "キャッチは一覧で最初に目に入る一文です。今の文と並べて見られます" });
    push({ id: "hpb-intro", render: "hpb-intro", source: "hpb", title: "サロン紹介文を差し替える", where: "SALON BOARD → 掲載管理", minutes: 3, why: obj ? `「${obj}」と思って選ばない人に、紹介文で先に答えます` : "強みが最初の3行に入っていないと読まれません" });
    push({ id: "hpb-coupon", render: "hpb-coupon", source: "hpb", title: "クーポン名と説明を変える", where: "SALON BOARD → クーポン", minutes: 3, why: "クーポン名は検索結果にそのまま出るので、メニュー名だけより「誰向けか」が入っている方が押されます" });
    push({ id: "series", render: "series", source: "diagnose", title: "ブログを週1本出す", where: "SALON BOARD → ブログ", minutes: 5, repeat: "毎週", why: "1本だけでは集客につながりません。1年分のテーマを決めて、押すたびに次の1本を作ります" });
  }
  push({ id: "gbp-desc", render: "gbp-desc", source: "meo", title: "Googleマップの説明文を更新する", where: "この画面 → プロフィール", minutes: 3, why: st ? `「${st}」が説明文に入っていないと、地図で見た人に伝わりません` : "説明文は地図で見た人が最初に読む文章です" });
  push({
    id: "gbp-profile",
    render: "gbp-profile",
    source: null,
    title: ctx.profilePending ? `Googleマップのプロフィールと写真を整える（あと${ctx.profilePending}項目）` : "Googleマップのプロフィールと写真を見直す",
    where: "この画面 → プロフィール・写真",
    minutes: 10,
    why: "地図で見た人は、写真と電話番号・サイトで判断します。写真が古い・少ないと、それだけで候補から外れます",
  });
  if (kind === "beauty") {
    push({ id: "gbp-posts", render: "gbp-posts", source: "meo", title: "Googleマップに週1回投稿する（4週分あります）", where: "この画面 → 投稿", minutes: 2, repeat: "毎週", why: "投稿が続いているお店は「営業している・動いている」と見えます" });
  } else {
    push({ id: "series", render: "series", source: "diagnose", title: "Googleマップに週1回投稿する", where: "この画面 → 投稿", minutes: 2, repeat: "毎週", why: "投稿が続いているお店は「営業している・動いている」と見えます。1年分のテーマを決めて、押すたびに次の1本を作ります" });
    push({ id: "gbp-posts", render: "gbp-posts", source: "meo", title: "まず4週分の投稿を入れておく", where: "この画面 → 投稿", minutes: 5, why: "最初の1か月分はできています。下書きに入れて、日付を決めて出すだけです" });
  }
  if (kind === "food") push({ id: "gbp-menu", render: "gbp-menu", source: "meo", title: "看板メニューの紹介文を載せる", where: "Googleビジネスプロフィール → メニュー", minutes: 3, why: "地図から来る人は「何が食べられるか」で決めます", ready: !!r.meo?.menu });
  push({
    id: "kit",
    render: "kit",
    source: "kit",
    title: "店頭QRの口コミ画面を用意する（QRを置いて、会計時にひとこと）",
    where: kind === "beauty" ? "鏡の横・レジ" : kind === "food" ? "テーブル・レジ" : "受付・レジ",
    minutes: 10,
    why: "口コミはお願いしないと増えません。QRならその場でスマホから書けます。星が低い人の声はまずお店に届きます",
  });
  push({
    id: "greviews",
    render: "greviews",
    source: null,
    title: ctx.unreplied ? `来ている口コミに返信する（未返信 ${ctx.unreplied}件）` : "来ている口コミに返信する",
    where: "この画面 → クチコミ",
    minutes: 10,
    repeat: "口コミが来るたび",
    why: "返信が並んでいると、これから来る人に丁寧なお店だと伝わります。低い評価ほど早く返します",
  });
  if (kind === "food") push({ id: "coupon", render: "coupon", source: "coupon", title: "再来店クーポンを配り始める", where: "会計時・LINE", minutes: 5, why: "口コミとは切り離して、来た人全員に渡します（口コミの条件にしない）" });
  if (kind === "beauty") push({ id: "insta", render: "insta", source: null, title: "インスタにも同じ切り口で投稿する", where: "SNS運用", minutes: 15, repeat: "毎週", why: "連携した SNS ごとに書き分けた投稿案を、言葉のチェックつきで作れます" });
  push({ id: "aio-ask", render: "aio-ask", source: "aio", title: "AIにどう紹介されているか確かめる", where: "ChatGPT・Google の AIモード", minutes: 2, why: "「このお店ってどんな店？」と聞いたときのAIの答えと、AIがまだ知らない強みを出しています" });
  push({ id: "aio-faq", render: "aio-faq", source: "aio", title: "「よくある質問」をサイトかGoogleマップに載せる", where: "お店のHP／Googleビジネスプロフィール", minutes: 10, why: "AIは質問の形で情報を拾うので、AIに聞かれたときに答えてもらいやすくなります" });
  push({ id: "aio-jsonld", render: "aio-jsonld", source: "aio", title: "店舗情報の構造化データをサイトに貼る（制作会社に渡すだけ）", where: "お店のHP", minutes: 5, why: "検索エンジンやAIが、店名・住所・営業時間を機械的に読めるようになります。Google の登録情報から作っています" });
  const low = (r.score?.items ?? []).filter((x) => x.score < 80 && x.fix);
  if (low.length)
    push({
      id: "score-fix",
      render: "score-fix",
      source: "score",
      title: `集客スコアで点の低い所を直す（${low.length}か所）`,
      where: "お店のページ",
      minutes: 10,
      why: "採点で80点に届かなかった基準と、その直し方です。直して載せたら「今の状態」で採点し直すと点数が変わります",
    });
  if (r.winners?.actions.length)
    push({
      id: "winners-actions",
      render: "winners-actions",
      source: "winners",
      title: "先に挙がる店との差を埋める（今月やること）",
      where: "Googleマップ・お店のページ",
      minutes: 15,
      why: `${r.winners.items.map((x) => x.name).slice(0, 3).join("・")}と比べて出した、今月やることです。差の中身は「今の状態」で見られます`,
    });
  push({
    id: "winners",
    render: "winners",
    source: "diagnose",
    title: "AIが先に挙げている店との差を埋める",
    where: "この画面",
    minutes: 10,
    repeat: "毎月",
    why: r.winners
      ? `${r.winners.items.map((x) => x.name).slice(0, 3).join("・")}のページを読んで、効いていそうなことと自店との差から、今月やることを出しています`
      : "AIに店名を出さずに聞いたとき、先に挙がる店には理由があります。その店のページを読んで、何が効いているかと自店との差を出します",
  });
  push({ id: "measure", render: "measure", source: null, title: "見え方を測って、先月と比べる", where: "この画面 → キーワード順位・AI検索", minutes: 5, repeat: "毎月", why: "やったことが効いているかは、同じ質問・同じキーワードで毎月測って並べないと分かりません" });
  push({
    id: "guard",
    render: "guard",
    source: "guard",
    title: "赤が出た言葉を言い換えてから載せる",
    where: "上の文章すべて",
    minutes: 3,
    why: kind === "beauty" ? "薬機法・景表法に触れる言葉は、載せる前に直します" : kind === "food" ? "景表法・ステマ規制に触れる言葉は、載せる前に直します" : "景表法などに触れる言葉は、載せる前に直します",
  });
  return items;
}

/** 自動で順に回す工程（重い調べもの＝AIが挙げる店・続けて出すものは画面のボタンで実行） */
export function autoSteps(kind: KitKind): { id: KitStepId; label: string; progress: string }[] {
  return [
    { id: "scan", label: "お店の情報", progress: "サイトを読んでいます" },
    ...(kind === "beauty" ? [{ id: "hpbpage" as const, label: "ホットペッパー", progress: "ホットペッパーのページを探しています" }] : []),
    { id: "diagnose", label: "お店の特徴", progress: "お店の特徴を整理しています" },
    { id: "score", label: "集客スコア", progress: "今のページを採点しています" },
    ...(kind === "beauty" ? [{ id: "hpb" as const, label: "ホットペッパー", progress: "ホットペッパーの文章を書いています" }] : []),
    { id: "meo", label: "Googleマップ", progress: "Googleマップの文章を書いています" },
    { id: "kit", label: "口コミを集める", progress: "口コミのお願い文を作っています" },
    ...(kind === "food" ? [{ id: "coupon" as const, label: "クーポン", progress: "クーポンの文面を書いています" }] : []),
    { id: "aio", label: "AIに聞かれたら", progress: "AIに「このお店は？」と聞いています" },
    { id: "guard", label: "言葉のチェック", progress: "景表法などの言葉を確かめています" },
  ];
}
