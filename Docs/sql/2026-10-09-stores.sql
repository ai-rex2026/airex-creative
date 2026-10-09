-- 店舗(stores)をレポート(analyses)から独立した実体にする。
-- MEO運用データ（設定・クチコミ・投稿・指標・日次・AI検索）は stores.id にぶら下げる。
-- 古いテストデータ（analyses.id にぶら下がっていた運用データ）は破棄してよいと確認済みのため、7テーブルを空にして付け替える。
-- ログイン・ユーザーアカウントは今まで通り Supabase Auth の1つ（stores.owner_id = auth.uid()）。
-- 何度流しても壊れない（2回目以降は何もしない）ように書いてある。

begin;

create table if not exists public.stores (
  id text primary key default gen_random_uuid()::text,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text,
  industry text not null default 'general',
  meo_place_id text,
  meo_place_source text,                 -- 'auto' | 'manual'
  meo_store jsonb,                       -- 確定した店舗の Places 実測（自店＋近隣競合＋スコア）
  meo_store_candidates jsonb,
  meo_gbp_account text,                  -- accounts/{a}
  meo_gbp_location text,                 -- accounts/{a}/locations/{l}
  meo_last_opened_at timestamptz,        -- 日次スナップショットの休眠判定
  created_at timestamptz not null default now()
);
create index if not exists stores_by_owner on public.stores (owner_id, created_at desc);
-- 同じ人が同じGoogle店舗を二重に登録しない
create unique index if not exists stores_owner_place_uniq on public.stores (owner_id, meo_place_id) where meo_place_id is not null;

alter table public.stores enable row level security;
drop policy if exists stores_select_own on public.stores;
create policy stores_select_own on public.stores for select using (owner_id = auth.uid());
drop policy if exists stores_insert_own on public.stores;
create policy stores_insert_own on public.stores for insert with check (owner_id = auth.uid());
drop policy if exists stores_update_own on public.stores;
create policy stores_update_own on public.stores for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists stores_delete_own on public.stores;
create policy stores_delete_own on public.stores for delete using (owner_id = auth.uid());

create or replace function public.owns_store(sid text) returns boolean
  language sql stable security definer set search_path = public as
  $$ select exists (select 1 from public.stores s where s.id = sid and s.owner_id = auth.uid()) $$;

do $$
declare
  t text;
  fk text;
  pol record;
begin
  foreach t in array array['meo_settings','meo_reviews','meo_posts','meo_metrics','meo_daily','ai_search_checks','ai_search_summary'] loop
    -- まだ analysis_id の列が残っているテーブルだけ付け替える（2回目以降は飛ばす）
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t and column_name = 'analysis_id') then
      execute format('truncate table public.%I', t);
      for fk in
        select c.conname from pg_constraint c
        where c.conrelid = format('public.%I', t)::regclass and c.contype = 'f'
          and c.confrelid = 'public.analyses'::regclass
      loop
        execute format('alter table public.%I drop constraint %I', t, fk);
      end loop;
      -- 古い方針（analyses 基準）を先に外す。列名の変更で参照先が壊れるのを避ける
      for pol in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
        execute format('drop policy if exists %I on public.%I', pol.policyname, t);
      end loop;
      execute format('alter table public.%I rename column analysis_id to store_id', t);
      execute format('alter table public.%I add constraint %I foreign key (store_id) references public.stores(id) on delete cascade', t, t || '_store_fk');
    end if;
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format('create policy %I on public.%I for select using (public.owns_store(store_id))', t || '_select_own', t);
  end loop;
end $$;

-- 本人が画面から書けるもの：設定・下書き・投稿・返信文。
-- AI検索・日次・月次・クチコミ本体の取り込みはサーバー（service role）だけが書く
drop policy if exists meo_settings_write_own on public.meo_settings;
create policy meo_settings_write_own on public.meo_settings for all
  using (public.owns_store(store_id)) with check (public.owns_store(store_id));

drop policy if exists meo_posts_write_own on public.meo_posts;
create policy meo_posts_write_own on public.meo_posts for all
  using (public.owns_store(store_id)) with check (public.owns_store(store_id));

drop policy if exists meo_reviews_update_own on public.meo_reviews;
create policy meo_reviews_update_own on public.meo_reviews for update
  using (public.owns_store(store_id)) with check (public.owns_store(store_id));

commit;
