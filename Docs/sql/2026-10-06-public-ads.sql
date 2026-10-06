-- 2026-10-06: 公開情報から見た出稿中の広告（lib/public-ads.ts）の保存先。
-- 本番（quetqiaqobcdtjhbpqek）には適用済み。
alter table public.analyses add column if not exists public_ads jsonb;
