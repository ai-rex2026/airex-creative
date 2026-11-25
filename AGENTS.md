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
- note 記事の推敲（2026-10-27・`lib/aio/humanize.ts`・`polishAioArticleAction`）：書いた直後に、AIっぽさを消す8工程（バレ箇所→語尾→まとめすぎ→前置き→体験の一言→文のリズム→日常語→読者目線の検品）を1回の AI 呼び出しで順にかけ、本文を保存してから表現チェックをかけ直す。体験の一言の金額・失敗は与えられた事実だけで、無ければ【要記入：…】を置き人が埋める（コピー時に注意を出す）。短すぎ・見出しが消えた結果は捨てて下書きのまま。記事のカードの「推敲し直す」で何度でも
- note の参考にする人気記事（2026-10-27・`lib/aio/note-refs.ts`・`/api/cron/aio-note-refs` 毎日 3:20 JST）：前回から7日たった対象だけ、テーマ決め（AI 1回）→ テーマごとに Web 検索で note.com の記事 URL を探す（まず Gemini の Google 検索。出典の中継 URL は1回だけ問い合わせて転送先＝記事 URL にする。取れなければ Claude の Web 検索）→ 記事の公開ページを1本ずつ読み、埋め込みの `likeCount`（その記事の key の後ろの最初のもの）・見出し・冒頭を `aio_note_refs` に保存。note の `/search` と `/api` は robots.txt で禁止なので読まない（記事ページ `/:user/n/:key` は許可）。人が貼った URL は source=manual。検索済みの URL は pending で残り、検索はやり直さない。記事を書くとき、manual → スキの多い順に最大6本を「切り口・見出しの型」の参考として渡す（文章はまねない）。検索で見つけた記事は対象ごとにスキの多い順に60本だけ残す（manual は消さない）

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
- 比較表の下調べ（`lib/aio/comparison.ts`・`startComparisonAction`／`researchComparisonRowAction`／`saveComparisonAction`）：サテライトの記事は書く前に、テーマから比較項目を決め（AI 1回）、各社の公式サイト（トップ＋会社概要・料金・機能・実績・FAQ・サポートを種類ごとに1ページ）から表の形で抜き出し、空いた項目だけ検索で補う。AI は Gemini 3.1 Flash-Lite（使えなければ Claude Haiku）。表は `aio_comparisons`／行は `aio_comparison_rows`（1社1行・工程ごとに保存・status pending→site→done で済んだ工程は飛ばす）、読んだ本文は `aio_site_cache`（5日）。人が表を直してから `createAioArticleAction(..., comparisonId)` で書く。月の上限は記事上限の2倍。検索は Gemini → 出典が無ければ「必ず検索」で1回再試行 → それでも無ければ Claude Haiku の Web 検索（`searchFallback`。citations を出典にする）。半分以上の会社で空欄の項目は確認画面で既定で外し、外した項目は `aio_comparisons.columns` から除いて記事に出さない
- 2026-10-22：検索で出典が取れなかった値も `via=ai`（画面で「要確認」）として表に入れる（人が確かめる前提）。事業内容は記事のテーマに関わる事業だけを抜き出す。`AioSatellite.ownFirst`（既定オン）で運営者の商品をランキング1位に置き、「当メディアのおすすめ順」と書いて冒頭の PR 表記に1位が運営者の商品である旨をコードで入れる（`satelliteRules(ownFirst)`・`disclosureText`）
- 内部対策：`seo_internal_tasks`（SEO と AIO で1つのリスト。`scope` = seo|aio|both で各タブに絞って出す）。洗い出しはサイト・robots.txt・llms.txt の読み取りと、同じドメインの URL レポートの指摘の取り込みだけで AI は呼ばない（`lib/seo/internal.ts`）。key で1件にまとめ、利用者の状態は上書きしない。サイトの読み取りで出した施策が次の読み取りで消えたら「済み」にする
- 対策キーワード（`/seo/[id]?tab=keywords`、既定のタブ）：`seo_keywords`。全体レポートの対策キーワード・SEO記事設計の取り込みと Search Console の反映（`fetchGscQueries`。直近28日・最大1000語。推移は `gsc` に最大12件）は AI なし。月間検索数は AI の推定（5段階・`volume_source`=report|ai）で、まだ推定していない語だけ1回で推定する。記事は `createAioArticleAction(..., keywordId)` で語に結び付け（`article_ids`）、WordPress で公開したら語を「公開済み」にする。1語に記事が2本以上なら警告（カニバリゼーション）
- 内部リンクの提案（2026-10-27、`/seo/[id]?tab=links`）：`lib/seo/links/`。記事収集（サイトマップ→1ページずつ。`seo_link_pages`）→ 候補の絞り込み（文字2-gram の TF-IDF と類似度。AI なし）→ 「本当にリンクすべきか」だけを AI が判定（`Judge` を差し替え可能。いまは Claude Haiku。Jev は未導入）。`seo_link_suggestions` の status は pending→suggested|rejected、人の操作で accepted|dismissed。保存は1件ごと、保存済みの記事・判定済みの組は飛ばす（再実行で AI を重複して呼ばない）。採用基準は確率 0.7 以上かつ確信度 0.6 以上（AI の自己申告で較正されていない）。本文は自動で書き換えない（設置は人）。検証は `collect`／`html`／`Judge` を差し替えて行う

## 出稿中の広告（公開情報）の表示（2026-11-07 追記）

- `components/PublicAdsSection.tsx`：Meta・Google とも、広告が0件でも媒体ごとの欄を出し、理由を書く（Facebook ページが見つからず調べていない／配信中の広告が見つからない／取得に失敗）
- 素材は AI（`readCreatives`）が読んだ内容（何を見せているか・動画の冒頭3秒・素材内の文字）を各広告の下に出す。Meta の素材 URL は数日で切れるので画像は載せず、広告ライブラリへのリンクだけ。Google は表示見本の画像（tpc.googlesyndication.com の保存版）を小さく載せ、広告透明性センターの個別ページ（`PublicGoogleAd.adUrl`）へリンクする。adUrl の無い古い分析はドメインの一覧に飛ばす
- Facebook ページが見つからないとき（2026-11-07）：Instagram の表示名とブランド名（最大2語）で広告ライブラリをキーワード検索する（Apify 1回、`searchQueries`・完全一致）。自社と判断するのは「リンク先が分析したドメイン」か「広告主の Instagram ユーザー名が見つかったアカウントと同じ」広告と、それを出したページの広告だけ（`pickOwnMetaItems`）。`PublicAds.meta.search` に検索語・照合条件を残し、画面に「検索で特定した」旨と、見つからなかった理由を出す
- 取得日時は時刻まで出す（2026-11-09）

