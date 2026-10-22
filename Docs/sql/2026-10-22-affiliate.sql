-- アフィリエイト運用（airex-recruiting の調査フェーズを移植）。冪等。
-- 持ち主はログイン中のユーザー（user_id = auth.uid()）。テナントは持たない。

create table if not exists public.aff_campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_name text not null default '',
  name text not null,
  product_name text not null default '',
  lp_url text not null default '',
  unit_price text not null default '',
  conversion_point text not null default '',
  approval_terms text not null default '',
  selling_points text not null default '',
  genre text not null default '',
  reference_url text not null default '',
  draft_url text not null default '',
  brief text not null default '',
  status text not null default 'active', -- active | paused | closed
  created_at timestamptz not null default now()
);
create index if not exists aff_campaigns_by_user on public.aff_campaigns (user_id, created_at desc);

create table if not exists public.aff_keywords (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid not null references public.aff_campaigns(id) on delete cascade,
  keyword text not null,
  priority int not null default 3,
  search_volume int,
  cpc numeric,
  competition text not null default '',
  volume_updated_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists aff_keywords_by_campaign on public.aff_keywords (campaign_id);

-- メディア台帳（案件をまたいで共有。ドメインで名寄せ）
create table if not exists public.aff_media (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  domain text not null,
  name text not null default '',
  operator text not null default '',
  category text not null default '',
  asp_type text not null default 'unknown', -- direct | asp | unknown
  asp_name text not null default '',
  no_solicitation boolean not null default false,
  no_solicitation_reason text not null default '',
  note text not null default '',
  created_at timestamptz not null default now()
);
create unique index if not exists aff_media_user_domain on public.aff_media (user_id, domain);

create table if not exists public.aff_asp_master (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  domain text not null,
  asp_name text not null
);
create unique index if not exists aff_asp_user_domain on public.aff_asp_master (user_id, domain);

create table if not exists public.aff_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  keyword_id uuid not null references public.aff_keywords(id) on delete cascade,
  collected_at timestamptz not null default now(),
  source text not null default 'dataforseo' -- dataforseo | ai_web_search
);
create index if not exists aff_snapshots_by_keyword on public.aff_snapshots (keyword_id, collected_at desc);

create table if not exists public.aff_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  snapshot_id uuid not null references public.aff_snapshots(id) on delete cascade,
  media_id uuid references public.aff_media(id) on delete set null,
  rank int,
  result_type text not null default 'organic', -- paid | organic
  article_url text not null default '',
  article_title text not null default '',
  is_ranking_article boolean not null default false,
  judge_reason text not null default '',
  own_listed boolean not null default false,
  own_rank_in_article int,
  enriched_at timestamptz
);
create index if not exists aff_entries_by_snapshot on public.aff_entries (snapshot_id);
create index if not exists aff_entries_reuse on public.aff_entries (article_url, enriched_at desc nulls last);

create table if not exists public.aff_listings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_id uuid not null references public.aff_entries(id) on delete cascade,
  position int,
  service_name text not null default '',
  is_own boolean not null default false
);
create index if not exists aff_listings_by_entry on public.aff_listings (entry_id);

-- 打診候補（案件 × メディア）。今は調査の結果として積むだけ。打診そのものはまだ扱わない
create table if not exists public.aff_targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid not null references public.aff_campaigns(id) on delete cascade,
  media_id uuid not null references public.aff_media(id) on delete cascade,
  kind text not null default 'new', -- new | replace
  status text not null default 'collected', -- collected | excluded
  status_reason text not null default '',
  article_url text not null default '',
  rank int,
  negotiation_note text not null default '',
  created_at timestamptz not null default now()
);
create unique index if not exists aff_targets_campaign_media on public.aff_targets (campaign_id, media_id);

create table if not exists public.aff_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid not null references public.aff_campaigns(id) on delete cascade,
  keyword_id uuid not null references public.aff_keywords(id) on delete cascade,
  status text not null default 'pending', -- pending | running | done | error
  source text not null default 'dataforseo',
  found_count int not null default 0,
  ranking_count int not null default 0,
  paid_count int not null default 0,
  media_new int not null default 0,
  error_detail text not null default '',
  snapshot_id uuid references public.aff_snapshots(id) on delete set null,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists aff_jobs_by_campaign on public.aff_jobs (campaign_id, created_at desc);

create table if not exists public.aff_kw_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid not null references public.aff_campaigns(id) on delete cascade,
  keyword text not null,
  search_volume int,
  cpc numeric,
  competition text not null default '',
  source text not null default 'ai', -- ai | dataforseo
  reason text not null default '',
  status text not null default 'suggested' -- suggested | adopted | dismissed
);
create unique index if not exists aff_kw_suggestions_campaign_keyword on public.aff_kw_suggestions (campaign_id, keyword);

-- AI利用料の実績（記録時点の単価で金額に変えて凍結）
create table if not exists public.aff_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid references public.aff_campaigns(id) on delete cascade,
  keyword_id uuid references public.aff_keywords(id) on delete set null,
  kind text not null,
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  web_searches int not null default 0,
  cost_usd numeric(12,6) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists aff_usage_by_campaign on public.aff_usage (campaign_id, created_at desc);

do $$
declare t text;
begin
  foreach t in array array[
    'aff_campaigns','aff_keywords','aff_media','aff_asp_master','aff_snapshots','aff_entries',
    'aff_listings','aff_targets','aff_jobs','aff_kw_suggestions','aff_usage'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_own', t);
    execute format('create policy %I on public.%I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t || '_own', t);
  end loop;
end $$;

create or replace view public.aff_usage_by_kind with (security_invoker = on) as
  select user_id, campaign_id, kind,
         count(*)::bigint as calls,
         sum(input_tokens)::bigint as input_tokens,
         sum(output_tokens)::bigint as output_tokens,
         sum(web_searches)::bigint as web_searches,
         sum(cost_usd)::numeric as cost_usd,
         max(created_at) as last_at
  from public.aff_usage
  group by user_id, campaign_id, kind;

create or replace view public.aff_usage_by_keyword with (security_invoker = on) as
  select u.user_id, u.campaign_id, u.keyword_id, k.keyword,
         count(*)::bigint as calls,
         sum(u.cost_usd)::numeric as cost_usd
  from public.aff_usage u
  join public.aff_keywords k on k.id = u.keyword_id
  group by u.user_id, u.campaign_id, u.keyword_id, k.keyword;
