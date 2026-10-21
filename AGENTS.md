<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# このリポジトリの決めごと

- **日本語の文字を画像生成モデルに描かせない**（字形が崩れ、量産の再現性が無くなる）。バナーは DOM で組む
- **法令チェックは生成と同時に通す**。事後検知は仕様違反
- **自動入稿・自動予算変更はしない**。出稿は人が承認する
- 効果・成果の断定表現をプロダクトのコピーにも使わない（自社LPも景表法の対象）

## 有料・レート制限のある外部API呼び出しを含む非同期処理の書き方（必読・2026-10-04のクレジット急減事故の再発防止）

**事故の経緯**: 複数の非同期処理（SNS競合調査・施策生成・KPI生成など9章）を`Promise.all`でまとめて
待ち、まとめて1回だけ保存する書き方になっていた。生成関数の一部に`.catch`が無く例外を投げるため、
どれか1本でも失敗すると**成功していた分（Apify実測＝実際に課金される処理）も含めて丸ごと保存され
ず**、次回の再試行で9章すべて最初からやり直し＝成功していたApify呼び出しまで再度実行される、とい
う無駄な再実行・再課金が発生した（`lib/analysis.ts`、commit a823460 で修正）。

**今後このリポジトリで同種のコードを書く・直すときの必須ルール**:

- 複数の独立したタスクを並列実行するとき、`Promise.all`でまとめない。`Promise.allSettled`を使い、
  **成功したタスクと失敗したタスクを分けて扱う**（1本の失敗が他の成功を握りつぶさないようにする）
- 各タスクが完了した時点で、**そのタスクの結果だけをその場で保存する**（まとめて最後に1回保存し
  ない）。DBへの保存はカラム単位の`update`にして、並行保存で他のカラムを壊さないようにする
- 再試行（次回のtick・次回の呼び出し）では、**すでに保存済みの項目は処理対象から外す**（完了フラ
  グ／既存データの有無を呼び出し前に必ずチェックする）。これが無いと、成功済みの有料API呼び出しま
  で毎回繰り返される
- Apifyなど呼び出し回数に上限があるAPIは、呼び出し回数の予算チェック（`claim_apify_call` RPCなど）
  を**実際のfetch直前の一箇所**に必ず通す。予算キャップは最後の防波堤であり、上記の「成功した分が
  消えて再実行される」設計自体を直すことの代わりにはならない
- 有料API・外部送信を含む非同期処理のロジックを修正したら、**本番反映前に実際にはそのAPIを呼ばない
  形（スタブ関数での成否シミュレーション等）で動作を検証する**。コードレビューだけで「直った」と
  報告しない

## Cowork/Claudeセッションでこのリポジトリを修正する際の注意（重要・時間短縮のため必読）

- **サンドボックスから `git push` は直接通らない**（環境側のプロキシ制限）。`git fetch`（読み取り専用）は通る
- **Windows側（AI OSI URI Deploy MCP）にも git バイナリが無い**ため `github_clone` / `github_push` も使えない（`spawnSync git ENOENT` で失敗する。毎回試す必要はない）
- **確実に反映できる方法**: `github_put_files`（Git Data API 経由でファイル内容を直接コミット）
  - ただし、大きな文字列をツール呼び出しに書き出す際、まれに1文字程度の転記ミスが起きる（体感4000バイト前後で数回に1回程度）。base64/UTF-8どちらでも起こりうる
  - フルファイルでなく**小さい diff（差分）** + 一時的な GitHub Actions ワークフロー（`git apply` で適用 → 自動コミット → ワークフロー自身を削除）という形で反映するのが安全
  - **push のたびに必ず** `git fetch origin main -q && git show origin/main:<path> | diff - <ローカルの元ファイル>` で完全一致を確認する（バイト数だけの比較は同じ長さの破損を見逃すことがあるため不可）
  - 不一致が見つかったら、その断片だけをより小さく分割して再送する（1000バイト前後まで小さくすると検出・再送コストが下がる）
  - 一時ワークフローは `on: push: paths:` に専用マーカーファイル（例: `.buildtmp/xxx/GO.marker`）を指定してトリガーし、適用ジョブの最後に**自分自身のワークフローファイルを削除するステップ**を必ず含める。これを忘れると、以後の無関係な push のたびに「ジョブなしで失敗」の通知メールが送られ続ける
