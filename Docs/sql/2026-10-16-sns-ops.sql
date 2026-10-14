-- SNS運用を媒体ごと（X・Instagram・TikTok・YouTube）の「運用」に作り替える（1回目：X と、各社のアプリの鍵の登録）。
-- 何度流しても壊れない（2回目以降は何もしない）ように書いてある。
--
-- 方針（AGENTS.md）: 投稿・返信・DM は人が承認したものだけ送る。自動で動くのは「集める・分析する・案を作る」まで。
-- Apify の呼び出しは claim_sns_apify_call（1ユーザー1日の上限）を fetch の直前に必ず通す。

begin;

-- ── 各社のアプリの鍵（会社ごとに自分の Meta／TikTok／Google／X のアプリを登録する口） ──
-- 秘密を含むので本人のセッションからは読めない（ポリシーを置かない＝ service role だけ）
create table if not exists public.sns_app_credentials (
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null,                        -- x | meta | tiktok | youtube
  client_id text not null,
  client_secret text not null,                   -- lib/ads/crypto.ts sealToken で暗号化した値
  extra jsonb not null default '{}'::jsonb,      -- Meta のログイン設定ID など
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, platform)
);
alter table public.sns_app_credentials enable row level security;

-- 連携に使ったアプリ（自社アプリか共通アプリか）。トークン更新に同じアプリの鍵を使うため
alter table public.sns_connections add column if not exists app_client_id text;

-- YouTube を連携先に足す（platform に古い CHECK 制約があれば外す。値はアプリ側で検査する）
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.sns_connections'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%platform%'
  loop
    execute format('alter table public.sns_connections drop constraint %I', c.conname);
  end loop;
end $$;

-- ── 媒体ごとの運用の設定 ──
create table if not exists public.sns_ops_settings (
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null,                        -- x | meta | tiktok | youtube
  enabled boolean not null default false,        -- 毎日の収集・分析・案づくりを回す
  config jsonb not null default '{}'::jsonb,     -- { benchHandles[], keywords[], dailyDrafts, ... }
  updated_at timestamptz not null default now(),
  primary key (user_id, platform)
);
alter table public.sns_ops_settings enable row level security;
drop policy if exists sns_ops_settings_own on public.sns_ops_settings;
create policy sns_ops_settings_own on public.sns_ops_settings for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── 集めた投稿（伸びているアカウント・検索・自分の投稿） ──
create table if not exists public.sns_observed_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null,
  source text not null,                          -- bench | search | own
  external_id text not null,
  author text not null default '',
  author_name text not null default '',
  author_followers int,
  text text not null default '',
  url text not null default '',
  media jsonb not null default '[]'::jsonb,      -- [{type, url}]
  likes int,
  reposts int,
  replies int,
  quotes int,
  views int,
  bookmarks int,
  is_reply boolean not null default false,
  conversation_id text,
  mentions_me boolean not null default false,    -- 自分をメンション／自分の投稿への返信（X の API でリプライできる相手）
  posted_at timestamptz,
  fetched_at timestamptz not null default now(),
  unique (user_id, platform, external_id)
);
create index if not exists sns_observed_posts_by_user on public.sns_observed_posts (user_id, platform, source, posted_at desc);
alter table public.sns_observed_posts enable row level security;
drop policy if exists sns_observed_posts_own on public.sns_observed_posts;
create policy sns_observed_posts_own on public.sns_observed_posts for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── 伸びた「型」の分析 ──
create table if not exists public.sns_patterns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null,
  body jsonb not null default '{}'::jsonb,       -- { summary, patterns[], ownLearnings[] }
  created_at timestamptz not null default now()
);
create index if not exists sns_patterns_by_user on public.sns_patterns (user_id, platform, created_at desc);
alter table public.sns_patterns enable row level security;
drop policy if exists sns_patterns_own on public.sns_patterns;
create policy sns_patterns_own on public.sns_patterns for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── 投稿案を、スレッド・画像・リプライ／リポスト／DM・予約・結果まで扱えるようにする ──
alter table public.sns_posts add column if not exists kind text not null default 'post';           -- post | reply | quote | repost | dm
alter table public.sns_posts add column if not exists thread jsonb not null default '[]'::jsonb;    -- 続き（リプライに書く本文）
alter table public.sns_posts add column if not exists media jsonb not null default '[]'::jsonb;     -- [{key, type, path, prompt, alt, hasText, error}]
alter table public.sns_posts add column if not exists pattern text not null default '';
alter table public.sns_posts add column if not exists reason text not null default '';              -- AI がこの案を勧める理由
alter table public.sns_posts add column if not exists target jsonb;                                 -- 反応する投稿・返す DM
alter table public.sns_posts add column if not exists scheduled_at timestamptz;
alter table public.sns_posts add column if not exists approved_at timestamptz;
alter table public.sns_posts add column if not exists approved_by uuid references auth.users(id) on delete set null;
alter table public.sns_posts add column if not exists external_ids jsonb not null default '[]'::jsonb;  -- スレッドの各投稿の ID（送れた分だけ。再送しない）
alter table public.sns_posts add column if not exists media_ids jsonb not null default '{}'::jsonb;    -- { 画像key: 媒体側のID }（送れた分だけ）
alter table public.sns_posts add column if not exists metrics jsonb;
alter table public.sns_posts add column if not exists metrics_at timestamptz;
create index if not exists sns_posts_due on public.sns_posts (status, scheduled_at) where status = 'approved';

