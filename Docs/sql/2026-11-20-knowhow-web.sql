-- 第三者の情報（公式サイト以外のウェブ・X）からのノウハウ案づくり。
-- 1) 調べる単位（領域の話題・X 検索）ごとの実行記録。同じ週に済んだ単位は飛ばす（有料の検索・AI・Apify を繰り返さない）
create table if not exists public.knowhow_web_runs (
  key text primary key,                 -- <週>-<領域>-<単位>（例 2026-W47-meo-w1）
  area text not null,
  unit text not null,                   -- w1..w3（話題）／x（X 検索）
  week text not null,
  status text not null check (status in ('done','failed')),
  attempts int not null default 1,
  created int not null default 0,       -- 判断待ちに入れた案の数
  read int not null default 0,          -- 根拠として読んだページ・投稿の数
  note text not null default '',
  ran_at timestamptz not null default now()
);
create index if not exists knowhow_web_runs_week_idx on public.knowhow_web_runs (week, area);
alter table public.knowhow_web_runs enable row level security; -- 方針なし＝サービス側だけ

-- 2) X の検索（Apify・有料）の1日あたりの回数の上限。fetch の直前に claim_knowhow_x_call を通す
create table if not exists public.knowhow_x_calls (
  day text primary key,
  calls int not null default 0
);
alter table public.knowhow_x_calls enable row level security;

create or replace function public.claim_knowhow_x_call(p_day text, p_max int) returns boolean
  language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.knowhow_x_calls (day, calls) values (p_day, 1)
  on conflict (day) do update set calls = public.knowhow_x_calls.calls + 1
  returning calls into n;
  if n > p_max then
    update public.knowhow_x_calls set calls = calls - 1 where day = p_day;
    return false;
  end if;
  return true;
end $$;
revoke all on function public.claim_knowhow_x_call(text, int) from public, anon, authenticated;
