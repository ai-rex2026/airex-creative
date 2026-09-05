/**
 * 使い方マニュアル（社内・運営向け）の pptx を実装から起こす。
 * 画面名・ボタン名は components/Studio.tsx の文字列と一致させること。
 * 画面・ボタン・ラベルを変えたら、このスクリプトも直して刷り直す。
 */
import PptxGenJS from "pptxgenjs";
import path from "node:path";

const OUT = path.resolve(process.argv[2] ?? "Docs/AI-REX_Studio_使い方_v1.pptx");

const INK = "0E0E0E";
const GOLD = "F0B429";
const PAPER = "FAF8F4";
const LINE = "DED8CC";
const MUTED = "6B6459";
const RED = "C0392B";
const GREEN = "2E7D5B";
const FONT = "Hiragino Sans";

const W = 10, H = 5.625;
const M = 0.6;            // 外余白
const BODY_Y = 1.15;      // コンテンツ開始

const pptx = new PptxGenJS();
pptx.defineLayout({ name: "16x9", width: W, height: H });
pptx.layout = "16x9";

/** 1行テキスト */
function t(s, o) {
  s.addText(o.text, {
    x: o.x, y: o.y, w: o.w, h: o.h ?? 0.34,
    fontFace: FONT, fontSize: o.size ?? 14, bold: o.bold ?? false,
    color: o.color ?? INK, align: o.align ?? "left", valign: o.valign ?? "middle",
    lineSpacingMultiple: o.lsm ?? 1.2, margin: 0, ...(o.opts ?? {}),
  });
}

/** 塗り矩形 */
function box(s, o) {
  s.addShape(pptx.ShapeType.rect, {
    x: o.x, y: o.y, w: o.w, h: o.h,
    fill: { color: o.fill ?? PAPER },
    line: o.lineColor ? { color: o.lineColor, width: o.lineW ?? 1 } : { type: "none" },
    rectRadius: o.radius, ...(o.opts ?? {}),
  });
}

/** 明るい面のスライド。左上に見出し、その左に金の縦バー */
function page(title, kicker) {
  const s = pptx.addSlide();
  s.background = { color: PAPER };
  box(s, { x: M, y: 0.42, w: 0.07, h: 0.52, fill: GOLD });
  if (kicker) t(s, { text: kicker, x: M + 0.22, y: 0.34, w: 8.6, h: 0.24, size: 10, color: MUTED, bold: true });
  t(s, { text: title, x: M + 0.22, y: kicker ? 0.58 : 0.46, w: 8.8, h: 0.46, size: 26, bold: true });
  return s;
}

/** 折り返し後の行数から必要な高さを見積もる（固定高だと3行で溢れて上下の要素に食い込む） */
function lines(text, wIn, size) {
  const perLine = Math.max(1, (wIn * 72) / size * 0.92);
  return Math.max(1, Math.ceil(text.length / perLine));
}
function textH(text, wIn, size, lsm = 1.25) {
  return lines(text, wIn, size) * size * 0.0176 * lsm;
}

/** 番号つきの手順ブロック。結果は本文の下に小さく置く。戻り値は次に置ける y */
function steps(s, items, x, y, w) {
  let cy = y;
  const tw = w - 0.44;
  items.forEach((it, i) => {
    s.addShape(pptx.ShapeType.ellipse, {
      x, y: cy + 0.03, w: 0.3, h: 0.3, fill: { color: INK }, line: { type: "none" },
    });
    t(s, { text: String(i + 1), x, y: cy + 0.03, w: 0.3, h: 0.3, size: 12, bold: true, color: "FFFFFF", align: "center" });
    const dh = textH(it.do, tw, 14, 1.2);
    t(s, { text: it.do, x: x + 0.44, y: cy, w: tw, h: dh, size: 14, bold: true, valign: "top" });
    cy += dh + 0.06;
    if (it.res) {
      const rh = textH(it.res, tw, 11.5, 1.3);
      t(s, { text: it.res, x: x + 0.44, y: cy, w: tw, h: rh, size: 11.5, color: MUTED, lsm: 1.3, valign: "top" });
      cy += rh;
    }
    cy += 0.22;
  });
  return cy;
}