-- ── DM（受信箱） ──
create table if not exists public.sns_inbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null,
  external_id text not null,
  conversation_id text not null default '',
  sender_id text not null default '',
  sender_name text not null default '',
  from_me boolean not null default false,
  text text not null default '',
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, platform, external_id)
);
create index if not exists sns_inbox_by_user on public.sns_inbox (user_id, platform, sent_at desc);
alter table public.sns_inbox enable row level security;
drop policy if exists sns_inbox_own on public.sns_inbox;
create policy sns_inbox_own on public.sns_inbox for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── 毎日の運用の工程（済んだ工程は飛ばす） ──
create table if not exists public.sns_daily_runs (
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null,
  day text not null,                             -- yyyy-mm-dd（JST）
  steps jsonb not null default '{}'::jsonb,      -- { 工程名: {done, at, error} }
  updated_at timestamptz not null default now(),
  primary key (user_id, platform, day)
);
alter table public.sns_daily_runs enable row level security;
drop policy if exists sns_daily_runs_read on public.sns_daily_runs;
create policy sns_daily_runs_read on public.sns_daily_runs for select using (user_id = auth.uid());

-- ── Apify の呼び出し回数（1ユーザー1日の上限。fetch の直前に必ず通す） ──
create table if not exists public.sns_apify_calls (
  user_id uuid not null,
  day text not null,
  calls int not null default 0,
  primary key (user_id, day)
);
alter table public.sns_apify_calls enable row level security;

create or replace function public.claim_sns_apify_call(p_user uuid, p_day text, p_max int) returns boolean
  language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.sns_apify_calls (user_id, day, calls) values (p_user, p_day, 1)
  on conflict (user_id, day) do update set calls = public.sns_apify_calls.calls + 1
  returning calls into n;
  if n > p_max then
    update public.sns_apify_calls set calls = calls - 1 where user_id = p_user and day = p_day;
    return false;
  end if;
  return true;
end $$;
revoke all on function public.claim_sns_apify_call(uuid, text, int) from public, anon, authenticated;

-- 画像・動画の置き場（非公開。画面には署名つきURLで出す。書き込みはサーバーだけ）
insert into storage.buckets (id, name, public)
values ('sns-media', 'sns-media', false)
on conflict (id) do nothing;

commit;