## 分析の始め方（2026-11-09 追記）

- 画面の操作（Server Action）から分析を始めるときは `kickAnalysis`（`lib/worker.ts`）。本番では最初のバーストから本番ドメインの `/api/analysis/[id]/continue` に渡す。画面をデプロイ前から開いたままだと Vercel のスキュー保護で Server Action が古いデプロイで動き、1バースト目（出稿中の広告まで進むことが多い）が古いコードで走るため（2026-11-07 に発生）。渡せなかったときだけその場で `processAnalysis` を回す

## AIO「AIでの見え方」の引用率（2026-11-09 追記）

- `lib/aio/prompts.ts` の `summarize`：引用率（`citationRate`）は「AI が回答の根拠に自社サイト（対象の URL のドメイン）を参照した回の割合」で、媒体一覧（`domains`）と同じ `citedSources` から数える。以前の「自社の紹介に根拠 URL が付いた割合（他社媒体でも可）」は `sourcedRate`（画面は「紹介の根拠あり」）と、その根拠の媒体 `ownSourceDomains` に分けた。媒体一覧は上位12に入らなくても自社サイトを必ず出す（参照なしは 0本）。過去の測定結果からの再計算だけで AI は呼ばない

## レポートのチャットでの表示変更と作り直し（2026-11-09 追記）

- `analyses.report_prefs`（`lib/report-sections.ts`）：`hidden`（非表示の章）・`directives`（作り直しの指示、最大10件）・`excludeChannels`（外す広告媒体）
- チャット（`lib/chat.ts`）のツール：`set_sections`（章の表示・非表示。すぐ反映）、`propose_rebuild`（作り直しの提案。チャットに確認ボタンを出すだけで、押すと `rebuildFromChat` が実行）、`clear_directives`。提案は `chat_messages.proposals` に残す
- 非表示は `components/HiddenSections.tsx` が見出し（h2#sec-xxx）から次の見出しの手前までに `data-sec-hidden` を付けて隠す（画面と印刷＝PDF 出力の両方。データは消さない）。章を足したら `REPORT_SECTIONS` にも足す
- 作り直し：ad_plan は media_plan・ad_ops・tactics を消して分析の工程に戻す（5〜10分、待機画面へ）。measures は `regenerateSummaryTab`（1〜2分）。指示は `priorityNoteFor`（業種の優先度と一緒に）と `generateTactics`・`regenerateSummaryTab` に渡り、以後の作り直しにも効く。外す媒体は AI の出力からコードでも外し、配分を100に直す（`applyExcludedChannels`）
- 2026-11-09 追加：章の中の一部分も隠せる（`sub-` で始まる id。公式SNSアカウントの媒体ごとの欄 `sub-sns-<媒体>`・SNSキャンペーン案 `sub-snscampaign`・LINEプラン `sub-line`）。要素の id をそのまま隠す
- AIO の照合する名前はチャットの `set_aio_names` で置き換え、保存済みの回答（`prompts[].listed`）に `findOwnRank` で照合し直す（AI は呼ばない）。所見と施策は `propose_rebuild` の target=aio（`analyzeAio`、AI 1回）で書き直す
- MEO は画面では選んだ店舗だけ、PDF（印刷）では全店舗の詳細と店舗ごとのやることを順に出す（`.print-only`・`.no-print`）

## LPO運用（2026-11-11 追記）

- 左メニュー「LPO運用」（`/lpo`・`/lpo/[id]?tab=lp|speed|heatmap|results`）。表は `lpo_projects`（LP ごと。`plan`＝LP改善・`plan_done`＝済みの key・`speed`／`speed_history`＝表示速度と推移）、`lpo_heatmaps`、`lpo_clarity`（本人のセッションから読めない表・`sealToken`）。SQL は `Docs/sql/2026-11-11-lpo-ops.sql`、画像は非公開バケット `lpo-heatmaps`
- 登録：分析レポートから取り込む（`createLpoFromAnalysisAction`。そのレポートの LP改善・表示速度を引き継ぎ、AI・計測なし。レポートの LP改善の章にも入口のボタン）か、URL から（`buildLpoAction`：サイトの読み取り → 何を売っているか → LP改善を工程ごとに保存し、済んだ工程は飛ばす。速度は `measureSpeedAction`＝PageSpeed Insights）
- LP改善の指摘への辞書チェック（2026-11-18・`lib/lpo-guard.ts`）：`generateLpo` が出した指摘を、生成と同時に法令チェックの辞書（`checkGuardDict`。承認済みの法令ルール込み）に通し、引っかかった指摘には `LpoItem.caution`（注意文）を付ける。指摘は消さない（「症例写真を載せる」は助言として自然でも、医療広告の制限がある語のため注意を出す）。AI は呼ばない。実測のグループ（セキュリティ・表示速度）は対象外。辞書の読み込みに失敗しても指摘は返す。画面は LPO運用の「LP改善」と、レポートの LP改善の章の両方に出す。以前に保存した計画には注意は付かない（作り直すと付く）
- ヒートマップ（`lib/lpo-ops/`）：Microsoft Clarity の Data Export API（直近3日・1プロジェクト1日10回・URL ごとの指標だけで画像や座標は取れない）を URL で絞って保存 → AI が改善案（`analyzeClarity`）。同じ対象の取得は20時間に1回まで。数字を先に保存してから AI。ほかのツール（Hotjar・Ptengine 等）は画面キャプチャを取り込み、ブラウザで上から順に分割（幅1200px・高さ1800px・最大8枚・合計3.8MB 以下に収まるまで画質と幅を下げる）して Sonnet に読ませる（`analyzeHeatmapImages`）。画像を先に保存し、AI が失敗しても「改善案を作り直す」でやり直せる。検証は `HeatmapDeps`・`fetchClarity` の fetcher を差し替えて行う

