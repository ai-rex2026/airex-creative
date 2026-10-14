-- MEO のキーワード順位の定点観測（2026-10-13 のミーティング：「どのキーワードで今何位か」が無いのが MEO として弱い）。
-- 店舗ごとにキーワードを登録し、決めた起点（緯度経度＋半径）から Google の Text Search で自店舗が何番目かを月次で記録する。
-- 何度流しても壊れない（2回目以降は何もしない）ように書いてある。

begin;

-- 測る起点。null なら店舗の位置（meo_store.location）から半径3kmで測る
alter table public.stores add column if not exists meo_rank_origin jsonb;

create table if not exists public.meo_keywords (
  id uuid primary key default gen_random_uuid(),
  store_id text not null references public.stores(id) on delete cascade,
  keyword text not null,
  created_at timestamptz not null default now(),
  unique (store_id, keyword)
);
create index if not exists meo_keywords_by_store on public.meo_keywords (store_id, created_at);
alter table public.meo_keywords enable row level security;
drop policy if exists meo_keywords_own on public.meo_keywords;
create policy meo_keywords_own on public.meo_keywords for all using (public.owns_store(store_id)) with check (public.owns_store(store_id));

-- 計測結果。書き込みはサーバー（service role）だけ。本人は読むだけ
create table if not exists public.meo_keyword_ranks (
  id uuid primary key default gen_random_uuid(),
  store_id text not null references public.stores(id) on delete cascade,
  keyword_id uuid not null references public.meo_keywords(id) on delete cascade,
  measured_on date not null,                   -- JST の日付
  period text not null,                        -- yyyy-mm（JST）
  rank int,                                    -- 1始まり。上位20件に無ければ null（圏外）
  top jsonb not null default '[]'::jsonb,      -- 上位の店（placeId・名前・評価・クチコミ数・写真数）
  origin jsonb,                                -- 測ったときの起点
  source text not null default 'monthly',      -- monthly | manual
  created_at timestamptz not null default now(),
  unique (keyword_id, measured_on)
);
create index if not exists meo_keyword_ranks_by_store on public.meo_keyword_ranks (store_id, measured_on desc);
alter table public.meo_keyword_ranks enable row level security;
drop policy if exists meo_keyword_ranks_select_own on public.meo_keyword_ranks;
create policy meo_keyword_ranks_select_own on public.meo_keyword_ranks for select using (public.owns_store(store_id));

commit;