- Vercel は GitHub 連携済みなので、上記の方法で main に push すれば自動でビルド・本番反映される（`vercel_redeploy` を別途呼ぶ必要は基本的にない）

## セッション開始時と本番反映の手順（2026-10-05 追記）

- **作業を始める前に、ユーザーへ「入力欄の横のモードが Accept edits になっているか」を確認してもらう**。
  新しいセッションは Auto モードで始まることがあり、Auto では「main に push する一時ワークフローを置く」
  操作が自動審査で止められる（2026-10-05 に発生。Accept edits に切り替えたら同じ手順で通った）
- よく使う MCP 操作（github_put_files / github_get_file / vercel の確認・ログ・再デプロイ）は
  `.claude/settings.json` の `permissions.allow` で事前許可している。承認ボタンが出た場合は、この設定が
  読み込まれていない可能性があるので、ユーザーにその旨を伝える
- 承認の回数を減らすため、反映は **github_put_files 1回** にまとめる：分割した差分（chunks）と一時ワークフローを
  同じコミットで置き、ワークフローの `on: push: paths:` には**ワークフローファイル自身のパス**を指定する
  （GO.marker を別コミットで置く必要がない）。ワークフローの最後で自分自身と `.buildtmp` を削除する
- 反映後の確認（`git fetch` → `git show origin/main:<path>` と diff、vercel_get_project →
  vercel_get_deployment_status で SHA 一致と READY）は読み取りのみ
- Vercel のビルドが `next/font/google` の取得失敗で ERROR になることがある（今回の修正とは無関係の一時的な失敗）。
  その場合は vercel_redeploy（repo_id 1358086007, ref main）で再ビルドすると通った

## 反映の手順（2026-10-13 追記・Mac から）

- サンドボックスの `git push` は通らないが、**Mac 側の AI OSI URI Deploy MCP には git があり `github_clone` / `github_push` が通る**（Windows 側の「git が無い」注意は Mac には当てはまらない）
- 手順: `github_clone`（dest は連結フォルダ内、例 Drive の `99.個人用作業フォルダ/_airex-creative-work`）→ サンドボックスで `git diff --binary <base> HEAD > patch` → `device_commit_files` で転送 → `device_bash` で `git apply`（`unable to unlink` の warning は無視してよい。削除権限が無いだけで内容は書き換わる）→ 転送した patch は `mv -n` で `.git/` 配下へ退避 → `github_push`
- 反映前に、`git diff | sha256sum` と `git ls-files --others --exclude-standard | sort | xargs sha256sum | sha256sum` を両側で突き合わせて完全一致を確認する（転記ミスが起きない方法なので、`github_put_files` より安全）
- 反映後は `git fetch origin main && git diff HEAD origin/main` が空であることを確認する

## DB マイグレーションの CI（2026-10-14 追記）

- `Docs/sql/*.sql` は main への push で `.github/workflows/db-migrate.yml` が Supabase に自動適用する（適用済みは `public.schema_migrations_docs` に記録して二度流さない）。手で SQL Editor に貼る必要はない
- 必要な Secret（リポジトリの Settings → Secrets and variables → Actions）はどちらか一方:
  - `SUPABASE_DB_URL` … Supabase → Connect → Session pooler の URI（パスワード入り）。優先して使われる
  - `SUPABASE_ACCESS_TOKEN` … Supabase のアカウント → Access Tokens（Management API で実行）
  - どちらも未設定だとワークフローはエラーで止まる（本番には何もしない）
