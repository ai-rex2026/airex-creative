-- 法令の取得源の追加（消費者庁の新着情報・医療広告規制・薬機法）。冪等。
insert into public.knowhow_sources (key, area, title, url, official, note) values
  ('caa-notice-archive', 'legal', '消費者庁：新着情報一覧', 'https://www.caa.go.jp/notice/archive/', true, '景表法・表示対策を含む消費者庁全体の新着。景表法以外も混ざるので、案にするのは広告・表示に関わるものだけ'),
  ('mhlw-medical-ad', 'legal', '厚生労働省：医療広告規制について', 'https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/kenkou_iryou/iryou/kokokukisei/index.html', true, '医療広告ガイドライン・Q&A・事例解説書。歯科・美容医療のお客様向け'),
  ('mhlw-pmd-ad', 'legal', '厚生労働省：医薬品等の広告規制（薬機法）', 'https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/kenkou_iryou/iyakuhin/koukoku/index.html', true, 'URLは未確認（推測）。取得できなければ差し替える')
on conflict (key) do nothing;
