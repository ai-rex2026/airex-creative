-- MEO の「やること」キット（オルコネレックスの作りを移したもの）と、自動で回す設定・記録。
-- meo_kit       … お店ごとに1行（入れてもらった URL・「やること」の状態・自動で回す設定）。本人が読み書きする
-- meo_kit_steps … 工程ごとに1行（結果）。工程が終わった時点でその工程だけ保存する。本人が読み書きする
-- meo_auto_log  … 自動でやったこと／確認待ち。書き込みはサーバー（service role）、本人は読む・確認待ちを片付ける
-- 何度流しても壊れない。

begin;

create table if not exists public.meo_kit (
  store_id text primary key references public.stores(id) on delete cascade,
  input jsonb not null default '{}'::jsonb,
  plan jsonb not null default '{}'::jsonb,
  auto jsonb not null default '{}'::jsonb,
  auto_last_post_on date,
  updated_at timestamptz not null default now()
);
alter table public.meo_kit enable row level security;
drop policy if exists meo_kit_own on public.meo_kit;
create policy meo_kit_own on public.meo_kit for all using (public.owns_store(store_id)) with check (public.owns_store(store_id));

create table if not exists public.meo_kit_steps (
  store_id text not null references public.stores(id) on delete cascade,
  step text not null,
  result jsonb,
  error_message text,
  updated_at timestamptz not null default now(),
  primary key (store_id, step)
);
alter table public.meo_kit_steps enable row level security;
drop policy if exists meo_kit_steps_own on public.meo_kit_steps;
create policy meo_kit_steps_own on public.meo_kit_steps for all using (public.owns_store(store_id)) with check (public.owns_store(store_id));

create table if not exists public.meo_auto_log (
  id uuid primary key default gen_random_uuid(),
  store_id text not null references public.stores(id) on delete cascade,
  kind text not null,                 -- reply | post | measure
  status text not null,               -- sent | pending | dismissed | failed | info
  ref_id text,                        -- 口コミ id / 投稿 id
  title text not null default '',
  text text not null default '',
  rating int,
  reason text not null default '',
  hits jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists meo_auto_log_by_store on public.meo_auto_log (store_id, created_at desc);
-- 同じ口コミに確認待ちを二重に積まない
create unique index if not exists meo_auto_log_pending_ref on public.meo_auto_log (store_id, kind, ref_id) where status = 'pending' and ref_id is not null;
alter table public.meo_auto_log enable row level security;
drop policy if exists meo_auto_log_select_own on public.meo_auto_log;
create policy meo_auto_log_select_own on public.meo_auto_log for select using (public.owns_store(store_id));
drop policy if exists meo_auto_log_update_own on public.meo_auto_log;
create policy meo_auto_log_update_own on public.meo_auto_log for update using (public.owns_store(store_id)) with check (public.owns_store(store_id));

commit;