- 適用中に失敗した SQL は記録されないので、直して push すれば次回そのファイルから再実行される
- SQL は従来どおり冪等に書く。CI 導入前に手で流したファイルは `Docs/sql/APPLIED_BASELINE.txt` に列挙してあり、初回に適用済み扱いになる
- 本番 Supabase は ai-rex2 の Org（`vcvdmpyzqybovdgefmmj`）の project ref `quetqiaqobcdtjhbpqek`。Deploy MCP の Supabase PAT からは見えない

## アプリの CI（2026-10-14 追記）

- `.github/workflows/ci.yml` が push / PR ごとに `tsc --noEmit` と `next build` を通す（落ちたら赤）。lint は既存の過去分エラーがあるため報告のみ
- デプロイは従来どおり Vercel の GitHub 連携（main への push で本番反映）

## MEO の「やること」キット（2026-10-14 追記・オルコネレックスから移植）

- 元は `ai-osi-uri/orcone-rex-beauty`（理美容）・`orcone-rex-food`（飲食）。MEO の見せ方と中身をオルコネに寄せる方針
- `lib/meo-ops/kit/` … 工程（steps.ts）・「やること」（plan.ts）・保存と「今の数字」（store.ts）・自動で回す（auto.ts）
- 画面：店舗ホーム（`/stores/[id]`）の上部が `components/meo/kit/KitHome.tsx`。タブ「自動で回す」（`/stores/[id]/auto`）、店頭QRの口コミ画面（`/review`、ログイン不要）
- 1 工程 = 1 回の Server Action（`runKitStepAction`）で、工程ごとに `meo_kit_steps` に保存する
- 自動で回す（`/api/cron/meo-auto`、毎日 10:00 JST）は既定オフ。星の基準と言葉のチェックを満たす返信・投稿だけ送り、それ以外は `meo_auto_log` の確認待ち。外部 API は `AutoDeps` で差し替えて検証できる
- 業種の書き分け：industry=beauty → 理美容、Google の業種が飲食 → 飲食、それ以外 → 一般（`kindOf`）

## AIO の「運用」（記事づくり・公開・効果と改善）（2026-10-15 追記）

- 画面は `/aio/[id]?tab=site|note|results|ai`。既定は「自社サイト記事」（運用をメインにする方針）。旧来の実測・プロンプト・計画は `tab=ai`
- 流れ：既存記事のトンマナ分析（`lib/aio/style.ts`。WordPress REST → RSS → 一覧のリンク／note は RSS）→ 記事（`lib/aio/article.ts`）→ 表現チェック＋画像（`lib/aio/images.ts`）→ WordPress は「承認して公開」だけ（`lib/aio/publish.ts`・`wordpress.ts`）／note は貼る形でコピーして人が投稿 → 数字（GSC・GA4＝`fetchPageMetrics`、note＝手入力・CSV）→ 改善案（`lib/aio/review.ts`）
- 記事づくりは 2 つの Action（`createAioArticleAction` で本文を保存 → `finishAioArticleAction` で表現チェックと未生成の画像だけ）。画像は 1 枚ごとに保存、WordPress へは画像 1 枚ごと・投稿 ID を都度保存して二重投稿しない
- 画像は Gemini（`GEMINI_IMAGE_MODEL`、既定 gemini-2.5-flash-image）。文字を描かせず、できた画像を AI に見せて文字があれば作り直し、2 回とも文字入りなら使わない。置き場は非公開バケット `aio-images`（画面は署名 URL）
- WordPress のアプリケーションパスワードは `aio_wp_connections`（本人のセッションからは読めない表）に `sealToken` で暗号化して保存。`AD_TOKEN_ENC_KEY` が無いと連携できない
- note の非公式 API は使わない（投稿は人。数字は手入力・貼り付け）

