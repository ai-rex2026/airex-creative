-- 手動点検の対象（自動取得できない公式ページ）。前回点検日から interval_days を過ぎるとアラートを出す。
create table if not exists public.knowhow_manual_checks (
  key text primary key,
  area text not null check (area in ('meo','seo','aio','lpo','image','legal','ads')),
  title text not null,
  url text not null,
  note text not null default '',
  interval_days int not null default 14 check (interval_days between 1 and 90),
  last_checked_at timestamptz,
  last_result text not null default '' check (last_result in ('', 'changed', 'none')),
  last_memo text not null default '',
  created_at timestamptz not null default now()
);
alter table public.knowhow_manual_checks enable row level security; -- 方針なし＝サービス側だけ

insert into public.knowhow_manual_checks (key, area, title, url, note, last_checked_at, last_result, last_memo) values
  ('x-ads-policy-log', 'ads', 'X 広告ポリシーの更新履歴', 'https://business.x.com/en/help/ads-policies/ads-policy-update-log', 'サーバーからは403。ブラウザで開く。新しい行（最新は2026年9月）が出たら案にする', '2026-11-18 12:00:00+00', 'none', '初回点検。最新は2026年9月（ハンガリー向け金融）。日本に関わる直近は2025年10月（債務整理）'),
  ('meta-ad-standards', 'ads', 'Meta 広告基準（日本語）', 'https://transparency.meta.com/ja-jp/policies/ad-standards/', '更新日の記載なし。前回の本文と比べて差分を見る。サーバーからは本文が空', '2026-11-18 12:00:00+00', 'none', '初回点検。本文は読めた。基準の本文は未保存'),
  ('microsoft-ads-policy', 'ads', 'Microsoft Advertising ポリシー（ブログ）', 'https://about.ads.microsoft.com/en/blog/author/microsoft-advertising-policy-team', 'ポリシー専用の履歴ページは見つかっていない。ブログの最新記事を見る', null, '', '')
on conflict (key) do nothing;
