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