/* ── 1. 表紙 ───────────────────────────────── */
{
  const s = pptx.addSlide();
  s.background = { color: INK };
  box(s, { x: 0, y: 0, w: 0.16, h: H, fill: GOLD });
  t(s, { text: "AI-REX STUDIO ・ 社内運用マニュアル", x: 1.0, y: 1.15, w: 8, h: 0.3, size: 11, bold: true, color: GOLD });
  t(s, { text: "AI-REX Studio の使い方", x: 1.0, y: 1.55, w: 8.4, h: 0.8, size: 40, bold: true, color: "FFFFFF" });
  t(s, {
    text: "サイトのURLから、訴求軸・コピー・バナー・LPまでを作る",
    x: 1.0, y: 2.5, w: 8.4, h: 0.4, size: 15, color: "D8D2C6",
  });
  box(s, { x: 1.0, y: 3.25, w: 7.9, h: 0.02, fill: "3A3A3A" });
  const foot = [
    ["画面", "http://localhost:3000  ※公開URLは未定"],
    ["対象", "社内・運営むけ"],
    ["版", "v1 ・ 2026年9月5日"],
  ];
  foot.forEach(([k, v], i) => {
    t(s, { text: k, x: 1.0 + i * 2.7, y: 3.55, w: 2.5, h: 0.24, size: 9.5, bold: true, color: MUTED });
    t(s, { text: v, x: 1.0 + i * 2.7, y: 3.8, w: 2.6, h: 0.5, size: 11.5, color: "FFFFFF", lsm: 1.2 });
  });
}

/* ── 2. 全体の流れ ─────────────────────────── */
{
  const s = page("人が手を動かすのは4か所です", "全体の流れ");
  const cards = [
    ["1", "診断", "URLを入れる"],
    ["2", "コピー", "使う案を選ぶ"],
    ["3", "バナー", "サイズを選んで保存"],
    ["4", "LP", "作るボタンを押す"],
  ];
  const cw = (W - M * 2 - 0.3 * 3) / 4;
  cards.forEach(([n, name, act], i) => {
    const x = M + i * (cw + 0.3);
    box(s, { x, y: BODY_Y + 0.1, w: cw, h: 1.9, fill: "FFFFFF", lineColor: LINE });
    box(s, { x, y: BODY_Y + 0.1, w: cw, h: 0.06, fill: GOLD });
    t(s, { text: n, x: x + 0.2, y: BODY_Y + 0.35, w: 0.6, h: 0.4, size: 22, bold: true, color: GOLD });
    t(s, { text: name, x: x + 0.2, y: BODY_Y + 0.82, w: cw - 0.4, h: 0.34, size: 17, bold: true });
    t(s, { text: act, x: x + 0.2, y: BODY_Y + 1.18, w: cw - 0.4, h: 0.6, size: 12, color: MUTED, lsm: 1.3 });
  });
  t(s, {
    text: "あいだの作業（訴求軸を考える・コピーを書く・法令の確認・6サイズへの展開）は自動で進みます。",
    x: M, y: 3.45, w: W - M * 2, h: 0.34, size: 14, bold: true,
  });
  box(s, { x: M, y: 3.95, w: W - M * 2, h: 0.9, fill: "FFF6E2" });
  t(s, {
    text: "出稿（媒体への入稿）は自動では行いません。書き出したファイルを人が確認して入稿します。",
    x: M + 0.25, y: 4.1, w: W - M * 2 - 0.5, h: 0.6, size: 13, color: INK, lsm: 1.3,
  });
}

/* ── 3. 準備するもの ───────────────────────── */
{
  const s = page("使う前に、キーの設定と起動が要ります", "準備するもの");
  steps(s, [
    { do: "APIキーを設定する", res: "リポジトリの .env.local に ANTHROPIC_API_KEY を書きます。未設定のまま押すと、画面の上に赤い帯で「ANTHROPIC_API_KEY が未設定です」と出ます。" },
    { do: "起動する", res: "ターミナルで npm run dev。ブラウザで http://localhost:3000 を開きます。" },
    { do: "そのまま使い始める", res: "ログイン画面はありません。開いた人がすぐ使えます。社外に公開する前にアクセス制限をかけます。" },
  ], M, BODY_Y + 0.1, 5.4);

  box(s, { x: 6.3, y: BODY_Y + 0.1, w: 3.1, h: 2.5, fill: "FFFFFF", lineColor: LINE });
  t(s, { text: "料金がかかります", x: 6.55, y: BODY_Y + 0.3, w: 2.6, h: 0.3, size: 13, bold: true, color: RED });
  t(s, {
    text: "「診断する」「訴求軸 5 本 × 2案を作る」「LPを作る」は、押すたびにAIの利用料がかかります。試し打ちを繰り返すぶんだけ増えます。",
    x: 6.55, y: BODY_Y + 0.68, w: 2.6, h: 1.7, size: 11.5, color: MUTED, lsm: 1.35,
  });
}

