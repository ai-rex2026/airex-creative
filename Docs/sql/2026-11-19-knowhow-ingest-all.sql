-- 公式ページの「過去分を含めた全取り込み」の進み具合（2026-11-19）。初回に保存した全文を小分けにして案にする
alter table public.knowhow_sources add column if not exists full_cursor int not null default 0;
alter table public.knowhow_sources add column if not exists full_ingested_at timestamptz;

-- Google マップの口コミ関連の公式ページ（2026-11-19）。MEO の口コミ依頼・返信の案の根拠になる
insert into public.knowhow_sources (key, area, title, url, official, note) values
('gmaps-contribution-policy', 'meo', 'Google マップ 投稿コンテンツのポリシー', 'https://support.google.com/contributionpolicy/answer/7400114?hl=ja', true, '口コミのインセンティブ・選別・利益相反・宣伝のルール本体。2022年に一部の文言が変わった経緯があるので、差分で検知する'),
('gbp-review-tips', 'meo', 'Google ビジネス プロフィール ヘルプ：クチコミを増やすヒントと返信のコツ', 'https://support.google.com/business/answer/3474122?hl=ja', true, '口コミの依頼方法と、返信の書き方（宣伝を入れない・低評価への対応）')
on conflict (key) do nothing;
