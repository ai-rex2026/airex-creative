-- AIO のギャップ分析（競合にあって自社にない情報）と月次コンテンツ計画。
-- 何度流しても壊れない（2回目以降は何もしない）ように書いてある。

begin;

create table if not exists public.aio_gap_reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.aio_projects(id) on delete cascade,
  period text not null,                          -- 材料にした実測の期（yyyy-mm）
  body jsonb not null default '{}'::jsonb,       -- { summary, gaps[], mediaTargets[] }
  created_at timestamptz not null default now()
);
create index if not exists aio_gap_reports_by_project on public.aio_gap_reports (project_id, created_at desc);
alter table public.aio_gap_reports enable row level security;
drop policy if exists aio_gap_reports_own on public.aio_gap_reports;
create policy aio_gap_reports_own on public.aio_gap_reports for all using (public.owns_aio_project(project_id)) with check (public.owns_aio_project(project_id));

create table if not exists public.aio_content_plans (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.aio_projects(id) on delete cascade,
  month text not null,                           -- yyyy-mm
  items jsonb not null default '[]'::jsonb,      -- AioPlanItem[]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, month)
);
alter table public.aio_content_plans enable row level security;
drop policy if exists aio_content_plans_own on public.aio_content_plans;
create policy aio_content_plans_own on public.aio_content_plans for all using (public.owns_aio_project(project_id)) with check (public.owns_aio_project(project_id));

commit;