/* ── 4. 画面の地図 ─────────────────────────── */
{
  const s = page("画面は1ページで、上から4つに分かれています", "画面の地図");
  const rows = [
    ["1 診断", "サイトのURLから、商材・ターゲット・訴求軸を出す"],
    ["2 コピー生成・法令チェック", "訴求軸ごとにコピーを作り、法令と勝ち筋を見る"],
    ["3 バナー書き出し", "選んだ案を媒体サイズごとに書き出す"],
    ["4 リンク先LP", "広告と同じ訴求軸でLPを1枚作る"],
  ];
  let y = BODY_Y + 0.15;
  rows.forEach(([k, v]) => {
    box(s, { x: M, y, w: W - M * 2, h: 0.72, fill: "FFFFFF", lineColor: LINE });
    box(s, { x: M, y, w: 0.05, h: 0.72, fill: GOLD });
    t(s, { text: k, x: M + 0.3, y: y + 0.05, w: 3.0, h: 0.3, size: 14, bold: true });
    t(s, { text: v, x: M + 0.3, y: y + 0.36, w: 8.3, h: 0.3, size: 12, color: MUTED });
    y += 0.85;
  });
  t(s, {
    text: "上のステップを終えるまで、下のステップは画面に出ません。順番どおりに進みます。",
    x: M, y: y + 0.15, w: W - M * 2, h: 0.34, size: 13, bold: true,
  });
}

/* ── 5. 手順1 診断 ─────────────────────────── */
{
  const s = page("サイトのURLを入れて「診断する」を押します", "手順 1 ・ 診断");
  steps(s, [
    { do: "上の欄に、広告を出すページのURLを入れる", res: "入力例が「https://example.com/lp」と薄く出ている欄です。" },
    { do: "（任意）下の欄に商品説明を足す", res: "URLが無い商材は、この欄だけでも診断できます。" },
    { do: "「診断する」を押す", res: "1分ほどで、商材／ターゲット／業種（表現規制）／ブランド色／強み／買わない理由／訴求軸が出ます。" },
  ], M, BODY_Y + 0.1, 5.5);

  box(s, { x: 6.4, y: BODY_Y + 0.1, w: 3.0, h: 2.6, fill: "FFFFFF", lineColor: LINE });
  t(s, { text: "出たあとに直せるもの", x: 6.65, y: BODY_Y + 0.3, w: 2.5, h: 0.3, size: 13, bold: true });
  t(s, {
    text: "「ブランド色」の16進の値は、その場で書き換えられます。書き換えるとバナーの色がすぐ変わります。",
    x: 6.65, y: BODY_Y + 0.68, w: 2.5, h: 1.1, size: 11.5, color: MUTED, lsm: 1.35,
  });
  t(s, {
    text: "「業種（表現規制）」は、次の法令チェックの厳しさを決めます。違っていたら診断をやり直します。",
    x: 6.65, y: BODY_Y + 1.75, w: 2.5, h: 1.0, size: 11.5, color: MUTED, lsm: 1.35,
  });

  box(s, { x: M, y: 4.35, w: W - M * 2, h: 0.62, fill: "FDECEA" });
  t(s, {
    text: "「診断する」を押し直すと、それまでのコピーとLPは消えます。残したいものは先に保存します。",
    x: M + 0.25, y: 4.45, w: W - M * 2 - 0.5, h: 0.42, size: 13, bold: true, color: RED,
  });
}

