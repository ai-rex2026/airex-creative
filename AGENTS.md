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
