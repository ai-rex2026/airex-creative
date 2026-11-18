-- 公式ページの追加（SEO の順位更新履歴・広告媒体の変更履歴）。冪等。
insert into public.knowhow_sources (key, area, title, url, official, note) values
  ('google-search-status', 'seo', 'Google Search Status Dashboard（順位アップデートの履歴）', 'https://status.search.google.com/summary', true, 'コアアップデート・スパムアップデートの開始と終了'),
  ('x-ads-policy-log', 'ads', 'X 広告ポリシーの更新履歴', 'https://business.x.com/en/help/ads-policies/ads-policy-update-log', true, '国・業種ごとの解禁・制限の変更'),
  ('microsoft-ads-agreement-log', 'ads', 'Microsoft Advertising 契約の変更履歴', 'https://about.ads.microsoft.com/en-us/resources/policies/microsoft-advertising-agreement-change-log', true, '契約の変更履歴。広告ポリシーそのものの履歴ではない。取得できなければ差し替える'),
  ('lycbiz-news', 'ads', 'LINEヤフー for Business ニュース（広告のお知らせ）', 'https://www.lycbiz.com/jp/news/', true, '広告掲載基準・仕様変更のお知らせ。一覧ページの URL は推測'),
  ('meta-ad-standards', 'ads', 'Meta 広告基準', 'https://transparency.meta.com/ja-jp/policies/ad-standards/', true, '変更履歴の専用ページは無く、本文の差分で検知する')
on conflict (key) do nothing;
