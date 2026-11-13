-- AIO：Google 検索の「AI による概要」も測る（2026-11-13）
-- aio_prompts.search_query … Google で検索する語（空なら測る前に AI が作る）
-- aio_checks.overview_status … none（取らない）/ pending / running / done / failed
-- aio_checks.overview … 取得結果（表示の有無・本文・出典・自社の言及と引用）
alter table public.aio_prompts add column if not exists search_query text not null default '';
alter table public.aio_checks add column if not exists overview_status text not null default 'none';
alter table public.aio_checks add column if not exists overview_query text not null default '';
alter table public.aio_checks add column if not exists overview jsonb;
create index if not exists aio_checks_overview_open_idx on public.aio_checks (overview_status, created_at) where overview_status in ('pending', 'running');
