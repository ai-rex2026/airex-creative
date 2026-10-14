-- 情報の一貫性チェック（サイテーション）。公式サイト・各媒体の店名／住所／電話／営業時間が Google の情報とずれていないかを記録する。
-- 書き込みはサーバー（service role）だけ。本人は読むだけ。何度流しても壊れない。

begin;

create table if not exists public.meo_citation_checks (
  id uuid primary key default gen_random_uuid(),
  store_id text not null references public.stores(id) on delete cascade,
  period text not null,                          -- yyyy-mm（JST）。月次上限の集計キー
  status text not null default 'completed',      -- completed | failed
  engine text not null default '',
  result jsonb not null default '{}'::jsonb,     -- { reference, sources[], summary }
  error_message text,
  created_at timestamptz not null default now()
);
create index if not exists meo_citation_checks_by_store on public.meo_citation_checks (store_id, created_at desc);
alter table public.meo_citation_checks enable row level security;
drop policy if exists meo_citation_checks_select_own on public.meo_citation_checks;
create policy meo_citation_checks_select_own on public.meo_citation_checks for select using (public.owns_store(store_id));

commit;
