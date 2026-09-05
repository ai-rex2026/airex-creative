# AI-REX Studio

URLを入れると、**訴求軸 → コピー → 法令チェック → バナー → LP** までを一気に作るツール。
AI-REX の「診断のあと」を担当する。

- 設計仕様：[Docs/SPEC.md](Docs/SPEC.md)（9月リリース版のスコープと、入れない機能の理由）
- 使い方マニュアル（社内・運営向け）：[Docs/AI-REX_Studio_使い方_v1.pptx](Docs/AI-REX_Studio_使い方_v1.pptx)
  画面・ボタン・ラベルを変えたら [Docs/manual/build-manual.mjs](Docs/manual/build-manual.mjs) を直して刷り直す
- バナーのオフライン量産プロトタイプ：[banner/](banner/)

## 動かす

```bash
cp .env.example .env.local   # ANTHROPIC_API_KEY を入れる
npm run dev
```

## 画面の流れ

| ステップ | 何をするか |
|---|---|
| 1 診断 | LPのURL（または商品説明）から、商材・ターゲット・業種・強み・**買わない理由**・訴求軸5本・ブランド色を出す |
| 2 コピー生成 | 訴求軸ごとに2案。**生成と同時に**法令チェック（赤／黄／緑）と勝ち筋スコアが付く |
| 3 バナー | 選んだ案 × 媒体サイズ（Meta / Google / Yahoo の6種）をその場でプレビュー、PNG・ZIPで保存 |
| 4 LP | 選んだ案に合わせたリンク先LPを1枚生成。HTMLで保存 |

## 設計の要点

- **日本語の文字は画像生成モデルに描かせない。** バナーは DOM で組み、ブラウザ側で PNG 化する
  （[components/Banner.tsx](components/Banner.tsx)）。字形が崩れず、文言だけ差し替えた量産ができる
- **法令チェックは生成と同時。** 事後検知では遅い。業種別の禁止表現辞書で確実な語を落とし、
  文脈が要るものだけAIに投げる。AIが落ちても辞書判定だけで結果を返す（[lib/guardrail.ts](lib/guardrail.ts)）
- **勝ち筋スコアは予測モデルではない。** 案どうしの相対順位づけで、根拠を必ず文章で返す。
  実データが溜まったら学習側に差し替える
- **自動入稿はしない。** 出稿は人が承認して行う（v0はZIP書き出しまで）
- **v0 はDBなし。** 状態はブラウザに置く。案件管理が要るようになってから永続化する

## 構成

```
app/actions.ts       Server Actions（診断・コピー・LP）
lib/diagnose.ts      URL → 診断
lib/copy.ts          訴求軸 → コピー ＋ 勝ち筋スコア
lib/guardrail.ts     景表法・薬機法・医療広告GL・金商法のチェック
lib/lp.ts            LP 1枚生成
lib/sizes.ts         媒体サイズのプリセット
components/Banner.tsx バナー本体（6サイズを1コンポーネントで賄う）
components/Studio.tsx 画面
```
