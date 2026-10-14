-- SNS運用 2回目：Instagram・TikTok・YouTube の運用と、動画づくり（TikTok 20〜30秒・YouTube 10〜20分・リール）。
-- 何度流しても壊れない（2回目以降は何もしない）ように書いてある。
--
-- 方針（AGENTS.md）：投稿・返信・DM は人が承認したものだけ送る。動画のテロップ（日本語）は画像生成モデルに描かせず、
-- 画面（ブラウザの canvas）で組む。ナレーションは音声合成。工程ごとにその場で保存し、済んだ工程はやり直さない。

begin;

-- ── 素材（写真・動画・データ） ──
create table if not exists public.sns_materials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,                            -- image | video | text
  source text not null,                          -- upload | gbp | x | instagram | ai | note
  path text,                                     -- Storage（sns-media）上のパス。text は null
  title text not null default '',
  body text not null default '',                 -- text のときの中身（事実・数字・話したいこと）／画像の説明
  meta jsonb not null default '{}'::jsonb,       -- { width, height, durationSec, origin }
  origin_id text,                                -- 取り込み元の ID（同じものを二度取り込まない）
  created_at timestamptz not null default now()
);
create index if not exists sns_materials_by_user on public.sns_materials (user_id, created_at desc);
create unique index if not exists sns_materials_origin_uniq on public.sns_materials (user_id, source, origin_id) where origin_id is not null;
alter table public.sns_materials enable row level security;
drop policy if exists sns_materials_own on public.sns_materials;
create policy sns_materials_own on public.sns_materials for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── 動画（台本・場面・ナレーション・書き出し・公開） ──
create table if not exists public.sns_videos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null,                        -- tiktok | youtube | instagram（リール）
  format text not null,                          -- short（縦 20〜30秒）| long（横 10〜20分）
  theme text not null default '',
  title text not null default '',
  description text not null default '',
  hashtags jsonb not null default '[]'::jsonb,
  outline jsonb,                                 -- 長尺：章立て [{title, points, minutes}]
  scenes jsonb not null default '[]'::jsonb,     -- [{key, chapter, narration, caption, plannedSec, materialId, imagePrompt, imagePath, audioPath, audioSec, error}]
  voice text not null default 'Kore',
  pattern text not null default '',
  reason text not null default '',
  guard jsonb,
  status text not null default 'draft',          -- draft | ready | rendered | approved | published | skipped | failed
  video_path text,                               -- 書き出した mp4（Storage）
  duration_sec numeric,
  publish_state jsonb not null default '{}'::jsonb, -- 媒体ごとの送信の途中経過（コンテナID・アップロードの ID 等。送れた分は送らない）
  external_id text,
  published_url text,
  privacy text,                                  -- TikTok／YouTube の公開範囲（人が選ぶ）
  error_message text,
  source text not null default 'ops',            -- ops | ops_auto
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  published_at timestamptz,
  metrics jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sns_videos_by_user on public.sns_videos (user_id, platform, created_at desc);
alter table public.sns_videos enable row level security;
drop policy if exists sns_videos_own on public.sns_videos;
create policy sns_videos_own on public.sns_videos for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 動画は大きいので、置き場の1ファイルの上限を広げる（プロジェクト全体の上限が小さいときはそちらが優先される）
update storage.buckets set file_size_limit = 2147483648 where id = 'sns-media' and (file_size_limit is null or file_size_limit < 2147483648);

commit;
