-- 2026-10-06: 連携した広告アカウントの実績分析（lib/ad-review.ts）の保存先。
-- 本番（quetqiaqobcdtjhbpqek）には適用済み。
alter table public.analyses add column if not exists ad_review jsonb;
