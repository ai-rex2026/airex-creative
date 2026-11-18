-- ユーザーのランク（admin / paid / free）と、ノウハウ更新案の受信箱（2026-11-18）
-- ランクは本人から書き換えられない：RLS は読み取りのみ。更新はサービス側（管理者の操作）だけ。

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tier text not null default 'free' check (tier in ('free', 'paid', 'admin')),
  -- 有料の中で運用メニューごとに許可を分けるための枠（キーは lib/tier.ts の MENU_KEYS。設計は後で決める）
  features text[] not null default '{}',
  updated_at timestamptz not null default now()
);
alter table public.user_profiles enable row level security;
drop policy if exists user_profiles_read_own on public.user_profiles;
create policy user_profiles_read_own on public.user_profiles for select using (user_id = auth.uid());
revoke insert, update, delete on public.user_profiles from anon, authenticated;

-- 既存の登録ユーザー：管理者2名、それ以外は今の使い勝手を変えないよう有料。匿名ユーザーは対象外。新規登録は行が無い＝無料。
insert into public.user_profiles (user_id, tier)
select u.id, case when lower(u.email) in ('suzuki@ad-rex.com', 'yuzukinishi@ai-osi-uri.com') then 'admin' else 'paid' end
from auth.users u
where coalesce(u.is_anonymous, false) = false and u.email is not null
on conflict (user_id) do nothing;

-- ノウハウの更新案。表は RLS だけ有効で、方針は置かない＝サービス側（管理者ページ）からしか読み書きできない
create table if not exists public.knowhow_items (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  area text not null check (area in ('meo', 'seo', 'aio', 'lpo', 'image', 'legal')),
  kind text not null default 'add' check (kind in ('add', 'change', 'nochange')),
  title text not null,
  summary text not null default '',
  proposal text not null default '',
  target text not null default '',
  sources jsonb not null default '[]',
  evidence text not null default 'opinion' check (evidence in ('official', 'vendor', 'opinion')),
  caveat text not null default '',
  is_guess boolean not null default false,
  risk text not null default 'normal' check (risk in ('normal', 'legal')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'held')),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  decision_note text not null default '',
  fetched_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.knowhow_items enable row level security;
create index if not exists knowhow_items_status_idx on public.knowhow_items (status, created_at desc);

create table if not exists public.knowhow_log (
  id bigint generated always as identity primary key,
  item_id uuid not null references public.knowhow_items(id) on delete cascade,
  action text not null,
  by_user uuid references auth.users(id) on delete set null,
  note text not null default '',
  at timestamptz not null default now()
);
alter table public.knowhow_log enable row level security;

-- 最初の6件（2026-11-18 の調査）。key で一意なので何度流しても増えない
insert into public.knowhow_items (key, area, kind, title, summary, proposal, target, sources, evidence, caveat, is_guess, risk, fetched_on) values
('meo-qa-retired', 'meo', 'change', 'Q&Aは廃止。属性・説明文・公式サイトのFAQで答える',
 'Q&A機能が廃止され、AIの「Ask」が公式サイト・プロフィール・口コミから答える形に変わった。',
 'MEOの「やること」からQ&A関連を外し、よくある質問は属性・説明文・公式サイトのFAQに載せる施策に置き換える。',
 'lib/meo-ops/kit/ steps.ts・plan.ts（Q&Aの項目が今あるかは未確認）',
 '[{"title":"MyChoice：2026年上半期のGBP変化まとめ","url":"https://www.mychoice.co.jp/column/23_gbp-2026-first-half"}]',
 'vendor', '解説記事の報告で、Google公式の発表では確認できていない。', false, 'normal', '2026-11-18'),