## 広告運用 ＞ バナー制作（2026-11-11 追記）

- 左メニュー「広告運用」（`/ads`。媒体との連携は準備中）の下に「バナー制作」（`/ads/banners`・`/ads/banners/[id]`）。表は `banner_projects`・`banner_visuals`、置き場は非公開バケット `banner-assets`（画面は `/api/banner-assets/<本人のID>/...` の同一オリジン経由）。SQL は `Docs/sql/2026-11-11-banner-studio.sql`
- 流れ（`app/banner-actions.ts`）：URL・説明・素材（商品写真・写真・ロゴ、6点まで）→ `prepareBannerAction`（読み取り `diagnose` → コピー `generateCopies`＝法令チェックつき → 絵の基本パターン `planPatterns`＝AI 1回。工程ごとに保存し済みは飛ばす）→ 基本パターンの絵（正方形）→ 媒体のサイズへの展開 → 5秒の動画
- 絵と動画は fal（`lib/banner-studio/fal.ts`。Queue API）。画像 `fal-ai/nano-banana`、素材を使うパターンと縦横比の作り直しは `fal-ai/nano-banana/edit`（`aspect_ratio`）、動画は `fal-ai/kling-video/v2.1/standard/image-to-video`（5秒）。送った時点で `request_id` 等を `banner_visuals` に保存し、画面からの `pollBannerAction`（6秒おき）で取り込む（Vercel の実行時間に収める）。30分たっても終わらない依頼はエラーにする。月の上限は `MONTHLY_LIMIT`
- 絵には文字を描かせない（プロンプトで禁止＋取り込み時に `detectText` で確認し、入っていそうなら注意を出す）。コピーは `components/Banner.tsx`（DOM）で重ね、PNG／ZIP は html-to-image で書き出す。動画は文字なしで作り、ブラウザで canvas に重ねて H.264 の MP4 にする（`components/banner-studio/render-banner-video.ts`。音声なし）
- サイズは `BANNER_SIZES`（Meta・Google・Yahoo!・LINE・TikTok・X）。各サイズに近い fal の縦横比（`nearestAspect`）の絵を使い、無ければ作り直す（「切り抜きだけ」なら fal を使わない）
- `FAL_KEY`（Vercel の環境変数）が無いと絵と動画は作れない（コピーとパターンは作れる）。検証は `FalDeps`・`PatternDeps` を差し替えて行う
- 自動入稿はしない（書き出したファイルを人が各媒体に入稿する）
- 2026-11-12 品質改善：成果の出るバナーの共通点（Google・LINEヤフーの公式ガイド、事例分析）を反映。`planPatterns` は訴求の型（`ARCHETYPES`：商品主役＋特典／問いかけ／数字を大きく／実績・信頼／利用シーン／文字が主役）・主役の位置（`subject`）・パターン専用のコピー（`PatternCopy`：対象・見出し・強調・補足・CTA）まで AI 1回で決め、`guardPatterns` で作ったその場で法令チェックする。強調の数字は説明・強みに書かれていない数字なら消し、数字・実績の型は利用シーンに落とす。絵の指示には構図（主役を左右に寄せ反対側45%を空ける／縦長は上に主役・下45%を空ける）をコードで足す（`imagePrompt`・`reframePrompt(p, aspect)`）
- バナーは `components/banner-studio/StudioBanner.tsx`（2026-11-12 夜：写真と文字の面を分ける6レイアウト `BannerLayout`＝左右分割（横長だけ。正方形の絵を丸ごと見せる）・上下分割（正方形・縦長。横に広い帯は2列）・写真に文字カード（バナーと同じ縦横比の絵があるときだけ。無ければ分割に切り替え）・文字が主役。`resolveLayout` が型とサイズから自動で選び、画面で絵ごとに指定もできる。絵は主役を中央やや上・周りに余白で作るので、どのレイアウトでも余白だけが切れる。fal の作り直しは文字カードを縦長・横長で使うときだけ。旧：主役と反対側に白い面を置いて文字を組む・小さいサイズは見出しと CTA だけ・面の高さに収まるよう全体を縮める・ロゴ素材は左上・外枠に細線・CTA だけブランド色の反対色で白文字のコントラスト 4.5 以上 `palette`）。コピーは既定がパターン専用（法令チェック NG のパターンは候補コピーに切り替わる）
- 文字の背景（2026-11-12 夜・`TextStyle`）：白い面／ブランド色を薄く／半透明の白（写真を透かす）／ブランド色の面／ブランド色のグラデーション／濃い墨の面／写真をぼかして暗く／写真に直接（下を暗く。カード・文字が主役のときだけ、ほかは写真ぼかし）の8種類。`resolveStyle` が型から自動で選び、画面で絵ごとに指定もできる。半透明・ぼかしは写真を拡大してぼかした背景（CSS `filter: blur`）の上に敷く。ブランド色の面では CTA を白地にブランド色の文字に反転する。対象（target）は帯（座布団）にして見せる。根拠：Google・LINEヤフー公式、NN/g の文字と写真の重ね方（暗幕・ぼかし・半透明の箱・色と配置）、広告の A/B 比較（文字入りが CPC 20〜32%低い・デザイン加工した素材が ROAS 26%高い等。商材で勝ちパターンが逆転する例もあり、型と背景を変えて比べる前提）
- AI チェック（`lib/banner-studio/review.ts`・`reviewBannerAction`）：表示中のバナーを縮小 PNG（長辺 1000px）にして Sonnet に見せ、9観点の ok/NG・点数・直し方を `banner_projects.reviews`（key は `${絵のID}:${サイズのID}`）に保存。1枚 AI 1回、月 `REVIEW_MONTHLY_LIMIT` 回まで。検証は `ReviewDeps` を差し替えて行う。SQL は `Docs/sql/2026-11-12-banner-reviews.sql`

## AIO：Google 検索の「AI による概要」（2026-11-13 追記）