/* ── 6. 手順2 コピー ───────────────────────── */
{
  const s = page("コピーを作り、2つのバッジで選びます", "手順 2 ・ コピー生成・法令チェック");
  const afterSteps = steps(s, [
    { do: "「訴求軸 5 本 × 2案を作る」を押す", res: "数字は診断で出た訴求軸の本数です。1本につき2案、勝ち筋スコアの高い順に並びます。" },
    { do: "使う案にチェックを入れる", res: "はじめは上位3案にチェックが入っています。外す・足すは自由です。" },
  ], M, BODY_Y + 0.1, 8.8);

  const badges = [
    [GREEN, "法令 問題なし", "そのまま使えます"],
    ["B8860B", "法令 要確認", "文脈しだいで問題になる表現です。指摘を読んで判断します"],
    [RED, "法令 修正必要", "禁止表現に当たっています。この案は出しません"],
  ];
  let y = afterSteps + 0.05;
  badges.forEach(([c, label, desc]) => {
    box(s, { x: M, y, w: 1.85, h: 0.42, fill: c, radius: 0.2, opts: { rectRadius: 0.2 } });
    t(s, { text: label, x: M, y, w: 1.85, h: 0.42, size: 11.5, bold: true, color: "FFFFFF", align: "center" });
    t(s, { text: desc, x: M + 2.05, y, w: 6.6, h: 0.42, size: 12.5, color: INK });
    y += 0.5;
  });

  box(s, { x: M, y: y + 0.1, w: W - M * 2, h: 0.92, fill: "FFFFFF", lineColor: LINE });
  t(s, { text: "「勝ち筋 78」の数字について", x: M + 0.25, y: y + 0.2, w: 8.5, h: 0.28, size: 13, bold: true });
  t(s, {
    text: "案どうしの相対的な順位づけで、クリック率の予測値ではありません。数字より、その下に出る理由を読んで選びます。お客さまに「予測」と説明しないでください。",
    x: M + 0.25, y: y + 0.48, w: 8.5, h: 0.38, size: 11.5, color: MUTED, lsm: 1.3, valign: "top",
  });
}

/* ── 7. 手順3 バナー ───────────────────────── */
{
  const s = page("サイズを選び、まとめて書き出します", "手順 3 ・ バナー書き出し");
  steps(s, [
    { do: "使うサイズのボタンを押す", res: "はじめは Meta 1080×1080 ／ Meta 1080×1350 ／ Google 1200×628 の3つが選ばれています。" },
    { do: "「全部まとめてZIPで保存」を押す", res: "選んだ案 × 選んだサイズの枚数だけ書き出します。1枚ずつなら各画像の下の「1080×1080 を保存」を押します。" },
  ], M, BODY_Y + 0.1, 5.3);

  box(s, { x: 6.2, y: BODY_Y + 0.1, w: 3.2, h: 2.55, fill: "FFFFFF", lineColor: LINE });
  t(s, { text: "選べるサイズ", x: 6.45, y: BODY_Y + 0.28, w: 2.7, h: 0.28, size: 13, bold: true });
  const sizes = [
    "Meta 1080×1080", "Meta 1080×1350", "Meta 1080×1920",
    "Google 1200×628", "Google 300×250", "Yahoo 300×250",
  ];
  sizes.forEach((v, i) => {
    t(s, { text: v, x: 6.45, y: BODY_Y + 0.62 + i * 0.32, w: 2.7, h: 0.3, size: 12, color: MUTED });
  });

  box(s, { x: M, y: 4.0, w: W - M * 2, h: 0.95, fill: "FFF6E2" });
  t(s, {
    text: "枚数はそのままAIの生成量ではありません。画像はブラウザの中で作るので、サイズを増やしても追加の料金はかかりません。",
    x: M + 0.25, y: 4.15, w: W - M * 2 - 0.5, h: 0.65, size: 13, lsm: 1.3,
  });
}

