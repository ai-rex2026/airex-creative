-- 取得できなかった・目的と違った公式ページの差し替え。冪等。
-- Google 広告：ポリシー一覧のページ（6008942）→ 年ごとの更新一覧（2026）
insert into public.knowhow_sources (key, area, title, url, official, note) values
  ('google-ads-updates-2026', 'ads', 'Google 広告ポリシー：2026年の更新一覧', 'https://support.google.com/adspolicy/topic/16794025', true, '各ポリシーの更新（年ごとの一覧）。年が変わったら新しい年のページを足す'),
  ('microsoft-ads-policy-blog', 'ads', 'Microsoft Advertising：ポリシーチームのブログ', 'https://about.ads.microsoft.com/en/blog/author/microsoft-advertising-policy-team', true, 'ポリシー変更の告知。取得できなければ停止する（未確認）'),
  ('meta-developers-blog', 'ads', 'Meta for Developers ブログ', 'https://developers.facebook.com/blog/', true, '広告 API・透明性要件などの変更告知。広告基準そのものの履歴ではない（未確認）')
on conflict (key) do nothing;
-- 取得できなかったもの・目的と違ったものを止める（行は残す）
update public.knowhow_sources set enabled = false,
  note = '取得できなかった／目的と違ったため停止（2026-11-18）'
  where key in ('google-ads-policy-log', 'microsoft-ads-agreement-log', 'meta-ad-standards', 'x-ads-policy-log');