- Gemini の測定と同じタイミング（手動・月次）で、プロンプトごとの検索語（`aio_prompts.search_query`）を Google で検索し、「AI による概要」を `aio_checks.overview`（`overview_status` = none|pending|running|done|failed）に保存する（`lib/aio/overview.ts`）。Google に公式 API は無いので DataForSEO の SERP（Google Organic Live Advanced・日本／ja・desktop・`load_async_ai_overview: true`）。単価は $0.002＋後読み込みの概要があった回だけ $0.002（無ければ返金）
- 1測定につき DataForSEO は1回だけ：呼ぶ前に overview_status を pending→running に条件つきで更新し、取れた処理だけが呼ぶ。失敗・途中で止まったもの（15分）は failed にして自動では呼び直さない（課金があるため）。Gemini の測定とは別カラムにその場で保存し、片方の失敗でもう片方を捨てない
- 取りこぼしは `/api/cron/aio-pending` が拾う（1回4件まで・関数の時間内に収まる分だけ）
- 検索語は、AI の候補（`suggestPrompts`）と同じ呼び出しで作る。既存の空のものは測定の直前に `ensureSearchQueries`（AI 1回。全部あれば呼ばない）。画面で直せる。定型文の測定は `buildAioQuery`（エリア＋探し方＋おすすめ）
- 自社の言及は本文に名前・別名が出たか（`mentionsOwn`）、引用は出典に自社ドメインが入ったか。集計（`summarize`）は概要の表示率・概要が出た回のうちの言及率／引用率・出典の媒体。AI は呼ばない
- DataForSEO（`DATAFORSEO_LOGIN`/`DATAFORSEO_PASSWORD`）が無いときは overview_status=none で Gemini だけ測る。検証は `OverviewDeps`・`QueryAsk` を差し替えて行う。SQL は `Docs/sql/2026-11-13-aio-overview.sql`
- 2026-11-15：画面（`components/aio/PromptMonitor.tsx`）は「Gemini の回答」「Google の AI による概要」のタブで分け、数字・推移・プロンプト一覧・挙がった事業者・根拠の媒体をタブごとの集計で出す（検索語の編集は Google タブ）。概要は事業者の一覧を返さないので、`summarize` の `ovCompetitors` は Gemini で挙がった事業者名（全期間）と自社名を本文に照合して数える（AI なし）
- 左メニュー（`.side-nav`）は画面の高さに入りきらないとき、メニューだけ縦にスクロールする（2026-11-15）
- 概要の出典の google.com（2026-11-15・`lib/aio/query.ts`）：実測では `/goto?url=…`（Google の転送リンク。転送先は暗号化されて URL から分からない）と `/searchviewer/…`（ビジネスプロフィール＝店舗・場所）。`ovRefKind` で分け、媒体の集計は種類ごとの名前で数える。転送リンクは取得時に同じ SERP の通常の結果とタイトルで照合して実際のサイトに置き換える（`parseOverview`）。自社かどうかはサイトはドメイン、Google のものはタイトルの自社名（`ovRefIsOwn`）。集計は過去の保存分にも同じ判定をかける
- 失敗の対策（2026-11-15）：Gemini は検索を使うかをモデルが決めるため、根拠なしの回答が約1割あった（本番 108 件中 10 件）。`askGemini` は根拠が無ければ「必ず Google 検索」と指示して1回だけやり直す（MEO の AI検索にも効く）。DataForSEO の 40101（Internal SE Server Error。Google 側のエラーで全額返金）は `isRefundedError` で見分け、`overview_status` を pending に戻して cron が時間を置いて呼び直す（`overview.attempts`、合計3回まで）。返金がはっきりしないエラーは呼び直さない
- 2026-11-16：修正後の測定（クラッセ歯科・10本）でも、地域を細かく絞った問い（「御影で〜」「東灘区で〜」）2本が「必ず検索」のやり直しでも検索しなかった。やり直しは質問文にも「Google 検索で調べて実在の名前と出典を」と添え、それでも根拠が無いとき（`GeminiUngroundedError`）は `ask()` が Claude の Web 検索で測り直す（engine=claude・`error_message` に理由。その回だけ費用は Gemini の約10倍）。検証は `ask(q, deadline, { gemini, claude })` の差し替えで行う
- 実測の進み方（2026-11-16）：10本の実測が1件ずつ順に回り30〜40分かかり、概要は実測に時間を取られて回らず、画面も読み直さないので「クルクル」が残っていた。`runCheck` も pending→running を条件つきで取り（`started_at`）、画面からはその場で実測6本＋概要全部を同時に、`/api/cron/aio-pending`（5分おき）は実測6本・概要12本を同時に回す。止まった判定は始めてから6分（`started_at`・`overview_started_at`。SQL は `Docs/sql/2026-11-16-aio-started-at.sql`）。画面は取得中のあいだ20秒おきに読み直し、「順番待ち」（pending）と「確認中・取得中」（running）を分けて出す
- 集計の数え方（2026-11-16）：同じ月に同じプロンプトを何度も測ったときは、プロンプトごとに最後の1回だけを数える（`latestPerPrompt`。Gemini は最後に完了した回、概要は最後に取れた回）。以前は月内の全回を合計していたため、測り直すほど本数・言及回数・出典の本数が増えていた。プロンプトに紐づかない測定は問いの文で見分ける
- ギャップ分析の「アプローチする媒体」（2026-11-16・`lib/aio/gap.ts`）：競合の公式サイトが入ることがあったので、AI に AI が挙げた競合名を渡して「競合・他社の公式サイトは入れない」と指示し、各媒体に type（media|competitor）を付けさせて media だけ残す。自社ドメインもコードで除く。AIO の「AIでの見え方」の見出しの丸数字（①②④⑤）は外した
- 挙がった事業者の一覧（2026-11-16）：自社が2回挙がっていたのに、同じ回数の競合が多く11番目以降に落ちて一覧に出なかった。`topWithOwn` で自社は上位10に入らなくても必ず出し、同じ回数なら自社を先に並べる（Gemini・概要とも）。表記ゆれ（「山之内矯正歯科」と「…クリニック」等）は `sameNameKey` で5文字以上の部分一致を1社にまとめる

