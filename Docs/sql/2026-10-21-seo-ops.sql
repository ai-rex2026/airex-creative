-- SEO運用（/seo）：自社サイト記事（AIO から移設）・サテライトサイト・内部対策（2026-10-21）。冪等。
begin;

-- サテライトサイトの設定（メディア名・テーマ・運営者・扱う商品）。aio_channels の kind='satellite' の行に持つ
alter table public.aio_channels add column if not exists satellite jsonb;

-- サテライトサイトの WordPress の接続（自社サイトとは別のサイト）。秘密を含むので本人のセッションからは読めない（service role だけ）
create table if not exists public.aio_wp_satellite_connections (
  project_id uuid primary key references public.aio_projects(id) on delete cascade,
  base_url text not null,
  wp_user text not null,
  app_password text not null,                    -- lib/ads/crypto.ts sealToken で暗号化した値
  site_name text not null default '',
  category_id int,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.aio_wp_satellite_connections enable row level security;

-- 内部対策（SEO と AIO で共通の1つのリスト。scope で SEO／AIO／両方を分ける）
create table if not exists public.seo_internal_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.aio_projects(id) on delete cascade,
  key text not null,                             -- 同じ施策を1件にまとめる鍵（https・sitemap・manual:xxx など）
  title text not null default '',
  detail text not null default '',
  scope text not null default 'both',            -- seo | aio | both
  priority text not null default '中',           -- 高 | 中 | 低
  status text not null default 'todo',           -- todo | doing | done | skip
  source text not null default 'manual',         -- scan | checklist | report | manual
  measured boolean not null default false,       -- サイトを読んで確かめた結果か
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, key)
);
create index if not exists seo_internal_tasks_by_project on public.seo_internal_tasks (project_id, created_at);
alter table public.seo_internal_tasks enable row level security;
drop policy if exists seo_internal_tasks_own on public.seo_internal_tasks;
create policy seo_internal_tasks_own on public.seo_internal_tasks for all using (public.owns_aio_project(project_id)) with check (public.owns_aio_project(project_id));

commit;