('meo-video-verify', 'meo', 'add', '本人確認は動画認証が標準。認証済みかを初期チェックに入れる',
 '郵送はがきに代わり、看板や内観の30秒以上のワンカット動画で認証する方式が広がっている。',
 '店舗の初期チェックに「ビジネスプロフィールが認証済みか」を追加し、未認証なら最優先のやることにする。',
 'lib/meo-ops/kit/ plan.ts',
 '[{"title":"MyChoice：2026年上半期のGBP変化まとめ","url":"https://www.mychoice.co.jp/column/23_gbp-2026-first-half"}]',
 'vendor', '「2026年7月以降は実質必須」は記事内の報告で、Google公式では未確認。', false, 'normal', '2026-11-18'),
('meo-engagement', 'meo', 'add', '行動データ（写真・口コミ返信・営業時間・行動率）の改善を足す',
 '評価軸が「著名度」から、閲覧・クリック・経路検索・電話タップなどの行動データへ寄っているという分析。',
 '「やること」に、写真の更新・口コミへの返信・営業時間の正確さ・行動率の月次確認を追加する。',
 'lib/meo-ops/kit/ plan.ts',
 '[{"title":"MyChoice：2026年上半期のGBP変化まとめ","url":"https://www.mychoice.co.jp/column/23_gbp-2026-first-half"}]',
 'opinion', '専門家の分析と海外調査の紹介で、順位への寄与の大きさ（GBPシグナル約32%など）はGoogle公式ではない。', true, 'normal', '2026-11-18'),
('aio-answer-first', 'aio', 'add', '見出し直後の短い要約・著者と更新日・@graph統合',
 '各H2/H3の直後に50〜150字の要約を置く、著者・更新日のマークアップ、JSON-LDの@graph統合が挙げられている。',
 '記事生成のルールに「見出しの直後に50〜150字の要約」を追加し、内部対策の診断に著者・更新日・JSON-LD重複の確認を足す。',
 'lib/aio/article.ts、lib/seo/internal.ts',
 '[{"title":"AIOGeoScan 2026-05 レポート","url":"https://aiogeoscan.com/reports/2026-05"}]',
 'vendor', '事業者が自社ツールの基準で測った結果。AIの引用が増えるかは測られておらず、因果は未検証。llms.txtの推奨はGoogle向けではない。', true, 'normal', '2026-11-18'),
('seo-core-update-nov', 'seo', 'nochange', '11月コアアップデート：ロジックは変えず、効果測定に注記する',
 '2026-11-10に開始、展開に最大2週間（11/24頃まで）。Googleは完了後に1週間待ち、11/10前の1週間と比べるよう案内している。具体的な変更点は未発表。',
 '診断のロジックは変えない。SEOの「効果と改善」に、比較の基準（11/10前の1週間）の注記を出す。',
 'SEO運用の results タブ',
 '[{"title":"Search Engine Journal：November 2026 Core Update","url":"https://www.searchenginejournal.com/google-november-2026-core-update/596614/"}]',
 'official', 'Google公式の案内をメディアが引用した記事。公式の更新ページは今回の更新を未反映。', false, 'normal', '2026-11-18'),
('legal-keihyo-2026', 'legal', 'add', '従業員の投稿は「広告」「PR」か提供の明記を求める',
 '「私は○○社の社員です」だけでは事業者の表示と明瞭にならず、「広告」「PR」等の表示か提供の明記が要る。景表法ガイドブックは2026年3月改訂版（不実証広告規制、課徴金3%、管理上の措置7項目）。',
 '法令チェックの辞書とAIチェックに、従業員・関係者の投稿には広告表示か提供の明記が要る旨を追加する。',
 'lib/guardrail.ts',
 '[{"title":"消費者庁：事例でわかる景品表示法（2026年3月改訂版）","url":"https://www.caa.go.jp/policies/policy/representation/fair_labeling/assets/representation_cms201_260723_01.pdf"},{"title":"Advertimes：2026年のステマ規制","url":"https://www.advertimes.com/20260108/article529408/2/"}]',
 'official', '従業員投稿のQ&Aは公開部分で確認。2026年の改訂点は記事の有料部分で読めず未確認。承認前に消費者庁の原文で確認すること。', false, 'legal', '2026-11-18')
on conflict (key) do nothing;
