<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# このリポジトリの決めごと

- **日本語の文字を画像生成モデルに描かせない**（字形が崩れ、量産の再現性が無くなる）。バナーは DOM で組む
- **法令チェックは生成と同時に通す**。事後検知は仕様違反
- **自動入稿・自動予算変更はしない**。出稿は人が承認する
- 効果・成果の断定表現をプロダクトのコピーにも使わない（自社LPも景表法の対象）
