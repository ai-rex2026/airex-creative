-- LPO運用（2026-11-11）：LP ごとに「LP改善」「表示速度改善」「ヒートマップ分析」「効果」を回す。
-- 何度流しても壊れない（2回目以降は何もしない）ように書いてある。
begin;

-- 対象の LP
create table if not exists public.lpo_projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null default '',
  url text not null,
  analysis_id uuid,                               -- 分析レポートから取り込んだときの元
  diagnosis jsonb,                                -- 何を・誰に売るか（AI への前提）
  site jsonb,                                     -- サイトの読み取り結果（SiteScan）
  plan jsonb,                                     -- LP改善（LpoPlan）
  plan_done jsonb not null default '[]'::jsonb,   -- 済みにした改善の key
  speed jsonb,                                    -- 表示速度の最新（SpeedScan）
  speed_history jsonb not null default '[]'::jsonb, -- [{at, score, metrics:[{id,label,value,rating}]}]
  build_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lpo_projects_owner on public.lpo_projects(owner_id, created_at desc);
alter table public.lpo_projects enable row level security;
drop policy if exists lpo_projects_own on public.lpo_projects;
create policy lpo_projects_own on public.lpo_projects for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Microsoft Clarity の API トークン（暗号化して保存）。本人のセッションからは読めない（ポリシーを置かない＝ service role だけ）
create table if not exists public.lpo_clarity (
  project_id uuid primary key references public.lpo_projects(id) on delete cascade,
  token text not null,                            -- lib/ads/crypto.ts sealToken で暗号化した値
  last_fetch_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.lpo_clarity enable row level security;

-- ヒートマップの分析（Clarity の数字 or 取り込んだ画像 → AI の所見と改善案）
create table if not exists public.lpo_heatmaps (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.lpo_projects(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  source text not null,                           -- clarity | image
  kind text not null default '',                  -- metrics | scroll | click | attention
  tool text not null default '',                  -- 画像の出どころ（Hotjar・Ptengine など。任意）
  metrics jsonb,                                  -- Clarity の数字 [{metric, values:{...}}]
  images jsonb not null default '[]'::jsonb,      -- Storage（lpo-heatmaps）上のパス
  analysis jsonb,                                 -- { findings:[], proposals:[{title,where,why,steps,impact}] }
  error text,
  created_at timestamptz not null default now()
);
create index if not exists lpo_heatmaps_project on public.lpo_heatmaps(project_id, created_at desc);
alter table public.lpo_heatmaps enable row level security;
drop policy if exists lpo_heatmaps_own on public.lpo_heatmaps;
create policy lpo_heatmaps_own on public.lpo_heatmaps for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- ヒートマップ画像の置き場（非公開。画面は署名 URL）
insert into storage.buckets (id, name, public)
values ('lpo-heatmaps', 'lpo-heatmaps', false)
on conflict (id) do nothing;

commit;