/* ── 8. 手順4 LP ───────────────────────────── */
{
  const s = page("広告と同じ訴求軸でLPを1枚作ります", "手順 4 ・ リンク先LP");
  steps(s, [
    { do: "「（見出し）に合わせたLPを作る」を押す", res: "チェックを入れた案のうち、いちばん上の案の見出しがボタンに入ります。別の案で作りたいときは、その案だけにチェックを残します。" },
    { do: "出てきたLPを画面で確認する", res: "コピーと同じく、法令のバッジが付きます。" },
    { do: "「index.html を保存」を押す", res: "1枚のHTMLファイルで保存されます。そのままサーバーに置けます。" },
  ], M, BODY_Y + 0.1, 5.4);

  box(s, { x: 6.3, y: BODY_Y + 0.1, w: 3.1, h: 2.3, fill: "FFFFFF", lineColor: LINE });
  t(s, { text: "広告と着地をずらさない", x: 6.55, y: BODY_Y + 0.3, w: 2.6, h: 0.3, size: 13, bold: true });
  t(s, {
    text: "バナーと同じ訴求軸から作るので、広告で言ったことと着地で言っていることが揃います。別々に作ると、ここがずれて数字が落ちます。",
    x: 6.55, y: BODY_Y + 0.68, w: 2.6, h: 1.5, size: 11.5, color: MUTED, lsm: 1.35,
  });
}

/* ── 9. 出てくるファイル ───────────────────── */
{
  const s = page("保存すると、この形で出てきます", "出てくるファイル");
  const rows = [
    ["airex-creative.zip", "「全部まとめてZIPで保存」で出るもの。中は媒体ごとのフォルダに分かれています"],
    ["Meta/1080x1080_1.png", "ZIPの中身。末尾の番号は選んだ案の順番です"],
    ["lp/index.html", "LPを作ってあればZIPに一緒に入ります"],
    ["Meta_1080x1080_1.png", "1枚ずつ保存したときの名前"],
    ["lp.html", "LPだけを保存したときの名前"],
  ];
  let y = BODY_Y + 0.15;
  rows.forEach(([k, v]) => {
    box(s, { x: M, y, w: W - M * 2, h: 0.62, fill: "FFFFFF", lineColor: LINE });
    t(s, { text: k, x: M + 0.25, y, w: 2.9, h: 0.62, size: 12.5, bold: true });
    t(s, { text: v, x: M + 3.25, y, w: 5.4, h: 0.62, size: 11.5, color: MUTED, lsm: 1.25 });
    y += 0.72;
  });
  t(s, {
    text: "作業の途中の状態は、そのブラウザにだけ残ります。別のパソコンや別のブラウザには引き継がれません。",
    x: M, y: y + 0.15, w: W - M * 2, h: 0.4, size: 13, bold: true,
  });
}

/* ── 10. 気をつけること ────────────────────── */
{
  const s = pptx.addSlide();
  s.background = { color: INK };
  box(s, { x: M, y: 0.42, w: 0.07, h: 0.52, fill: GOLD });
  t(s, { text: "気をつけること", x: M + 0.22, y: 0.34, w: 8.6, h: 0.24, size: 10, bold: true, color: GOLD });
  t(s, { text: "押す前に、影響を知っておくもの", x: M + 0.22, y: 0.58, w: 8.8, h: 0.46, size: 26, bold: true, color: "FFFFFF" });

  const items = [
    ["「法令 修正必要」の案は出さない", "赤は禁止表現に当たったものです。指摘の言い換え案を使うか、その案を捨てます。"],
    ["「診断する」の押し直しで前の結果が消える", "コピーとLPは消えます。残すものは先に保存します。"],
    ["入稿は人が行う", "このツールは書き出しまでです。媒体への入稿・予算の変更は自動では行いません。"],
    ["「配信して自動で改善」はまだできない", "媒体との接続は10月以降です。お客さまへの説明にも、バナーのコピーにも書かないでください。"],
  ];
  let y = 1.35;
  items.forEach(([k, v]) => {
    box(s, { x: M, y, w: W - M * 2, h: 0.8, fill: "1C1C1C" });
    box(s, { x: M, y, w: 0.05, h: 0.8, fill: GOLD });
    t(s, { text: k, x: M + 0.3, y: y + 0.08, w: 8.4, h: 0.3, size: 14, bold: true, color: "FFFFFF" });
    t(s, { text: v, x: M + 0.3, y: y + 0.4, w: 8.4, h: 0.36, size: 11.5, color: "BFB9AD", lsm: 1.25 });
    y += 0.9;
  });
  t(s, { text: "困ったときは 渚 まで。", x: M, y: y + 0.02, w: 8.8, h: 0.3, size: 12, color: "BFB9AD" });
}

await pptx.writeFile({ fileName: OUT });
console.log("wrote", OUT);
