-- 口コミを Google から最後に取り込んだ時刻（店舗ホームの「口コミ最終取り込み」）。冪等。
alter table public.stores add column if not exists meo_reviews_synced_at timestamptz;
