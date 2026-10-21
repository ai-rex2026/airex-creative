-- サテライトの比較記事の「比較表の下調べ」（2026-10-21）。冪等。
-- 記事ごとに比較項目（columns）を決め、商品ごとの値を1行ずつ持つ（行ごとに保存し、同時書き込みで壊さない）。
create table if not exists public.aio_comparisons (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.aio_projects(id) on delete cascade,
  topic text not null default '',                 -- 記事のタイトル・狙う語
  columns jsonb not null default '[]'::jsonb,     -- 比較項目
  article_id uuid,                                -- この表で書いた記事（aio_articles.id）
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists aio_comparisons_by_project on public.aio_comparisons (project_id, created_at);
alter table public.aio_comparisons enable row level security;
drop policy if exists aio_comparisons_own on public.aio_comparisons;
create policy aio_comparisons_own on public.aio_comparisons for all using (public.owns_aio_project(project_id)) with check (public.owns_aio_project(project_id));

create table if not exists public.aio_comparison_rows (
  id uuid primary key default gen_random_uuid(),
  comparison_id uuid not null references public.aio_comparisons(id) on delete cascade,
  project_id uuid not null references public.aio_projects(id) on delete cascade,
  position int not null default 0,
  item_name text not null,
  item_url text not null default '',
  cells jsonb not null default '{}'::jsonb,       -- {項目: {value, source, via: site|search|manual}}
  status text not null default 'pending',         -- pending | site（公式サイト分まで）| done | error
  error text,
  updated_at timestamptz not null default now(),
  unique (comparison_id, item_name)
);
create index if not exists aio_comparison_rows_by_cmp on public.aio_comparison_rows (comparison_id, position);
alter table public.aio_comparison_rows enable row level security;
drop policy if exists aio_comparison_rows_own on public.aio_comparison_rows;
create policy aio_comparison_rows_own on public.aio_comparison_rows for all using (public.owns_aio_project(project_id)) with check (public.owns_aio_project(project_id));

-- 読んだ公式サイトの本文（数日使い回して、読み直しを減らす）
create table if not exists public.aio_site_cache (
  project_id uuid not null references public.aio_projects(id) on delete cascade,
  url text not null,
  pages jsonb not null default '[]'::jsonb,       -- [{url, kind, text}]
  fetched_at timestamptz not null default now(),
  primary key (project_id, url)
);
alter table public.aio_site_cache enable row level security;
drop policy if exists aio_site_cache_own on public.aio_site_cache;
create policy aio_site_cache_own on public.aio_site_cache for all using (public.owns_aio_project(project_id)) with check (public.owns_aio_project(project_id));