## SNS運用（媒体ごとの運用）（2026-10-16 追記）

- 左メニュー「SNS運用」の下に X運用／Instagram運用／TikTok運用／YouTube運用（`/sns/[platform]`）。X は `components/sns/ops/XOps.tsx`、ほかの3つは `MediaOps.tsx`
- 各社のアプリの鍵：`sns_app_credentials`（本人のセッションから読めない表・`sealToken` で暗号化）。連携・トークン更新は自社の鍵 → 無ければ共通の鍵（環境変数）。`sns_connections.app_client_id` で、どの鍵で発行したかを覚える（`lib/social-connect/app-creds.ts`）
- X 運用の工程（`lib/sns-ops/x-run.ts`）：集める（Apify。`claim_sns_apify_call` で1ユーザー1日6回まで）→ 自分の投稿の数字（X API）→ 型の分析 → 投稿案（画像・スレッド）→ 画像 → 反応の候補 → DM の返信案。毎日の自動は `/api/cron/sns-ops`（30分おき）で、`sns_daily_runs` に工程ごとの済み印。2回失敗した工程はその日はやめる
- 送るのは承認した案だけ（`approveOpsPostsAction`）。スレッドは投稿1つごとに `external_ids` を保存し、続きから送る（`lib/sns-ops/x-publish.ts`）
- X の規約（2026-02-23〜）：他人の投稿への API のリプライ・引用は、相手がこちらをメンション／こちらの投稿への返信のときだけ。それ以外は X の投稿画面（`xIntentUrl`）を開いて人が送る
- 運用の案は `sns_posts` の `source` が `ops`／`ops_auto`。旧来の「媒体ごとの文面をまとめて作る」（`/sns`）は `manual`／`auto` だけを表示する

## 動画づくりと Instagram・TikTok・YouTube の運用（2026-10-17 追記）

- 動画は `sns_videos`（台本＝場面ごとのナレーション・テロップ・素材 or AI 画像）。ショート（縦 1080×1920・20〜30秒。TikTok・リール・YouTube ショート）と長尺（横 1280×720・10〜20分。YouTube。章立て → 章ごとの場面）
- 準備（`prepareVideo`）：長尺の残りの章 → 素材の無い場面の AI 画像 → ナレーション（Gemini TTS。`GEMINI_TTS_MODEL`）。1つできるごとに保存し、済んだものは作らない。画面は ready まで `prepareVideoAction` を繰り返す
- 書き出しはブラウザ（`components/sns/ops/render-video.ts`。WebCodecs＋mp4-muxer）。テロップは canvas で組む（画像生成モデルに文字を描かせない）。Instagram・TikTok は H.264＋AAC 必須（strict。Mac/Windows の Chrome）、YouTube は VP9／Opus でも可（relaxed）。アップロードは TUS（署名つき・x-signature）
- 送信（`publishVideo`）：YouTube はアップロード先、TikTok は publish_id、Instagram はコンテナ ID を `publish_state` に先に保存し、やり直しは続きから（二重投稿しない）。TikTok の公開範囲は人が選ぶ（監査前のアプリは SELF_ONLY だけ）。AI 生成の申告を付ける
- 素材（`sns_materials`）：自社のビジネスプロフィールの写真（Google マップに第三者が投稿した写真は使わない）・自分の X／Instagram の投稿・アップロード・事実のメモ・AI 写真。取り込みは各社の配信元のホストだけ許可
- Instagram の投稿・コメント・DM、YouTube のコメントは `sns_posts`（platform は meta／youtube）。送るのは `sendApprovedMedia`（承認済みだけ）。TikTok はコメント・DM の API が無いので扱わない
- 検証は外部 API を差し替えて行う（`creds`／`fetch`／`wait` を引数で渡せる）。書き出しは Playwright の Chromium で VP9＋Opus の経路を確かめた（H.264／AAC は Chromium に無いので Chrome で確認する）