## ユーザーのランクとノウハウ更新案の受信箱（2026-11-18 追記）

- ランクは `lib/tier.ts` の `getTier()` だけで判定する（guest < free < paid < admin）。保存は `user_profiles.tier`（本人は読み取りのみ。付け替えは管理者がサービス側で行う）。行が無い登録ユーザーは free、新規登録の既定も free。既存ユーザーは移行時に管理者2名（suzuki@ad-rex.com・yuzukinishi@ai-osi-uri.com）、ほかは paid
- 運用メニューごとの許可は `user_profiles.features`（キーは `MENU_KEYS`）。枠だけで、いまは判定に使っていない。既存ページの `is_anonymous` チェックは順に `getTier()` へ寄せる予定。決済との接続は別
- 管理者専用：`/admin/knowhow`（ノウハウ更新案の判断。非管理者は 404）。表は `knowhow_items`・`knowhow_log`（RLS 方針なし＝サービス側だけ）。Server Action（`app/knowhow-actions.ts`）でも毎回ランクを確認する。法令に関わる案は、公式の出典があり原文確認のチェックを入れたものだけ承認できる。承認してもプロンプト・チェックには自動反映しない
- 2026-11-18：「ゲスト（未登録・匿名）」の判定は `lib/tier-core.ts` の `isGuest(user)` に一本化した（ページ・Server Action・API とも `user.is_anonymous` を直接書かない）。型ガードで、false の側は user が非 null になる。free／paid／admin の区別が要る所は `getTier()`（リクエスト内で結果を使い回す）。`user?.is_anonymous` のまま残している所（Shell・MetaConnect・AuthForm・actions.ts の一部）は、ユーザーが無い場合の扱いが `isGuest` と違うため
- 2026-11-18：運用メニュー（店舗・SEO・AIO・LPO・広告・アフィリエイト・SNS）は有料（と管理者）だけ。無料は全体レポートの作成のみ。入口は各メニューの `layout.tsx`（`components/OpsGate.tsx`。無料には案内を出し、左メニューも出さない＝`Shell`・`MobileNav` の `hideOps`）、Server Action・API は `opsBlocked()`（`lib/tier.ts`）で止める。止めるのは登録済みの無料だけで、ゲストは従来どおり各ページの登録案内へ。**止めていないもの**：全体レポートに使う広告アカウント・SNS・Google の連携（`api/ads|social|gbp`・`ad-actions`・`ad-performance-actions`・`social-actions`・設定ページ）。メニューごとの許可（`user_profiles.features`）に分けるときは `opsBlocked()` を差し替える
- 2026-11-18：承認したノウハウの反映（`lib/knowhow.ts`・`Docs/sql/2026-11-18-knowhow-apply.sql`）。status=approved だけが対象で、「判断待ちに戻す」「却下」で外れる。form=note は `applied_text`（200字まで・承認の前に管理者が直せる・断定語は `checkGuardDict` で弾く）を、領域ごとの AI への指示の末尾に足す＝各モジュールの `askJson` を `withKnowhow(rawAskJson, [領域])` で包んである（meo＝`lib/meo-ops/{writer,keywords,kit/steps}.ts`、seo・aio＝`lib/aio/{article,writer}.ts`・`lib/seoArticles.ts`、lpo＝`lib/lp.ts`・`lib/lpo-ops/heatmap.ts`・`lib/deep.ts` の `generateLpo`（LP改善の指摘。2026-11-18 に足した。それまで抜けていた）、image＝`lib/banner-studio/patterns.ts`）。足す量は最大20件・1500文字（`MAX_NOTES`・`MAX_NOTE_CHARS`。2026-11-18：LPO の承認済みが8件を超え、新しい2件が渡っていなかったため 8→20）。form=legal_rule は `rule`（pattern・reason・law・suggestion）を法令チェックの辞書に足す（`lib/guardrail.ts` の `dictScan`。60秒だけ使い回す。`checkGuard` は先に読み込み、同期の `checkGuardDict` は読み込み済みの分だけ）。DB が読めないときは何も足さない。新しい領域に足すときは、その領域の `askJson` を同じように包む。広告運用は画面ができてから（領域の枠は未追加）
- 2026-11-18：一次情報（公式ページ）の定期取得（`lib/knowhow-sources.ts`＝DB・ネットワーク・AI に触れない純粋な処理、`lib/knowhow-run.ts`＝実行、`/api/cron/knowhow-sources` 毎週月曜 3:40 JST、`Docs/sql/2026-11-18-knowhow-sources.sql`、画面 `/admin/knowhow/sources`）。公式ページを取得し、前回と同じなら何もしない（AI を呼ばない）、初回は基準（ハッシュと本文）だけ保存、変わったら「追加された行」だけを AI（Haiku）に渡して案（`knowhow_items`・pending）にする。1ページごとに保存し、直近6日以内に確認したページと今週2回失敗したページは飛ばす、AI は1回の実行で6件まで。AI が失敗したら基準を更新せず次回同じ差分からやり直す。ページの作り替え（追加行が300超）は案を作らず注意だけ。案の根拠は、登録時に「公式の一次情報」とした URL なら official、そうでなければ vendor。AI の反映文に断定語があれば空にする（管理者が書く）。管理者は画面で公式ページを追加・停止でき、「今すぐ確認」もできる。広告（area=ads）の反映先は 2026-11-19 に つないだ（下の「広告のノウハウ」）。検証は `CheckDeps`（fetchText・draft・guardOk・now）をスタブにして行う（`node --experimental-strip-types` で実行できる）
- 2026-11-19：公式ページの「過去分を含めた全取り込み」（`lib/knowhow-run.ts` の `runKnowhowFullIngest`・`lib/knowhow-sources.ts` の `chunkText`／`ingestStep`／`toFullItems`、画面 `/admin/knowhow/sources` の「過去分を含めて全部取り込む」、`Docs/sql/2026-11-19-knowhow-ingest-all.sql`）。定期取得は差分だけなので、初回に保存した全文（`last_text`）を6000字ずつの小分けにして AI（Haiku）に通し、小分けごとに最大2件の案（判断待ち）にする。管理者のボタンでだけ動き、cron では動かさない。小分けごとに「案 → `full_cursor`」の順に保存し、済んだページは `full_ingested_at` で飛ばす（失敗した小分けだけ次回やり直す）。案の key は `full-<ページ>-<見出しのハッシュ>` で、やり直しても重複しない。基準が無いページは取得して基準も保存する。1回の AI は14回まで（残りは続けて押す）。停止中のページは対象外。目次だけのページ（消費者庁のガイドライン一覧など）は、リンク先の PDF までは読まない。検証は `FullDeps`（`draftFull`・`guardOk`・`now`）と `fetchText` を差し替えて行う。口コミ関連の公式ページ（`gmaps-contribution-policy`・`gbp-review-tips`）を MEO の取得対象に足した

