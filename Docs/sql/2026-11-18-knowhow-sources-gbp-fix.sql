-- GBP ガイドラインを本物のページ（3038177）に差し替え、本文が取れない Microsoft RSS を止める。冪等。
insert into public.knowhow_sources (key, area, title, url, official, note) values
  ('gbp-business-info-guidelines', 'meo', 'Google に掲載するビジネス情報のガイドライン', 'https://support.google.com/business/answer/3038177?hl=ja', true, '店名・住所・営業時間・カテゴリ等のルール本体。更新日の記載はないため本文の差分で検知する')
on conflict (key) do nothing;
update public.knowhow_sources set enabled = false,
  note = '目的と違うページだったため停止（2026-11-18）' where key = 'gbp-guidelines';
update public.knowhow_sources set enabled = false,
  note = 'RSS の本文（題名・説明）が取れず、記事IDと日付だけのため停止（2026-11-18）' where key = 'microsoft-ads-blog-rss';