## SEO運用（2026-10-21 追記）

- 左メニュー「SEO運用」（`/seo`・`/seo/[id]?tab=site|satellite|internal|results`）。対象は AIO と同じ `aio_projects` を共有する
- 自社サイト記事は AIO から移設（`/aio/[id]?tab=site` は `/seo` へ転送）。AIO のタブは note／PR TIMES／内部対策／効果と改善／AIでの見え方
- サテライトサイト：`aio_channels.kind='satellite'`（設定は `satellite` 列）、WordPress は `aio_wp_satellite_connections`（自社サイトとは別の接続。同じドメインは連携させない）。記事に書けるのは「扱う商品・サービス」に人が入れた事実だけ（`SATELLITE_RULES`）。公開時に運営者・PR の表記と、運営者側のドメインへのリンクの `rel="sponsored"` をコードで入れる（`lib/aio/satellite.ts`。AI に書かせない）。運営者の表記が無いと送れない
- サテライトの比較・ランキング（2026-10-21）：商品ごとに任意の `affiliateUrl`、全体に任意の `rankingBasis`。記事は全商品の比較表とランキングを入れ、順位は基準と入力された事実だけで付ける（No.1 等の最上級は使わない）。アフィリエイトリンクは AI に書かせず、公開時に公式サイトへのリンクを差し替えて `rel="sponsored"` と広告の表記を付ける（`affiliateFor`）
- 事実の収集（`lib/aio/satellite-facts.ts`・`collectSatelliteFactsAction`）：公式サイトのトップ＋料金・機能・会社概要などのページ最大5件を読み、AI で書かれている事実だけを出典つきで抜き出す。Gemini（検索つき）で公式以外の公開情報を補う（根拠の出典が無い回答は捨てる）。結果は「記事に書いてよい事実」に入り人が直せる。画面は1件ずつ順に呼ぶ（設定の同時書き込みを避ける）。外部は `FactDeps` で差し替えて検証できる
- 比較表の下調べ（`lib/aio/comparison.ts`・`startComparisonAction`／`researchComparisonRowAction`／`saveComparisonAction`）：サテライトの記事は書く前に、テーマから比較項目を決め（AI 1回）、各社の公式サイト（トップ＋会社概要・料金・機能・実績・FAQ・サポートを種類ごとに1ページ）から表の形で抜き出し、空いた項目だけ検索で補う。AI は Gemini 3.1 Flash-Lite（使えなければ Claude Haiku）。表は `aio_comparisons`／行は `aio_comparison_rows`（1社1行・工程ごとに保存・status pending→site→done で済んだ工程は飛ばす）、読んだ本文は `aio_site_cache`（5日）。人が表を直してから `createAioArticleAction(..., comparisonId)` で書く。月の上限は記事上限の2倍
- 内部対策：`seo_internal_tasks`（SEO と AIO で1つのリスト。`scope` = seo|aio|both で各タブに絞って出す）。洗い出しはサイト・robots.txt・llms.txt の読み取りと、同じドメインの URL レポートの指摘の取り込みだけで AI は呼ばない（`lib/seo/internal.ts`）。key で1件にまとめ、利用者の状態は上書きしない。サイトの読み取りで出した施策が次の読み取りで消えたら「済み」にする
- 対策キーワード（`/seo/[id]?tab=keywords`、既定のタブ）：`seo_keywords`。全体レポートの対策キーワード・SEO記事設計の取り込みと Search Console の反映（`fetchGscQueries`。直近28日・最大1000語。推移は `gsc` に最大12件）は AI なし。月間検索数は AI の推定（5段階・`volume_source`=report|ai）で、まだ推定していない語だけ1回で推定する。記事は `createAioArticleAction(..., keywordId)` で語に結び付け（`article_ids`）、WordPress で公開したら語を「公開済み」にする。1語に記事が2本以上なら警告（カニバリゼーション）