## 法令チェックの辞書：上限と「適用する用途」（2026-11-19 追記）

- 辞書（承認した `legal_rule`）の読み込み上限は 50 → 500（`MAX_LEGAL_RULES`・`lib/knowhow.ts`）。辞書は AI の指示に入らずコードが照合するだけなので、`MAX_NOTES` のような枠の問題は無い。暴走を防ぐ安全弁としてだけ置いている
- ルールの JSON に `scopes`（`GUARD_SCOPES`：reply／description／review_ask／post／lp／banner／article）を足せる。`scopes` の無いルールは今までどおり全検査に当たる。`scopes` つきのルールは、`checkGuardDict`／`checkGuard` の第3引数 `scope` が一致する検査にだけ当たる（`scope` を渡さない呼び出しには当たらない）
- いま `scope` を渡している所：`meo-ops/writer.ts`（返信 reply・説明文 description）、`kit/auto.ts`（自動返信 reply）、`kit/steps.ts` の言葉のチェック（説明文 description・POP／依頼トーク／LINE依頼文 review_ask）。用途つきで当たった分は、まとめての判定に入らないため `stepGuard` で赤に上げる。ほかの用途（post・lp・banner・article）は、そのチェックを通す所に `scope` を足してから使う
- 管理画面 `/admin/knowhow` の辞書ルールの表示に、適用する用途と業種を出す。`rule` に `scopes` を入れるのは今のところ SQL／AI の案で、画面での編集は未対応

## ノウハウ案の「実装の形」と実装待ち（2026-11-19 追記）

- `knowhow_items.form` は `note`（領域の AI への指示）／`legal_rule`（法令チェックの辞書）／`code`（コード＝ロジックで実装するもの）。優先順位は コード ＞ 辞書 ＞ AI 指示（コードで確実に守れるものを AI に頼まない）。SQL は `Docs/sql/2026-11-19-knowhow-impl-form.sql`（`impl_status` = none|todo|done、`impl_note`）
- `form=code` の案は承認しても AI の指示・辞書には何も足さない（`lib/knowhow.ts` は note と legal_rule だけを読む）。承認＝「実装する」という判断で、`impl_status` が todo（実装待ち）になる。画面 `/admin/knowhow` のタブ「実装待ち」に出て、実装したら「実装済みにする」（`markKnowhowImplAction`）。保留・却下・判断待ちに戻すと none に戻る。実装済みのまま承認し直しても done は戻さない
- AI が公式ページから作る案は、いまは note だけ。コードの案は SQL で入れる（form='code'・applied_text=''）か、今後 AI の案づくりに足す
- 実装したら、AGENTS.md への追記と合わせて「実装済みにする」を押す

## AI 指示の枠の拡大・使用状況の表示・AI が「コード」の案を分ける（2026-11-19 追記）

- 領域ごとの AI への指示に足す量の上限は 20件・1500字 → **40件・3500字**（`MAX_NOTES`・`MAX_NOTE_CHARS`）。選び方は `pickNotes`（承認が古い順に、上限に入らない文は飛ばす）で、反映（`knowhowBlock`）と管理画面が同じ関数を使う。上限を変えるときは定数だけ直す
- `/admin/knowhow` の上部に「AIへの指示の枠の使用状況」（MEO／SEO・AIO（記事づくりで共有）／LPO／画像生成の件数・文字数）を出す。上限を超えて AI の指示に足されていない承認済みの案には、カードに「枠に入っていません」と出す。法令の辞書・コードの案は枠に数えない。領域が近づいたら、用途ごとに選ぶ方式（ステップ4）に移る
- 公式ページから AI が作る案（定期取得・全取り込みとも）に `form`（note|code）を足した（`formFields`）。コードで確実に守るべき仕組み（判定・数値の上限・必須の表示・禁止表現の照合など）は code、文章の書き方の指針は note、迷ったら note。code の案は `applied_text` を空にし、実装の要点を `impl_note` に入れて、判断待ちに出す（承認すると実装待ち）。AI が法令の辞書（legal_rule）を作ることは、いまはしない

## 承認済みノウハウのコード化（2026-11-19 追記）

- AI への指示だけに頼らず、コードで確実に守る形にしたもの（実装済み）：
  - バナーの事実照合（`lib/banner-studio/patterns.ts` の `factChecks`）：「今だけ」「いまなら」「限定」「先着」は、説明に期間（日付）か数量（個数・人数）が無ければ赤、「通常価格」「定価」は、説明に販売実績の記載が無ければ赤にして、候補コピーへ切り替える（`BannerPattern.copy.factHits` → `guardPatterns`）。料金「◯円〜」で、説明に別にかかる費用の記載があれば補足に「別途費用あり」を足す。小さいサイズで価格比較を出さない処理は、コピー自体を通さないので別には持たない
  - 記事の見出し直後の要約（`lib/aio/answer-first.ts`）：自社サイト・サテライトの記事を保存する前に、各節の最初の段落が40〜180字（目標は50〜150字）かをコードで検査し、外れた節だけ AI 1回で書き直す（節の本文に書かれていることだけ・失敗したら本文はそのまま・note は対象外）
