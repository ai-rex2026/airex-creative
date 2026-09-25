# MEO運用ワークスペース

AI-REX 本体（ad-optimizer / ad-optimizer-backend）の MEO 運用機能を、Studio（Next.js + Supabase）へ移植したもの。

- スキーマ: [schema.sql](schema.sql)（Supabase に適用済み。追加のみで既存データには触れない）
- 画面: `app/analysis/[id]/meo/*`（ホーム・クチコミ・投稿・プロフィール・写真・分析・AI検索・設定）
- サーバー処理: `app/meo-actions.ts` と `lib/meo-ops/*`
- 定期実行: `/api/cron/meo-daily`（日次スナップショット 4:05 JST）、`/api/cron/meo-ai-search`（AI検索の取りこぼし回収）

## 本体との違い

| 本体 | Studio |
|---|---|
| Firestore のサブコレクション（analyses/{id}/meo_*） | Supabase のテーブル（analysis_id で紐付け、RLS で本人だけ） |
| Python バックエンド（/api/meo）と Cloud Functions | Server Action と after()、Vercel Cron |
| AI検索は Gemini 既定・Claude 代替 | Claude（web検索）で実測（Gemini のキーが無いため） |
| AI返信・投稿文はモック | Claude で生成し、生成と同時に法令チェックを通す |
| GBP 連携（クチコミ同期・返信送信・投稿配信・月次指標） | フェーズ2で移植（Google の Business Profile API 承認が前提） |
