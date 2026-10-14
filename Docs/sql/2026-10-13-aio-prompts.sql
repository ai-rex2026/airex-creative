-- AIO の対策プロンプト設計と月次モニタリング（Vector 等の AIO サービスの型: Prompt Design → Monitoring → …）。
-- 何度流しても壊れない（2回目以降は何もしない）ように書いてある。

begin;

alter table public.aio_projects add column if not exists monitoring_enabled boolean not null default false;

create table if not exists public.aio_prompts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.aio_projects(id) on delete cascade,
  text text not null,
  category text not null default 'recommend',   -- issue | recommend | compare | track_record | select | trust | recruit
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists aio_prompts_by_project on public.aio_prompts (project_id, created_at);
alter table public.aio_prompts enable row level security;
drop policy if exists aio_prompts_own on public.aio_prompts;
create policy aio_prompts_own on public.aio_prompts for all using (public.owns_aio_project(project_id)) with check (public.owns_aio_project(project_id));

-- 実測にプロンプトの紐付けと、手動／月次の区別を足す
alter table public.aio_checks add column if not exists prompt_id uuid references public.aio_prompts(id) on delete set null;
alter table public.aio_checks add column if not exists source text not null default 'manual';   -- manual | monthly
create index if not exists aio_checks_by_prompt on public.aio_checks (prompt_id, created_at desc);

commit;
