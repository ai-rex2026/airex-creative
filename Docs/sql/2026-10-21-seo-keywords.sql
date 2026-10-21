-- SEO運用の対策キーワード（2026-10-21）。冪等。
-- 全体レポートの対策キーワード・SEO記事設計から取り込み、書く先・状態・記事・Search Console の実測の推移を持つ。
create table if not exists public.seo_keywords (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.aio_projects(id) on delete cascade,
  keyword text not null,
  keyword_norm text not null,                    -- 照合用（NFKC・小文字・空白の揺れを無くしたもの）
  kind text not null default '一般',             -- 指名 | 地域 | 一般 | 比較
  priority text not null default '中',           -- 最高 | 高 | 中 | 低
  difficulty text,                               -- 低 | 中 | 高（全体レポートの推定）
  volume text,                                   -- 月間検索数の推定（5段階）。実測ではない
  volume_source text,                            -- report | ai
  target text not null default 'site',           -- site | satellite | existing
  target_url text,
  status text not null default 'todo',           -- todo | writing | published | skip
  source text not null default 'manual',         -- report | article_plan | gsc | manual
  action text not null default '',
  note text not null default '',
  article_ids jsonb not null default '[]'::jsonb, -- この語で作った記事（aio_articles.id）
  gsc jsonb not null default '[]'::jsonb,         -- Search Console の推移 [{to, impressions, clicks, position}]（新しい順・最大12件）
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, keyword_norm)
);
create index if not exists seo_keywords_by_project on public.seo_keywords (project_id, created_at);
alter table public.seo_keywords enable row level security;
drop policy if exists seo_keywords_own on public.seo_keywords;
create policy seo_keywords_own on public.seo_keywords for all using (public.owns_aio_project(project_id)) with check (public.owns_aio_project(project_id));
