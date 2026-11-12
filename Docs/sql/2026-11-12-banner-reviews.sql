-- バナー制作：AI チェック（F）の結果を保存する列（2026-11-12）。何度流しても壊れない。
alter table public.banner_projects add column if not exists reviews jsonb not null default '{}'::jsonb;