- MEO（2026-11-19 実装）：①本人確認の状態（`lib/gbp/api.ts` の `getVoiceOfMerchant`／`parseVoiceOfMerchant`。My Business Verifications API の `VoiceOfMerchantState`。読み取りのみ）を、店舗ホームを開くたびに取り（`kitDataAction`・1つ8秒で打ち切り・失敗したら出さない）、認証済み（ok）以外のときだけ、「やること」の先頭に `gbp-verify` を固定で出す（文言は `VERIFY_TEXT`。AI に挙げさせない）。②行動データ（電話・ルート検索・サイトのクリック・表示回数。直近28日と、その前の28日）を `metricNumbers` で「今の数字」に出す（順位への効果は書かない）。**GCP で「My Business Verifications API」の有効化が要る**（無効だと①は黙って出ない。`fetchMetrics` の Performance API は既に使っている）。検証は `parseVoiceOfMerchant`・`metricNumbers`・`buildPlan` の純粋な処理で行った（Google は呼んでいない。実機での確認は、API を有効にした本番で店舗ホームを開いて行う）
- コード化した承認済みの案は `form` を `code`・`impl_status=done` にして、AI の指示の枠から外した（元の文は `applied_text` に残してある）

## ノウハウの「適用する用途」と矛盾チェック（2026-11-19 追記）

- 用途（`lib/knowhow.ts` の `TASKS`・`forTask`）：承認した note は、`knowhow_items.tasks` が空ならその領域のすべての AI 呼び出しに足す（従来どおり）。用途を選んだものは、その用途の `withKnowhow(askJson, areas, task)` にだけ足す。枠の上限（40件・3500字）は用途ごとに数え、管理画面の使用状況も用途ごと。用途を足すときは `TASKS` に足し、その AI 呼び出しの `withKnowhow` に task を渡す。SQL は `Docs/sql/2026-11-19-knowhow-tasks-conflicts.sql`
- 矛盾チェック（`lib/knowhow-conflicts.ts`・`knowhow-conflicts-run.ts`）：新しい案（判断待ち・未確認）を、同じ領域で承認済みの案（AI への指示の文・辞書のルール・コードの案）と AI（Haiku）1回でまとめて照らし、`conflicts` に保存する（SEO と AIO は相互に比べる）。公式ページの取得（定期・全取り込み）のあとに、10件ずつ続けて時間の許す限り全件を確認し（`checkAllPendingConflicts`）、時間切れの残りは管理画面「矛盾チェックがまだの判断待ちの案を、全件確認する」で続ける（処理中は回るマークと説明を出す＝`components/admin/PendingButton.tsx`。確認し直したいときは、判断待ちの `conflict_checked_at` を null に戻す）。同じ AI 呼び出しで、note の案に当てはまる用途も提案し `tasks` に入れる（用途が空の案だけ。承認の画面で変えられる）。矛盾の疑いがある案は、内容を見て「確認した上で採用します」にチェックを入れないと承認できない（Server Action で強制）。AI が失敗したら未確認のまま残り、次回やり直す。判断待ちに戻すとチェックの印は外れる。検証は `detectConflicts` の `ask` を差し替えて行う

## ノウハウ案の見出しに日付を入れない（2026-11-19 追記）

- 案の見出し（`title`）に、原文の更新日（「1月3日：」など）を入れない。更新履歴ページの見出しの日付を AI が拾っていたが、年が抜けたり推測になったりして信頼できないため（`DRAFT_SYSTEM`／`FULL_SYSTEM` の title の指示）。取得日は画面の「出典（◯◯ 取得）」に出る。すでにある案の見出し先頭・末尾の日付は SQL で外した

## 反映する文を AI が空にしない（2026-11-19 追記）

- 公式ページから作る note の案は、`applied_text` を必ず書かせる（`DRAFT_SYSTEM`／`FULL_SYSTEM`）。AI の文が空・断定語を含むときは、`pickApplied`（`lib/knowhow-sources.ts`）が案の「運用への取り入れ方」（proposal）を 200 字以内（長ければ文の区切りで切る）にして、辞書チェックを通ったものを使う。どれも通らなければ空（管理者が書く）。管理者が承認前に直せるのは従来どおり

## 公式ページの取り込みの進み具合・失敗理由の表示（2026-11-19 追記）

- 「今すぐ確認する」「過去分を含めて全部取り込む」は `PendingButton`（回るマークと説明）。全取り込みの結果には、失敗などの理由（`notes` の先頭5件）も出す。失敗した理由は、取得の失敗も案の保存の失敗も、そのページの `last_error` に残して、ページ一覧に赤く出す（理由が空のときも「取得に失敗しました」を入れる）
- 「手動で点検するページ」は、サーバーから自動で取れないページ。全取り込み・定期取得の対象外で、人（またはブラウザを操作できるセッション）が開いて確認し、「点検しました」で記録する。アプリが自分でブラウザを開いて点検する仕組みは無い

## 公式ページの取得：ブラウザ表示（2026-11-19 追記）

- 手動点検（`knowhow_manual_checks`）は廃止し、3ページ（Meta 広告基準・X 広告ポリシー更新履歴・Microsoft Advertising ブログ）を `knowhow_sources`（`fetch_mode='browser'`）に移した。定期取得・「今すぐ確認」・「過去分を含めて全部取り込む」とも、ほかのページと同じ流れで動く（`Docs/sql/2026-11-19-knowhow-browser-fetch.sql`）
- 本文の取り方は `lib/knowhow-render.ts` の `makeFetchText`：`auto`（既定）は普通に取り、失敗か本文200字未満のときだけブラウザ表示に切り替える。`browser` はいつもブラウザ表示。ブラウザ表示は Apify の `apify/website-content-crawler`（playwright:firefox・Apify プロキシ）。AI がブラウザを操作するのではなく、ブラウザで表示された本文を取るだけ（AI を使うのは、従来どおり変わった行を案にする所）
- 有料なので、1日30回（`RENDER_DAILY_MAX`）の上限を fetch の直前の1箇所で `claim_knowhow_render_call` に通す。取れたページの本文は保存して再取得しない。ログイン・同意操作が要るページは取れない
- 検証は `makeFetchText(render, plain)`・`apifyRender(admin, fetch)` を差し替えて行う

