-- 広告運用 ＞ バナー制作（2026-11-11）：fal で絵（文字なし）を作り、コピーは DOM・canvas で重ねる。
-- 何度流しても壊れない（2回目以降は何もしない）ように書いてある。
begin;

-- 制作の単位（商品・サービスごと）
create table if not exists public.banner_projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null default '',
  url text not null default '',
  description text not null default '',          -- 商品・サービスの説明（人が書く）
  diagnosis jsonb,                                -- 何を・誰に売るか・ブランド（AI）
  copies jsonb not null default '[]'::jsonb,      -- コピー（法令チェック済み。BannerCopy[]）
  materials jsonb not null default '[]'::jsonb,   -- 取り込んだ素材 [{path, kind, name}]
  patterns jsonb not null default '[]'::jsonb,    -- 絵の基本パターン [{key,label,concept,prompt,motion,useMaterials}]
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists banner_projects_owner on public.banner_projects(owner_id, created_at desc);
alter table public.banner_projects enable row level security;
drop policy if exists banner_projects_own on public.banner_projects;
create policy banner_projects_own on public.banner_projects for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- fal で作った絵・動画（1依頼1行。送った時点で保存し、問い合わせで続きを進める）
create table if not exists public.banner_visuals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.banner_projects(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,                             -- base | resize | video
  pattern text not null default '',               -- 基本パターンの key
  parent_id uuid references public.banner_visuals(id) on delete cascade, -- resize・video の元の絵
  aspect text not null default '1:1',
  model text not null default '',
  request_id text,
  status_url text,
  response_url text,
  status text not null default 'queued',          -- queued | done | error
  path text,                                      -- Storage（banner-assets）上のパス
  error text,
  text_warning text,                              -- 絵に文字が入っていそう（文字チェックの結果）
  cost_usd numeric not null default 0,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists banner_visuals_project on public.banner_visuals(project_id, created_at);
create index if not exists banner_visuals_owner_month on public.banner_visuals(owner_id, created_at);
alter table public.banner_visuals enable row level security;
drop policy if exists banner_visuals_own on public.banner_visuals;
create policy banner_visuals_own on public.banner_visuals for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- 素材・出来上がった絵・動画の置き場（非公開。画面は /api/banner-assets 経由）
insert into storage.buckets (id, name, public)
values ('banner-assets', 'banner-assets', false)
on conflict (id) do nothing;

commit;
