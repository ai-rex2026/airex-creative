-- SEO運用：内部リンク分析（2026-10-27）。冪等。
-- 記事の本文と既存リンクを読んで保存する表と、「この記事からこの記事へリンクする」提案の表。
begin;

create table if not exists public.seo_link_pages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.aio_projects(id) on delete cascade,
  url text not null,
  title text not null default '',
  h1 text not null default '',
  headings jsonb not null default '[]'::jsonb,       -- h2・h3 の文字列
  body text not null default '',                     -- 本文（最大2万字）
  links jsonb not null default '[]'::jsonb,          -- 同じサイト内への既存リンク（正規化したURL）
  fetched_at timestamptz,                            -- 読めたら入る。入っている行は読み直さない
  error text not null default '',
  created_at timestamptz not null default now(),
  unique (project_id, url)
);
create index if not exists seo_link_pages_by_project on public.seo_link_pages (project_id);
alter table public.seo_link_pages enable row level security;
drop policy if exists seo_link_pages_own on public.seo_link_pages;
create policy seo_link_pages_own on public.seo_link_pages for all using (public.owns_aio_project(project_id)) with check (public.owns_aio_project(project_id));

create table if not exists public.seo_link_suggestions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.aio_projects(id) on delete cascade,
  from_url text not null,
  to_url text not null,
  similarity real not null default 0,                -- 候補を絞った類似度（コードの計算）
  decision boolean,                                  -- AI の判定（リンクすべきか）。null は未判定
  probability real,                                  -- 推奨の確率（AI の自己申告。較正されていない）
  confidence real,                                   -- 確信度（同上）
  sentence text not null default '',                 -- リンクを入れる本文中の文
  anchor text not null default '',                   -- アンカーテキスト（その文に実在する語句）
  role text not null default '',                     -- リンクの役割
  reason text not null default '',
  judge text not null default '',                    -- 判定に使った仕組み（claude | jev）
  status text not null default 'pending',            -- pending（未判定）| suggested | rejected | accepted | dismissed
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, from_url, to_url)
);
create index if not exists seo_link_suggestions_by_project on public.seo_link_suggestions (project_id, status);
alter table public.seo_link_suggestions enable row level security;
drop policy if exists seo_link_suggestions_own on public.seo_link_suggestions;
create policy seo_link_suggestions_own on public.seo_link_suggestions for all using (public.owns_aio_project(project_id)) with check (public.owns_aio_project(project_id));

commit;
