-- MEO運用ワークスペース（AI-REX 本体の features/meo を移植）のスキーマ。
-- 1レポート = 1店舗。運用データは analyses.id にぶら下げる（本体の analyses/{id} 配下のサブコレクションと同じ持ち方）。
-- 読み取りは本人（analyses.owner_id）だけ。AI検索の結果・日次スナップショット・月次指標はサーバー（service role）が書く。
-- 追加のみ（既存テーブルの列・データには触れない）なので、何度流しても壊れない。

-- ── 店舗の特定 ─────────────────────────────
alter table public.analyses add column if not exists meo_place_id text;
alter table public.analyses add column if not exists meo_place_source text;            -- 'auto' | 'manual'
alter table public.analyses add column if not exists meo_store jsonb;                  -- 確定した店舗の Places 実測（自店＋近隣競合＋スコア）
alter table public.analyses add column if not exists meo_store_candidates jsonb;       -- 1つに決められなかったときの候補
alter table public.analyses add column if not exists meo_gbp_account text;             -- accounts/{a}
alter table public.analyses add column if not exists meo_gbp_location text;            -- accounts/{a}/locations/{l}
alter table public.analyses add column if not exists meo_last_opened_at timestamptz;   -- 日次スナップショットの休眠判定

-- ── 設定（AI返信・通知）とプロフィール下書き ─────────────
create table if not exists public.meo_settings (
  analysis_id text primary key references public.analyses(id) on delete cascade,
  ai_reply jsonb not null default '{}'::jsonb,
  notifications jsonb not null default '{}'::jsonb,
  profile jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ── クチコミ（GBP から同期） ─────────────────────
create table if not exists public.meo_reviews (
  analysis_id text not null references public.analyses(id) on delete cascade,
  id text not null,                         -- GBP の reviewId
  gbp_name text,                            -- accounts/{a}/locations/{l}/reviews/{r}
  author_name text not null default '',
  rating int not null default 0,
  text text not null default '',
  reviewed_at timestamptz,
  review_updated_at timestamptz,
  reply text,
  reply_status text not null default 'unreplied',   -- unreplied | pending | replied | needs_update | failed
  replied_at timestamptz,
  aio_score int,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (analysis_id, id)
);
create index if not exists meo_reviews_by_date on public.meo_reviews (analysis_id, reviewed_at desc);

-- ── 投稿（GBP 最新情報） ─────────────────────────
create table if not exists public.meo_posts (
  id uuid primary key default gen_random_uuid(),
  analysis_id text not null references public.analyses(id) on delete cascade,
  title text not null default '',
  body text not null default '',
  status text not null default 'draft',     -- draft | scheduled | published
  scheduled_at timestamptz,
  published_at timestamptz,
  image_url text,
  action_button jsonb,
  ai_generated boolean not null default false,
  gbp_name text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists meo_posts_by_date on public.meo_posts (analysis_id, created_at desc);

-- ── 月次の活用分析（GBP Performance API ＋ AI） ──────────
create table if not exists public.meo_metrics (
  analysis_id text not null references public.analyses(id) on delete cascade,
  period text not null,                     -- yyyy-mm（JST）
  metrics jsonb not null default '[]'::jsonb,
  field_topics jsonb not null default '[]'::jsonb,
  suggestions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  primary key (analysis_id, period)
);

-- ── 日次スナップショット（Places API） ──────────────
create table if not exists public.meo_daily (
  analysis_id text not null references public.analyses(id) on delete cascade,
  date text not null,                       -- yyyy-mm-dd（JST）
  meo_score int,
  review_count int not null default 0,
  new_review_count int,
  average_rating numeric,
  created_at timestamptz not null default now(),
  primary key (analysis_id, date)
);

-- ── AI検索の実測 ───────────────────────────
create table if not exists public.ai_search_checks (
  id uuid primary key default gen_random_uuid(),
  analysis_id text not null references public.analyses(id) on delete cascade,
  status text not null default 'pending',   -- pending | running | completed | failed
  engine text not null default 'claude',
  model text not null default '',
  query_area text not null default '',
  query_category text not null default '',
  prompt text not null default '',
  period text not null,                     -- yyyy-mm（JST）。月次上限の集計キー
  mentioned boolean not null default false,
  rank int,
  listed_stores jsonb not null default '[]'::jsonb,
  cited_sources jsonb not null default '[]'::jsonb,
  own_source_domains jsonb not null default '[]'::jsonb,
  raw_answer text not null default '',
  search_queries jsonb not null default '[]'::jsonb,
  search_suggestions_html text not null default '',
  error_message text,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  search_requests int not null default 0,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists ai_search_checks_by_date on public.ai_search_checks (analysis_id, created_at desc);

create table if not exists public.ai_search_summary (
  analysis_id text primary key references public.analyses(id) on delete cascade,
  total_checks int not null default 0,
  mentioned_checks int not null default 0,
  history jsonb not null default '[]'::jsonb,
  sources jsonb not null default '[]'::jsonb,
  suggestions jsonb not null default '[]'::jsonb,
  last_checked_at timestamptz,
  updated_at timestamptz not null default now()
);

-- ── GBP 連携（Google ビジネスプロフィール用の OAuth。広告・GA とは別スコープなので別行で持つ） ──
create table if not exists public.gbp_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  refresh_token text not null,              -- AD_TOKEN_ENC_KEY で暗号化して保存
  scope text,
  email text,
  connected_at timestamptz not null default now()
);

-- ── RLS ────────────────────────────────
alter table public.meo_settings enable row level security;
alter table public.meo_reviews enable row level security;
alter table public.meo_posts enable row level security;
alter table public.meo_metrics enable row level security;
alter table public.meo_daily enable row level security;
alter table public.ai_search_checks enable row level security;
alter table public.ai_search_summary enable row level security;
alter table public.gbp_connections enable row level security;

create or replace function public.owns_analysis(aid text) returns boolean
  language sql stable security definer set search_path = public as
  $$ select exists (select 1 from public.analyses a where a.id = aid and a.owner_id = auth.uid()) $$;

do $$
declare t text;
begin
  -- 読み取りは本人だけ（全テーブル共通）
  foreach t in array array['meo_settings','meo_reviews','meo_posts','meo_metrics','meo_daily','ai_search_checks','ai_search_summary'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format('create policy %I on public.%I for select using (public.owns_analysis(analysis_id))', t || '_select_own', t);
  end loop;
end $$;

-- 本人が画面から書けるもの：設定・下書き・投稿・返信文。
-- AI検索・日次・月次・クチコミ本体の取り込みはサーバー（service role）だけが書く
drop policy if exists meo_settings_write_own on public.meo_settings;
create policy meo_settings_write_own on public.meo_settings for all
  using (public.owns_analysis(analysis_id)) with check (public.owns_analysis(analysis_id));

drop policy if exists meo_posts_write_own on public.meo_posts;
create policy meo_posts_write_own on public.meo_posts for all
  using (public.owns_analysis(analysis_id)) with check (public.owns_analysis(analysis_id));

drop policy if exists meo_reviews_update_own on public.meo_reviews;
create policy meo_reviews_update_own on public.meo_reviews for update
  using (public.owns_analysis(analysis_id)) with check (public.owns_analysis(analysis_id));

drop policy if exists gbp_select_own on public.gbp_connections;
create policy gbp_select_own on public.gbp_connections for select using (user_id = auth.uid());
drop policy if exists gbp_delete_own on public.gbp_connections;
create policy gbp_delete_own on public.gbp_connections for delete using (user_id = auth.uid());
