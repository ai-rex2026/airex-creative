-- ノウハウ更新案の「一次情報」の定期取得（2026-11-18）。公式ページを週1回取得し、前回との差分があったときだけ更新案を作る
-- 広告運用（ads）の枠も追加（画面ができたら、承認した案の反映先をつなぐ）
alter table public.knowhow_items drop constraint if exists knowhow_items_area_check;
alter table public.knowhow_items add constraint knowhow_items_area_check check (area in ('meo', 'seo', 'aio', 'lpo', 'image', 'legal', 'ads'));

create table if not exists public.knowhow_sources (
  key text primary key,
  area text not null check (area in ('meo', 'seo', 'aio', 'lpo', 'image', 'legal', 'ads')),
  title text not null,
  url text not null,
  official boolean not null default true,
  enabled boolean not null default true,
  note text not null default '',
  last_hash text,
  last_text text not null default '',
  last_checked_at timestamptz,
  last_changed_at timestamptz,
  last_error text not null default '',
  fail_count int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.knowhow_sources enable row level security;

insert into public.knowhow_sources (key, area, title, url, official, note) values
('google-search-updates', 'seo', 'Google 検索セントラル：ドキュメントの更新履歴', 'https://developers.google.com/search/updates', true, ''),
('caa-fair-labeling', 'legal', '消費者庁：景品表示法・表示対策', 'https://www.caa.go.jp/policies/policy/representation/fair_labeling/', true, 'URLは未確認（初回の取得で確かめる）'),
('google-ads-policy-log', 'ads', 'Google 広告：ポリシーの変更履歴', 'https://support.google.com/adspolicy/answer/6008942', true, 'URLは未確認（初回の取得で確かめる）')
on conflict (key) do nothing;
