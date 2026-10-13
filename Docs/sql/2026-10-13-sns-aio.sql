-- SNS運用（公式アカウントへの投稿案の生成・確認・投稿）と AIO（AI検索対策。店舗以外の会社・サービスも対象）。
-- 2026-10-13 のミーティングで決めた「左サイドバーに MEO と並べて AIO・SNS運用のタブを置く」ための表。
-- 何度流しても壊れない（2回目以降は何もしない）ように書いてある。
--
-- 方針（AGENTS.md）: 投稿・公開は人が確認してから。自動で動くのは「下書きを作る」まで。

begin;

-- ── SNS運用 ────────────────────────────────────────────

-- 自動運用の設定（ユーザー単位。連携したアカウントは sns_connections にある）
create table if not exists public.sns_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  auto_enabled boolean not null default false,   -- 週1で下書きを自動生成する
  auto_weekday int not null default 1,           -- 0=日 … 6=土（JST）
  brand_name text not null default '',
  brand_url text,
  brand_notes text not null default '',          -- 事業内容・強み・NG事項など、AIに渡す前提
  industry text not null default 'general',      -- 法令チェックの業種（lib/types.ts Industry）
  updated_at timestamptz not null default now()
);
alter table public.sns_settings enable row level security;
drop policy if exists sns_settings_own on public.sns_settings;
create policy sns_settings_own on public.sns_settings for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 投稿案（媒体ごとに1行。同じテーマから作った案は topic_id でまとめる）
create table if not exists public.sns_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  topic_id uuid not null default gen_random_uuid(),
  platform text not null,                        -- x | tiktok | meta（sns_connections.platform と同じ）
  topic text not null default '',
  body text not null default '',
  hashtags jsonb not null default '[]'::jsonb,
  guard jsonb,                                   -- 生成と同時に通した法令チェックの結果（GuardVerdict）
  status text not null default 'draft',          -- draft | published | skipped
  source text not null default 'manual',         -- manual | auto（週1の自動生成）
  published_via text,                            -- api | copy（人がコピーして各媒体で投稿）
  external_id text,                              -- API投稿のID（X なら tweet id）
  error_message text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sns_posts_by_user on public.sns_posts (user_id, created_at desc);
alter table public.sns_posts enable row level security;
drop policy if exists sns_posts_own on public.sns_posts;
create policy sns_posts_own on public.sns_posts for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── AIO（AI検索対策） ─────────────────────────────────────

-- 対象（会社・サービス・店舗）。店舗(stores)とは独立。レポート(analyses)とも独立
create table if not exists public.aio_projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null default '',                 -- 自社名（AIの回答に挙がったかの照合に使う）
  aliases jsonb not null default '[]'::jsonb,    -- サービス名・ブランド名など、照合に使う別名
  url text,
  industry text not null default 'general',
  area text not null default '',                 -- 空なら全国・オンライン
  category text not null default '',             -- AIに聞くときの「何を探しているか」
  notes text not null default '',                -- 事業内容（AIに渡す前提）
  site_summary text not null default '',         -- URLから読んだ見出し等（生成の材料）
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists aio_projects_by_owner on public.aio_projects (owner_id, created_at desc);
alter table public.aio_projects enable row level security;
drop policy if exists aio_projects_own on public.aio_projects;
create policy aio_projects_own on public.aio_projects for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create or replace function public.owns_aio_project(pid uuid) returns boolean
  language sql stable security definer set search_path = public as
  $$ select exists (select 1 from public.aio_projects p where p.id = pid and p.owner_id = auth.uid()) $$;

-- 「今どうか」の実測（AIに実際に聞いた結果）。書き込みはサーバー（service role）だけ。本人は読むだけ
create table if not exists public.aio_checks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.aio_projects(id) on delete cascade,
  status text not null default 'pending',        -- pending | running | completed | failed
  engine text not null default 'claude',
  model text not null default '',
  prompt text not null default '',
  period text not null,                          -- yyyy-mm（JST）。月次上限の集計キー
  mentioned boolean not null default false,
  rank int,
  listed jsonb not null default '[]'::jsonb,     -- 挙がった事業者名（回答の順）
  cited_sources jsonb not null default '[]'::jsonb,
  own_source_domains jsonb not null default '[]'::jsonb,
  raw_answer text not null default '',
  search_queries jsonb not null default '[]'::jsonb,
  error_message text,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  search_requests int not null default 0,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists aio_checks_by_project on public.aio_checks (project_id, created_at desc);
alter table public.aio_checks enable row level security;
drop policy if exists aio_checks_select_own on public.aio_checks;
create policy aio_checks_select_own on public.aio_checks for select using (public.owns_aio_project(project_id));

-- 「何をすべきか」の下書き（自社サイト記事・note記事・プレスリリース・FAQ構造化データ 等）
create table if not exists public.aio_drafts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.aio_projects(id) on delete cascade,
  kind text not null,                            -- site_article | note_article | press_release | faq_schema | listing_memo
  title text not null default '',
  body text not null default '',
  guard jsonb,
  status text not null default 'draft',          -- draft | done（人が使った）
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists aio_drafts_by_project on public.aio_drafts (project_id, created_at desc);
alter table public.aio_drafts enable row level security;
drop policy if exists aio_drafts_own on public.aio_drafts;
create policy aio_drafts_own on public.aio_drafts for all using (public.owns_aio_project(project_id)) with check (public.owns_aio_project(project_id));

commit;
