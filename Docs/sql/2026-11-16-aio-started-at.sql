-- AIO：実測を「始めた時刻」を残し、関数ごと止まった実測を早く失敗にして画面のクルクルを解く（2026-11-16）
alter table public.aio_checks add column if not exists started_at timestamptz;
alter table public.aio_checks add column if not exists overview_started_at timestamptz;
create index if not exists aio_checks_running_idx on public.aio_checks (status, started_at) where status = 'running';
