# airex-creative

AI-REX の「診断のあと」＝ 広告クリエイティブの自動生成・配信・改善をつくるための作業リポジトリ。

- 設計仕様：[Docs/SPEC.md](Docs/SPEC.md)
- バナー生成プロトタイプ：[banner/](banner/)

## banner プロトタイプ

日本語バナーの**文字は画像生成モデルに描かせず**、HTML/CSS で組版してヘッドレス Chrome で PNG にする。
生成AIが担当するのはコピーと、文字の入らない素材（背景・キャラ）だけ。

```bash
cd banner
node render.mjs                      # specs/*.json を全部レンダリング
node render.mjs specs/airex-01-shindan.json   # 1枚だけ
```

| ファイル | 役割 |
|---|---|
| `specs/*.json` | 1枚ぶんの入稿データ（サイズ・配色・コピー・CTA・素材） |
| `template.mjs` | spec → HTML。縦型／正方形／ストーリーを同じテンプレで出す |
| `render.mjs` | HTML → PNG（ヘッドレス Chrome） |
| `assets/` | 文字の入らない素材。`rex-clean.png` は暗部を純黒に落として `mix-blend-mode:screen` で合成する用 |
| `out/` | 書き出し |

コピーを差し替えるだけで同一デザインの量産ができる（店舗別・訴求別の出し分けはここが土台）。

## 前提

- macOS ＋ Google Chrome（`--headless=new --screenshot`）
- 日本語表示用フォントは ヒラギノ角ゴシック W8/W9（システム標準）
