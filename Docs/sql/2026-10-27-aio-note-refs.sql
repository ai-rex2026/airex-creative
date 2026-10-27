-- note 記事の「参考にする人気記事」（2026-10-27）。冪等。
-- 週1回の検索で見つけた記事（source=search）と、人が貼った記事（source=manual）。公開ページから読んだスキ数・見出し・冒頭を持つ。
create table if not exists public.aio_note_refs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.aio_projects(id) on delete cascade,
  url text not null,
  theme text not null default '',
  title text not null default '',
  author text not null default '',
  likes int,                                     -- スキ数（読んだ時点）
  headings jsonb not null default '[]'::jsonb,   -- 見出し（h2/h3）
  lead text not null default '',                 -- 冒頭の段落
  chars int,
  source text not null default 'search',         -- search | manual
  status text not null default 'pending',        -- pending | done | error
  error text,
  fetched_at timestamptz,
  created_at timestamptz not null default now(),
  unique (project_id, url)
);
create index if not exists aio_note_refs_by_project on public.aio_note_refs (project_id, likes desc);
alter table public.aio_note_refs enable row level security;
drop policy if exists aio_note_refs_own on public.aio_note_refs;
create policy aio_note_refs_own on public.aio_note_refs for all using (public.owns_aio_project(project_id)) with check (public.owns_aio_project(project_id));

-- 前回テーマ決め・検索をした時刻（note の媒体の行に持つ）
alter table public.aio_channels add column if not exists note_refs_at timestamptz;
