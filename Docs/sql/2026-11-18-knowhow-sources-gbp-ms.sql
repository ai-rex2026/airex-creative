-- Microsoft Advertising ブログの RSS と Googleビジネスプロフィールの公式ページを追加。冪等。
insert into public.knowhow_sources (key, area, title, url, official, note) values
  ('microsoft-ads-blog-rss', 'ads', 'Microsoft Advertising ブログ（RSS）', 'https://about.ads.microsoft.com/en-us/blog/rss', true, '製品アップデート中心。ポリシー専用ではないが、変更があれば検知できる'),
  ('gbp-api-latest-updates', 'meo', 'Googleビジネスプロフィール API の最新情報', 'https://developers.google.com/my-business/content/latest-updates?hl=ja', true, 'API の変更履歴。審査・ポリシー違反に関わる更新も載る'),
  ('gbp-guidelines', 'meo', 'Googleビジネスプロフィール ガイドライン', 'https://support.google.com/business/answer/3039617?hl=ja', true, 'URLの中身は未確認（初回の取得で確かめる）')
on conflict (key) do nothing;
