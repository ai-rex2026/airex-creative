-- AIO の「運用」：自社サイトのコラム記事・note 記事を、既存記事のトンマナに合わせて画像つきで作り、
-- WordPress へは人の承認で公開し、効果（Search Console・GA4・note の数字）を見て改善案を出す。
-- 何度流しても壊れない（2回目以降は何もしない）ように書いてある。
--
-- 方針（AGENTS.md）: 公開は人の承認ボタンだけ。note は API が無いので「貼るだけ＋人が投稿」。
-- 画像は文字を入れない（日本語の文字を画像生成モデルに描かせない）。

begin;

-- 媒体ごとの設定（対象1件につき site と note の2行まで）
create table if not exists public.aio_channels (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.aio_projects(id) on delete cascade,
  kind text not null,                            -- site | note
  source_url text,                               -- コラム一覧のURL / note のアカウントURL
  has_source boolean not null default true,      -- false = コラム／アカウントがまだ無い（立ち上げ支援を出す）
  style jsonb,                                   -- 既存記事から読んだトンマナ（AioStyle）
  samples jsonb not null default '[]'::jsonb,    -- 分析に使った既存記事 [{url,title,chars,h2}]
  analyzed_at timestamptz,
  strategy jsonb,                                -- 立ち上げ・戦略（アカウント／コラムが無いとき）
  analytics jsonb,                               -- { gscSite, ga4Property, pathPrefix }（効果分析の対象）
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, kind)
);
alter table public.aio_channels enable row level security;
drop policy if exists aio_channels_own on public.aio_channels;
create policy aio_channels_own on public.aio_channels for all using (public.owns_aio_project(project_id)) with check (public.owns_aio_project(project_id));

-- WordPress の接続（アプリケーションパスワードは暗号化して保存）。
-- 秘密を含むので本人のセッションからは読めない（ポリシーを置かない＝ service role だけ）
create table if not exists public.aio_wp_connections (
  project_id uuid primary key references public.aio_projects(id) on delete cascade,
  base_url text not null,
  wp_user text not null,
  app_password text not null,                    -- lib/ads/crypto.ts sealToken で暗号化した値
  site_name text not null default '',
  category_id int,                               -- 投稿するカテゴリ（null は WordPress の既定）
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.aio_wp_connections enable row level security;

-- 記事（本文・画像・公開の状態）
create table if not exists public.aio_articles (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.aio_projects(id) on delete cascade,
  channel text not null,                         -- site | note
  title text not null default '',
  slug text not null default '',
  meta_description text not null default '',
  keywords jsonb not null default '[]'::jsonb,
  target text not null default '',               -- 答える問い・狙う検索語
  body_md text not null default '',
  hashtags jsonb not null default '[]'::jsonb,   -- note のハッシュタグ
  images jsonb not null default '[]'::jsonb,     -- [{key, role, afterH2, prompt, alt, path, hasText, error}]
  guard jsonb,
  status text not null default 'draft',          -- draft | published
  wp_post_id bigint,
  wp_media jsonb not null default '{}'::jsonb,   -- { 画像key: {id, url} }（送信済みは再送しない）
  published_url text,
  published_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists aio_articles_by_project on public.aio_articles (project_id, channel, created_at desc);
alter table public.aio_articles enable row level security;
drop policy if exists aio_articles_own on public.aio_articles;
create policy aio_articles_own on public.aio_articles for all using (public.owns_aio_project(project_id)) with check (public.owns_aio_project(project_id));

-- 効果の数字（取得・入力した時点の記録。同じ記事に何回でも積む）
create table if not exists public.aio_article_metrics (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.aio_projects(id) on delete cascade,
  channel text not null,                         -- site | note
  article_id uuid references public.aio_articles(id) on delete set null,
  url text not null default '',
  title text not null default '',
  source text not null,                          -- gsc | ga4 | note_manual | note_csv
  period_from date,
  period_to date,
  views int,
  clicks int,
  impressions int,
  position numeric,
  engagement_sec numeric,
  likes int,
  comments int,
  queries jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists aio_article_metrics_by_project on public.aio_article_metrics (project_id, channel, created_at desc);
alter table public.aio_article_metrics enable row level security;
drop policy if exists aio_article_metrics_own on public.aio_article_metrics;
create policy aio_article_metrics_own on public.aio_article_metrics for all using (public.owns_aio_project(project_id)) with check (public.owns_aio_project(project_id));

-- 改善案（数字を読んで出した、直す記事と次に書く記事）
create table if not exists public.aio_content_reviews (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.aio_projects(id) on delete cascade,
  channel text not null,
  body jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists aio_content_reviews_by_project on public.aio_content_reviews (project_id, channel, created_at desc);
alter table public.aio_content_reviews enable row level security;
drop policy if exists aio_content_reviews_own on public.aio_content_reviews;
create policy aio_content_reviews_own on public.aio_content_reviews for all using (public.owns_aio_project(project_id)) with check (public.owns_aio_project(project_id));

-- 記事の画像の置き場（非公開。画面には署名つきURLで出す。書き込みはサーバーだけ）
insert into storage.buckets (id, name, public)
values ('aio-images', 'aio-images', false)
on conflict (id) do nothing;

commit;
