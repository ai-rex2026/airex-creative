<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# このリポジトリの決めごと

- **日本語の文字を画像生成モデルに描かせない**（字形が崩れ、量産の再現性が無くなる）。バナーは DOM で組む
- **法令チェックは生成と同時に通す**。事後検知は仕様違反
- **自動入稿・自動予算変更はしない**。出稿は人が承認する
- 効果・成果の断定表現をプロダクトのコピーにも使わない（自社LPも景表法の対象）

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
