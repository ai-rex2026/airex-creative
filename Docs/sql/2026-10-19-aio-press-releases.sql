-- AIO「PR TIMES」：プレスリリースの入稿内容（タイトル・リード・本文・画像・動画・表現チェック）。冪等。
create table if not exists public.aio_press_releases (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.aio_projects(id) on delete cascade,
  title text not null default '',
  status text not null default 'draft',          -- draft | submitted（PR TIMES に入稿した印。人が付ける）
  brief jsonb not null default '{}'::jsonb,      -- 入力（種類・発表内容・事実・日付・連絡先・動画）
  content jsonb not null default '{}'::jsonb,    -- 入稿内容（タイトル案・サブタイトル・リード・本文・キーワード・会社概要…）
  images jsonb not null default '[]'::jsonb,
  guard jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists aio_press_releases_by_project on public.aio_press_releases (project_id, created_at desc);
alter table public.aio_press_releases enable row level security;
drop policy if exists aio_press_releases_own on public.aio_press_releases;
create policy aio_press_releases_own on public.aio_press_releases for all using (public.owns_aio_project(project_id)) with check (public.owns_aio_project(project_id));