- 2026-11-19：「今すぐ確認」（force）は6日の間隔を無視するが、直近30分（`FORCE_SKIP_MIN`）以内に確認したページは飛ばす。以前は毎回全ページを先頭から回したため、一覧の後ろのページ（X 広告ポリシーなど）が1回の実行時間に収まらず、何度押しても届かなかった

## 広告のノウハウの使い道（2026-11-19 追記）

- 広告（area=ads）の承認済み note は、①全体レポートの広告施策案（媒体プラン `lib/media-plan.ts`＝用途 `ads_plan`、キャンペーン構成・原稿 `lib/ad-ops.ts`＝用途 `ads_build`）の AI への指示に足される。②連携した広告アカウントを分析して改善案・施策案を出す AI（画面は今後。作るときは `withKnowhow(askJson, ["ads"], "ads_plan")` で包む）にも同じ文を使う想定
- 公式ページから作る広告の案は、①②の AI への指示として書く（`ADS_FRAME`・`lib/knowhow-run.ts`）：仕様・審査基準・配信ルール・入稿規定の変更が、「改善案・施策案で何を勧めてよいか／避けるか／確認すべき数値や設定」にどう効くかの観点で、applied_text は「〜を提案するときは…」の形。広告の運用自体（入稿・予算変更）は自動で行わない
- 用途は `ads_plan`（媒体・施策案）・`ads_build`（キャンペーン構成・原稿）。tasks が空の文は両方に足される。全体レポートの「広告以外の施策」（`lib/tactics.ts`）は広告の領域には含めない
- 2026-11-19：案の保存で impl_note（not-null）が null になり失敗していた（code と note が1回の upsert に混ざったとき）。note の案も impl_note を空文字で必ず入れる（`formFields`）

## 重複・類似の案を除く（2026-11-20 追記）

- 言い換えで並ぶ案（例：機能性表示食品の届出データベースの更新頻度が6件）を一覧に出さない。判定は AI を使わず、文字2-gram の Dice 係数（`lib/knowhow-dedupe.ts`）：括弧内と「令和◯年◯月」を除いて、見出しが 0.3 以上、または本文が 0.4 以上で似ているとみなす（形が違う note／code は +0.1）。実際の判断待ち58件で、言い換えの重複は見出し 0.30〜1.0、別の案は見出し最大 0.16 だった。初版（本文も 0.28）は、共通の言い回しで別の案を2件、誤って除いた。領域が違う案は比べない
- ①新しい案を保存する前（`dropDuplicates`・定期取得も全取り込みも）：判断待ち・承認・保留・却下のすべての既存案と比べ、似ていれば保存しない（却下した案が言い換えで戻ってこない）。②すでにある判断待ち（`sweepDuplicates`）：より前に作られた案と似ていれば `dup_of` に印を付けて一覧・件数・矛盾チェックから除く。取り込みのあとと「全件確認する」ボタンで走る。消さない（`/admin/knowhow` の下の折りたたみから「一覧に戻す」）。SQL は `Docs/sql/2026-11-20-knowhow-dup.sql`
- 閾値は少ないサンプルで決めた。似ていない案が除かれていたら、戻して閾値（`DUP_THRESHOLD`）を上げる

## 記事の法令チェックのコード化（2026-11-20 追記）

- `lib/aio/article-rules.ts`（`articleRuleHits`・AI なし）を `guardArticle`（`lib/aio/article.ts`）が呼ぶ。医療・歯科：体験談・他院との比較の語は high（赤）、自由診療に費用かリスクの記載が無ければ medium。広告・PR の表記があるのに「第三者として」「中立の立場」等を書くと high。比較・ランキングの記事に時点か出典が無ければ medium。`checkGuard` には scope=article を渡す（`scopes` に article を持つ辞書ルールが効く）
- サテライトの PR 表記のボックスは文字を本文と同じ大きさにした（以前は 0.9em で、周りより小さくしない決まりに反していた）
- 承認済みのノウハウ：医療・歯科の禁止事項と PR 表示の書き方は form=code・実装済みに変更（AI の指示の枠から外した）。他社比較の3要件は、欠点をあげつらう書き方・グレードの違うものの比較をコードで判定できないため、AI への指示に残し、出典と時点の有無だけコードで見る
- 第三者の情報の収集（`/admin/knowhow/web`）：1回の調べ物から作る案の上限 `MAX_ITEMS_PER_UNIT` は 8 件。広告の案も公式ページを必須にしない（公式を含まない案には確認を促す注意書き）。ノウハウの枠は 80 件・7000 文字

## AIO：手動実測の上限（2026-11-24）

- `AIO_MONTHLY_LIMIT` は対象ごと・月（JST）100本（プロンプト1本＝1回。以前は30）。`quota` は月次の自動計測（source=monthly）と失敗した実測（status=failed）を数えない。費用の目安は1本 約 $0.02〜0.06（Gemini の検索つき回答・抽出・Google の概要）

## 第三者の案：意味の重複・一般論の判定（2026-11-25 追記）

- 文字の重なり（`lib/knowhow-dedupe.ts`）は、言い回しが違う同じ内容・領域をまたぐ同じ内容を見逃す（承認済みにも、SEO と AIO の「派生キーワード／クエリファンアウト」などが残った）。そのため、第三者の案（`runWebScan`）は、文字の重なりで除いた後に、AI（Haiku）1回で「意味が同じ（台帳の案・同じ入力の前の案）」と「一般論」を判定して除く（`lib/knowhow-judge.ts`・`WebDeps.judge`）。台帳は全領域（同じ領域は本文つき、ほかは見出しだけ。却下済みも含めて戻ってこないようにする）。AI が失敗したら除かずに保存し、実行の結果に「判定ができなかった」と出す。除いた案は、実行の結果に理由つきで出る
- 一般論の基準：どの業界・運用でも言える心得で、具体的な数値・条件・手順・仕様の変更・対象が無いもの。案を作る指示（`DRAFT_SYSTEM`）にも同じ基準を入れた。迷ったら除かない。公式ページから作る案（`knowhow-run.ts`）にはまだ付けていない
- 承認済みの案には、さかのぼっては効かない（管理者が見直す）。検証は `judgeItems` の `ask` を差し替えて行う
